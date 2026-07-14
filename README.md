# The Log

A personal training log — strength, cardio, and nutrition tracking with a
progression chart, full history, and an analytics view. Built with React and
Vite; data persists in the browser via `localStorage`.

Nutrition food search fans out to four sources behind a common provider
interface: your personal food library (always on, no key needed), Nutritionix
and USDA FoodData Central (both optional, need a free key — see below), and
Open Food Facts (optional, no key needed). Selecting an external result
caches a copy into your library on first use, so it's available offline
afterwards. You can also build **meals** — a named, flat set of foods and
quantities, saved once and logged as a single line repeatedly.

## Develop

```
npm install
npm run dev
```

This runs the Vite dev server only. Food search works against your personal
library and Open Food Facts either way; Nutritionix and USDA results require
the proxy server (below).

## Optional food sources

Nutritionix and USDA are proxied through a small local server so their API
keys never ship to the browser. Open Food Facts needs no key and is called
directly from the browser. Without any of them configured, the app works
exactly the same, just without those external search results.

1. Nutritionix: free dev tier (500 calls/day) at nutritionix.com/business/api.
2. USDA FoodData Central: free key at fdc.nal.usda.gov/api-key-signup.html.
3. `cp .env.example .env` and fill in whichever keys you have.
4. Run the proxy in one terminal: `npm run server` (listens on :8787).
5. Run the app in another: `npm run dev` (proxies `/api/*` to :8787).

## Build

```
npm run build
npm run preview
```

## Production (single process)

`npm run build` then `npm start` serves the built site and the proxy from one
Node process on `PORT` (default 8787).
