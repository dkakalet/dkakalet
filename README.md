# The Log

A personal training log — strength, cardio, and nutrition tracking with a
progression chart, full history, and an analytics view. Built with React and
Vite; data persists in the browser via `localStorage`.

Nutrition food search draws on two sources behind a common provider
interface: your personal food library (always on) and Nutritionix (optional —
see below). Selecting an external result caches a copy into your library on
first use, so it's available offline afterwards.

## Develop

```
npm install
npm run dev
```

This runs the Vite dev server only. Food search will work against your
personal library; Nutritionix results require the proxy server (below).

## Nutritionix (optional)

Nutritionix search is proxied through a small local server so the API key
never ships to the browser. Without it configured, the app works exactly the
same, just without the external search results.

1. Sign up for a free key (500 calls/day) at nutritionix.com/business/api.
2. `cp .env.example .env` and fill in `NUTRITIONIX_APP_ID` / `NUTRITIONIX_API_KEY`.
3. Run the proxy in one terminal: `npm run server` (listens on :8787).
4. Run the app in another: `npm run dev` (proxies `/api/*` to :8787).

## Build

```
npm run build
npm run preview
```

## Production (single process)

`npm run build` then `npm start` serves the built site and the Nutritionix
proxy from one Node process on `PORT` (default 8787).
