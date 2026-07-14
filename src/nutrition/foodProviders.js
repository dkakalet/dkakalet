// Unified food provider layer (design doc: Nutrition Food Logging — v2).
//
// Every source returns the app's existing canonical food shape so the rest
// of the app (logging, scaling, display) stays source-agnostic:
//   { id, name, source: 'library' | 'nutritionix', brand,
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

import { uid, todayStr, round } from "../lib/helpers.js";

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
    try {
      const res = await fetch(`/api/nutritionix/instant?query=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return [...(data.branded || []).map(brandedToCanonical), ...(data.common || []).map(commonToStub)];
    } catch {
      return []; // proxy unreachable or key not configured yet — no-op gracefully
    }
  },
  // Resolves full nutrients for a detail-pending ("common") stub.
  async getDetail(stub) {
    const res = await fetch("/api/nutritionix/nutrients", {
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

const PROVIDERS = [libraryProvider, nutritionixProvider];

// Fans out to every enabled provider in parallel and returns results keyed
// by provider id, each item tagged with its source. No ranking, no
// cross-source de-duplication — per the design doc, the user sees and
// chooses between all matches.
export async function searchAllProviders(query, { libraryFoods }) {
  const [library, nutritionix] = await Promise.all([
    Promise.resolve(libraryProvider.search(query, libraryFoods)),
    nutritionixProvider.search(query),
  ]);
  return { library, nutritionix };
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
