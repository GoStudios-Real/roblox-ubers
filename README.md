# ROBLOX UBERS

Live **car / bus / taxi tracking** for Roblox roleplay games — built around **Brookhaven RP** and **Welcome to Bloxburg**, with **free WiFi hotspots**, **OpenRouter AI support**, **Stripe payments** and the **Roblox API**.

![status](https://img.shields.io/badge/status-live-brightgreen)

## Features

| Feature | What it does |
|---|---|
| 🗺️ Live Map | Pan-free SVG map of Brookhaven + Bloxburg with researched POIs, zones, routes and moving vehicles (updates every 2s) |
| 🚗🚌🚕 Tracking | Cars, buses and taxis with plate, driver, route, ETA and rating — plus **real vehicles reported from your Roblox place** |
| 📶 Free WiFi | Every hotspot on the map issues a free 30-minute access code (`POST /api/wifi/connect`) |
| 🤖 AI Support | Chat support via **OpenRouter** (`openai/gpt-4o-mini` by default) |
| 💳 Stripe | Premium plans (Rider / Driver / Fleet) with hosted Checkout |
| 🎮 Roblox API | Live playing/visits/favorites/rating + game icons from the official Roblox Games & Thumbnails APIs, plus Open Cloud key check |
| 🔌 Roblox script | `roblox/UBERS_VehicleTracker.server.lua` — drop into ServerScriptService and your vehicles appear on the site |

## Quick start

```bash
npm install
cp .env.example .env    # add your keys
npm start               # http://localhost:3000
npm test                # 11-check smoke test (server + every integration)
```

Deep links: `/#map` `/#wifi` `/#ai` `/#premium` `/#roblox` `/#integrate`

## .env

```env
PORT=3000
BASE_URL=http://localhost:3000
TRACKING_TOKEN=<long random string>
OPENROUTER_API_KEY=...       # https://openrouter.ai/keys
OPENROUTER_MODEL=openai/gpt-4o-mini
STRIPE_SECRET_KEY=sk_test_...  # use test keys while developing
STRIPE_CURRENCY=usd
ROBLOX_API_KEY=...           # optional, Create > Credentials (Open Cloud)
```

> ⚠️ `.env` is gitignored. Never commit real keys — if a key leaks, roll it immediately.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Server + integration status |
| GET | `/api/maps` · `/api/maps/:id` | Map, zone, POI and route data |
| GET | `/api/tracking?map=brookhaven` | Live vehicle positions |
| POST | `/api/tracking/ping` | Roblox place reports vehicles (header `x-ubers-token`) |
| GET | `/api/roblox/games?placeIds=4924922222,185655149` | Roblox game stats |
| GET | `/api/roblox/key-status` | Validate your Open Cloud key |
| POST | `/api/ai/chat` | OpenRouter AI support |
| GET | `/api/billing/plans` · POST `/api/billing/checkout` | Stripe |
| GET | `/api/wifi/hotspots` · POST `/api/wifi/connect` · GET `/api/wifi/status` | Free WiFi |

## Roblox integration

1. Copy `roblox/UBERS_VehicleTracker.server.lua` into **ServerScriptService**.
2. Set `BASE_URL` and `TRACKING_TOKEN` (same value as your server `.env`).
3. Tag vehicle models with the `UBERS_Vehicle` attribute (or name them with `bus` / `taxi` / `car`).
4. Positions appear on the live map within `REPORT_EVERY` seconds.

## Map research

See [docs/MAPS_RESEARCH.md](docs/MAPS_RESEARCH.md) for the Brookhaven and Bloxburg location research (POIs, bus stops, routes) used to build the tracking map.

## Notes

- Fan-made project, not affiliated with Roblox Corporation.
- Stripe Checkout requires an activated Stripe account (`charges_enabled`).
