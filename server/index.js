// Minimal proxy: keeps the Nutritionix API key server-side and forwards
// search/detail requests from the client. Also serves the built site in
// production so the whole app is a single deployable Node process.
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

const { NUTRITIONIX_APP_ID, NUTRITIONIX_API_KEY, USDA_API_KEY, PORT = 8787 } = process.env;
const configured = Boolean(NUTRITIONIX_APP_ID && NUTRITIONIX_API_KEY);
const usdaConfigured = Boolean(USDA_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());

if (!configured) {
  console.warn(
    "[nutritionix-proxy] NUTRITIONIX_APP_ID / NUTRITIONIX_API_KEY not set — " +
      "/api/nutritionix/* will return 503 until they're added to .env (see .env.example)."
  );
}
if (!usdaConfigured) {
  console.warn(
    "[usda-proxy] USDA_API_KEY not set — /api/usda/* will return 503 until it's added to .env (see .env.example)."
  );
}

const nixHeaders = () => ({
  "Content-Type": "application/json",
  "x-app-id": NUTRITIONIX_APP_ID,
  "x-app-key": NUTRITIONIX_API_KEY,
});

// Instant search: powers the live "as you type" results list.
app.get("/api/nutritionix/instant", async (req, res) => {
  const query = String(req.query.query || "").trim();
  if (!query) return res.json({ common: [], branded: [] });
  if (!configured) return res.status(503).json({ error: "not_configured", common: [], branded: [] });
  try {
    const url = `https://trackapi.nutritionix.com/v2/search/instant?query=${encodeURIComponent(query)}`;
    const r = await fetch(url, { headers: nixHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: "upstream_error", common: [], branded: [] });
    const data = await r.json();
    res.json({ common: data.common || [], branded: data.branded || [] });
  } catch (e) {
    res.status(502).json({ error: "proxy_fetch_failed", common: [], branded: [] });
  }
});

// Natural-language nutrient lookup: resolves full macros for a chosen
// "common" food (instant search doesn't include nutrients for those).
app.post("/api/nutritionix/nutrients", async (req, res) => {
  const query = String(req.body?.query || "").trim();
  if (!query) return res.status(400).json({ error: "missing_query", foods: [] });
  if (!configured) return res.status(503).json({ error: "not_configured", foods: [] });
  try {
    const r = await fetch("https://trackapi.nutritionix.com/v2/natural/nutrients", {
      method: "POST",
      headers: nixHeaders(),
      body: JSON.stringify({ query }),
    });
    if (!r.ok) return res.status(r.status).json({ error: "upstream_error", foods: [] });
    const data = await r.json();
    res.json({ foods: data.foods || [] });
  } catch (e) {
    res.status(502).json({ error: "proxy_fetch_failed", foods: [] });
  }
});

// USDA FoodData Central search — nutrients come back per-100g directly, no
// follow-up "detail" call needed (unlike Nutritionix's common foods).
app.get("/api/usda/search", async (req, res) => {
  const query = String(req.query.query || "").trim();
  if (!query) return res.json({ foods: [] });
  if (!usdaConfigured) return res.status(503).json({ error: "not_configured", foods: [] });
  try {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(USDA_API_KEY)}&query=${encodeURIComponent(query)}&pageSize=10`;
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error: "upstream_error", foods: [] });
    const data = await r.json();
    res.json({ foods: data.foods || [] });
  } catch (e) {
    res.status(502).json({ error: "proxy_fetch_failed", foods: [] });
  }
});

app.use(express.static(distDir));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(distDir, "index.html"), (err) => { if (err) next(); });
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT} (Nutritionix ${configured ? "configured" : "NOT configured"})`);
});
