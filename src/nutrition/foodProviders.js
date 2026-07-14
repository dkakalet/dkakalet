// Unified food provider layer (design doc: Nutrition Food Logging — v2/v3).
//
// Every source returns the app's existing canonical food shape so the rest
// of the app (logging, scaling, display) stays source-agnostic:
//   { id, name, source: 'library' | 'nutritionix' | 'usda' | 'off' | 'meal', brand,
//     per100: { cal, protein, carbs, fat }, servings: [{ label, grams }],
//     provenance: 'user_created' | 'cached_from_api' | 'live_external',
//     verified, createdAt }
// This mirrors the plan's CanonicalFood model but keeps the field names the
// app already persists (per100/cal/servings) rather than the doc's literal
// names (nutrients_per_100g/calories/serving_options), to avoid a migration
// for food libraries already saved by v1 users. Values and semantics match.
//
// 'live_external' foods are search results not yet saved anywhere — they
// exist only for the duration of a search. cacheExternalFood() persists one
// into the personal library on first use (provenance becomes
// 'cached_from_api'), per the cache-on-first-use strategy in the design doc.
//
// Meals (v3) are flat composites — a named list of {food, quantity}
// components — but are stored and treated as just another canonical food
// (source: 'meal'), so logging one reuses the exact same scaling/display
// code as any other food. See buildMeal() below.

import { uid, todayStr, round } from "../lib/helpers.js";

// Guards every external call with a timeout, so a hung network request
// (slow/unreachable provider) can't leave the search UI stuck forever —
// it fails the same way a fast error would, and callers already treat
// fetch failures as "no results from this source."
const FETCH_TIMEOUT_MS = 8000;
function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Query cache (v4 polish): short-TTL in-memory cache for external provider
// searches, keyed by provider+query. Session-only (resets on reload) — this
// just absorbs repeat/backspace-retype searches within a sitting, not a
// durable cache. The personal library's own search is already local/instant
// and isn't wrapped.
const QUERY_CACHE_TTL_MS = 3 * 60 * 1000;
const queryCache = new Map();
async function withQueryCache(providerId, query, fn) {
  const key = `${providerId}:${query.trim().toLowerCase()}`;
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < QUERY_CACHE_TTL_MS) return hit.results;
  const results = await fn();
  queryCache.set(key, { at: Date.now(), results });
  return results;
}

export const libraryProvider = {
  id: "library",
  search(query, libraryFoods) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return libraryFoods.filter(
      (f) => f.name.toLowerCase().includes(q) || (f.brand || "").toLowerCase().includes(q)
    );
  },
};

// Nutritionix's instant-search endpoint gives full macros for branded items
// but not for generic ("common") ones — those need a follow-up natural-
// language lookup. We surface common items as detail-pending stubs and
// resolve them lazily (on selection) via getDetail, mirroring the design
// doc's FoodProvider.getById concept.
function brandedToCanonical(item) {
  const grams = item.serving_weight_grams > 0 ? item.serving_weight_grams : 100;
  const scale = 100 / grams;
  return {
    id: `nix:${item.nix_item_id || item.food_name}`,
    name: item.food_name,
    source: "nutritionix",
    brand: item.brand_name || null,
    per100: {
      cal: round((item.nf_calories || 0) * scale, 1),
      protein: round((item.nf_protein || 0) * scale, 1),
      carbs: round((item.nf_total_carbohydrate || 0) * scale, 1),
      fat: round((item.nf_total_fat || 0) * scale, 1),
    },
    servings: [{ label: item.serving_unit || "serving", grams }],
    provenance: "live_external",
    verified: true,
    createdAt: todayStr(),
    _needsDetail: false,
  };
}
function commonToStub(item) {
  return {
    id: `nix:${item.tag_id || item.food_name}`,
    name: item.food_name,
    source: "nutritionix",
    brand: null,
    per100: null,
    servings: [],
    provenance: "live_external",
    verified: true,
    createdAt: todayStr(),
    _needsDetail: true,
    _query: item.food_name,
  };
}

function altMeasuresToServings(primary, altMeasures) {
  const out = [{ label: primary.unit, grams: primary.grams }];
  (altMeasures || []).forEach((m) => {
    if (!m.serving_weight || out.some((s) => s.label === m.measure)) return;
    out.push({ label: m.measure, grams: m.serving_weight });
  });
  return out;
}

export const nutritionixProvider = {
  id: "nutritionix",
  async search(query) {
    const q = query.trim();
    if (!q) return [];
    return withQueryCache("nutritionix", q, async () => {
      try {
        const res = await fetchWithTimeout(`/api/nutritionix/instant?query=${encodeURIComponent(q)}`);
        if (!res.ok) return [];
        const data = await res.json();
        return [...(data.branded || []).map(brandedToCanonical), ...(data.common || []).map(commonToStub)];
      } catch {
        return []; // proxy unreachable or key not configured yet — no-op gracefully
      }
    });
  },
  // Resolves full nutrients for a detail-pending ("common") stub.
  async getDetail(stub) {
    const res = await fetchWithTimeout("/api/nutritionix/nutrients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: stub._query || stub.name }),
    });
    if (!res.ok) throw new Error("Couldn't fetch nutrition details for that food.");
    const data = await res.json();
    const item = (data.foods || [])[0];
    if (!item) throw new Error("No nutrition data found for that food.");
    const grams = item.serving_weight_grams > 0 ? item.serving_weight_grams : 100;
    const scale = 100 / grams;
    return {
      ...stub,
      per100: {
        cal: round((item.nf_calories || 0) * scale, 1),
        protein: round((item.nf_protein || 0) * scale, 1),
        carbs: round((item.nf_total_carbohydrate || 0) * scale, 1),
        fat: round((item.nf_total_fat || 0) * scale, 1),
      },
      servings: altMeasuresToServings(
        { unit: item.serving_unit || "serving", grams },
        item.alt_measures
      ),
      _needsDetail: false,
    };
  },
};

// USDA FoodData Central: unlike Nutritionix, the search endpoint reports
// nutrients per 100g directly for every food type, so no detail follow-up
// is needed.
const USDA_NUTRIENT_NUMBERS = { cal: "208", protein: "203", carbs: "205", fat: "204" };
function usdaValue(foodNutrients, number) {
  const hit = (foodNutrients || []).find((n) => n.nutrientNumber === number);
  return hit ? hit.value || 0 : 0;
}
function usdaToCanonical(item) {
  const servings = [{ label: "100 g", grams: 100 }];
  if (item.servingSize > 0 && item.servingSizeUnit === "g" && item.servingSize !== 100) {
    servings.push({ label: `${item.servingSize} ${item.servingSizeUnit}`, grams: item.servingSize });
  }
  return {
    id: `usda:${item.fdcId}`,
    name: item.description,
    source: "usda",
    brand: item.brandOwner || item.brandName || null,
    per100: {
      cal: round(usdaValue(item.foodNutrients, USDA_NUTRIENT_NUMBERS.cal), 1),
      protein: round(usdaValue(item.foodNutrients, USDA_NUTRIENT_NUMBERS.protein), 1),
      carbs: round(usdaValue(item.foodNutrients, USDA_NUTRIENT_NUMBERS.carbs), 1),
      fat: round(usdaValue(item.foodNutrients, USDA_NUTRIENT_NUMBERS.fat), 1),
    },
    servings,
    provenance: "live_external",
    verified: true,
    createdAt: todayStr(),
    _needsDetail: false,
  };
}

export const usdaProvider = {
  id: "usda",
  async search(query) {
    const q = query.trim();
    if (!q) return [];
    return withQueryCache("usda", q, async () => {
      try {
        const res = await fetchWithTimeout(`/api/usda/search?query=${encodeURIComponent(q)}`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.foods || []).map(usdaToCanonical);
      } catch {
        return []; // proxy unreachable or key not configured yet — no-op gracefully
      }
    });
  },
};

// Open Food Facts: free, keyless, public read API with open CORS — called
// directly from the browser rather than through the proxy, since there's no
// secret to protect.
function offToCanonical(product) {
  const n = product.nutriments || {};
  const cal = n["energy-kcal_100g"] ?? (n["energy_100g"] != null ? n["energy_100g"] / 4.184 : 0);
  const servings = [{ label: "100 g", grams: 100 }];
  if (product.serving_quantity > 0 && product.serving_quantity !== 100) {
    servings.push({ label: product.serving_size || "serving", grams: product.serving_quantity });
  }
  return {
    id: `off:${product.code}`,
    name: product.product_name,
    source: "off",
    brand: (product.brands || "").split(",")[0].trim() || null,
    per100: {
      cal: round(cal || 0, 1),
      protein: round(n.proteins_100g || 0, 1),
      carbs: round(n.carbohydrates_100g || 0, 1),
      fat: round(n.fat_100g || 0, 1),
    },
    servings,
    provenance: "live_external",
    verified: false,
    createdAt: todayStr(),
    _needsDetail: false,
  };
}

export const offProvider = {
  id: "off",
  async search(query) {
    const q = query.trim();
    if (!q) return [];
    return withQueryCache("off", q, async () => {
      try {
        const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=10`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.products || [])
          .filter((p) => p.product_name && p.code)
          .map(offToCanonical);
      } catch {
        return []; // offline or blocked — no-op gracefully
      }
    });
  },
};

// Fans out to every enabled provider in parallel and returns results keyed
// by provider id, each item tagged with its source. No ranking, no
// cross-source de-duplication — per the design doc, the user sees and
// chooses between all matches.
export async function searchAllProviders(query, { libraryFoods }) {
  const [library, nutritionix, usda, off] = await Promise.all([
    Promise.resolve(libraryProvider.search(query, libraryFoods)),
    nutritionixProvider.search(query),
    usdaProvider.search(query),
    offProvider.search(query),
  ]);
  return { library, nutritionix, usda, off };
}

// Flat meal composite (v3): sums component macros into one canonical food
// (source: 'meal') so the rest of the app logs/scales/displays it exactly
// like any other food — no separate "meal entry" code path. No nesting:
// a meal's components must be ordinary foods, not other meals.
export function buildMeal(name, components) {
  let totalGrams = 0;
  const totals = components.reduce(
    (a, c) => {
      const grams = c.servingGrams * c.quantity;
      totalGrams += grams;
      const scale = grams / 100;
      return {
        cal: a.cal + c.food.per100.cal * scale,
        protein: a.protein + c.food.per100.protein * scale,
        carbs: a.carbs + c.food.per100.carbs * scale,
        fat: a.fat + c.food.per100.fat * scale,
      };
    },
    { cal: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const per100 =
    totalGrams > 0
      ? {
          cal: round((totals.cal * 100) / totalGrams, 1),
          protein: round((totals.protein * 100) / totalGrams, 1),
          carbs: round((totals.carbs * 100) / totalGrams, 1),
          fat: round((totals.fat * 100) / totalGrams, 1),
        }
      : { cal: 0, protein: 0, carbs: 0, fat: 0 };
  return {
    id: uid(),
    name,
    source: "meal",
    brand: null,
    per100,
    servings: [{ label: "1 meal", grams: round(totalGrams, 1) }],
    provenance: "user_created",
    verified: false,
    createdAt: todayStr(),
    components: components.map((c) => ({
      foodId: c.food.id,
      name: c.food.name,
      servingLabel: c.servingLabel,
      servingGrams: c.servingGrams,
      quantity: c.quantity,
    })),
  };
}

// Cache-on-first-use: persists a canonical copy of an external food into the
// personal library the first time it's selected. De-dupes identical library
// entries (same name+brand+source) instead of caching repeat copies.
export function cacheExternalFood(food, libraryFoods) {
  const existing = libraryFoods.find(
    (f) => f.source === food.source && f.name === food.name && (f.brand || null) === (food.brand || null)
  );
  if (existing) return { food: existing, isNew: false };
  const cached = {
    ...food,
    id: uid(),
    provenance: "cached_from_api",
    cachedAt: todayStr(),
  };
  delete cached._needsDetail;
  delete cached._query;
  return { food: cached, isNew: true };
}

// Refresh-stale-cache (v4 polish): cached_from_api foods keep growing more
// out of date the longer they sit unused. This is a best-effort refresh —
// re-searching by name via the same provider, rather than a precise by-ID
// lookup — because cacheExternalFood() reassigns a fresh local id at cache
// time, so the original provider-side id isn't retained. Good enough for a
// personal tool; the design doc explicitly treats this as optional polish.
export const STALE_DAYS = 90;
export function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return Math.floor((Date.now() - new Date(`${dateStr}T00:00:00`).getTime()) / 86400000);
}
export function isStale(food) {
  return food.provenance === "cached_from_api" && daysSince(food.cachedAt) >= STALE_DAYS;
}
export async function refreshFood(food) {
  if (food.source === "nutritionix") {
    return nutritionixProvider.getDetail({ ...food, _query: food.name });
  }
  if (food.source === "usda" || food.source === "off") {
    const provider = food.source === "usda" ? usdaProvider : offProvider;
    const results = await provider.search(food.name);
    const match = results.find((r) => r.name === food.name && (r.brand || null) === (food.brand || null)) || results[0];
    if (!match) throw new Error(`No current ${food.source === "usda" ? "USDA" : "Open Food Facts"} match found for this food.`);
    return { ...food, per100: match.per100, servings: match.servings };
  }
  throw new Error("This food can't be refreshed from an external source.");
}
