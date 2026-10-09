# ROBLOX UBERS

Live **car / bus / taxi tracking** for Roblox roleplay games — built around **Brookhaven RP** and **Welcome to Bloxburg**, with **free WiFi hotspots**, **OpenRouter AI support**, **Stripe payments** and the **Roblox API**.

![status](https://img.shields.io/badge/status-live-brightgreen)

## Features

| Feature | What it does |
|---|---|
| 🗺️ Live Map | Pan-free SVG map of Brookhaven + Bloxburg with researched POIs, zones, routes, and live player/vehicle overlays (updates every 2s) |
| 🚗🚌🚕 Tracking | Cars, buses, and taxis with plate, driver, route, ETA and rating — plus positions reported from a Roblox experience you own |
| 👤 Player map | Anonymous player positions grouped by game map/server; expires after 20 seconds, with per-player opt-out |
| 📶 Free WiFi | Every hotspot on the map issues a free 30-minute access code (`POST /api/wifi/connect`) |
| 🤖 AI Support | Chat support via **OpenRouter** (`openai/gpt-4o-mini` by default) |
| 💳 Stripe | Premium plans (Rider / Driver / Fleet) with hosted Checkout |
| 🎮 Roblox API | Live playing/visits/favorites/rating + game icons from the official Roblox Games & Thumbnails APIs, plus Open Cloud key check |
| 🔌 Roblox script | `roblox/UBERS_VehicleTracker.server.lua` — reports anonymous player positions and tagged vehicles from your own experience |

## Quick start

```bash
npm install
cp .env.example .env    # add your keys
npm start               # http://localhost:3000
npm test                # 11-check smoke test (server + every integration)
```

## GitHub Pages and Windows app

The GitHub Pages site at <https://gostudios-real.github.io/roblox-ubers/> is a static demo with sample players and vehicles. Demo WiFi codes do not provide internet access; AI support, live Roblox stats, and Stripe checkout require the full server. Pages cannot receive Roblox reports.

To build the Windows executable locally, run `npm ci` and `npm run package:exe`. The portable `dist/ROBLOX-UBERS.exe` starts the full server and opens it in your browser; keep its console window open while using the app. Configure integrations in a `.env` file beside the executable. Publishing a `v*` tag builds the executable and attaches it to a GitHub Release.

### Real Roblox player positions

Roblox's public Games API reports aggregate player counts, **not a player's location inside a game or its individual server roster**. Live position dots therefore require installing `roblox/UBERS_VehicleTracker.server.lua` in a Roblox experience you own and running this app's server at a publicly reachable HTTPS address. The official Brookhaven and Bloxburg experiences are third-party games; this project cannot install scripts in their servers or read their live player positions. The existing map illustrations are approximations, so configure the script's world bounds to match your experience before using position overlays.

1. Generate a long random token with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, set it as `TRACKING_TOKEN` in the server `.env` and Roblox script, and publish the Node server at a public HTTPS URL. A local-only Windows app/GitHub Pages address cannot receive requests from Roblox servers.
2. Enable HTTP requests for your Roblox experience. Copy `roblox/UBERS_VehicleTracker.server.lua` to `ServerScriptService`, set `BASE_URL`, the matching token and `MAP_ID`, and configure `WORLD_MIN_X`, `WORLD_MAX_X`, `WORLD_MIN_Z`, and `WORLD_MAX_Z` for the world.
3. Publish and start your experience. The server reports anonymous positions every five seconds; the map refreshes every two seconds and removes reports after 20 seconds. Set a player instance's `UBERS_TrackingOptOut` attribute to `true` to omit them.

The server uses player account IDs only to create an HMAC pseudonym for refreshing dots; it never returns account IDs, usernames, or Roblox server IDs to the browser. Reports are held in memory and expire when the server stops or the 20-second heartbeat is missed. Make tracking clear to players in your experience.

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
| GET | `/api/players?map=brookhaven` | Recent anonymous player positions and active game-server count |
| POST | `/api/players/ping` | Roblox server submits its player position snapshot (`x-ubers-token`) |
| GET | `/api/roblox/games?placeIds=4924922222,185655149` | Roblox game stats |
| GET | `/api/roblox/key-status` | Validate your Open Cloud key |
| POST | `/api/ai/chat` | OpenRouter AI support |
| GET | `/api/billing/plans` · POST `/api/billing/checkout` | Stripe |
| GET | `/api/wifi/hotspots` · POST `/api/wifi/connect` · GET `/api/wifi/status` | Free WiFi |

## Roblox integration

Install the script only in an experience you own, using the public-server and coordinate setup above. Tag vehicle models with the `UBERS_Vehicle` attribute (or name them with `bus` / `taxi` / `car`) to report vehicles too.

## Map research

See [docs/MAPS_RESEARCH.md](docs/MAPS_RESEARCH.md) for the Brookhaven and Bloxburg location research (POIs, bus stops, routes) used to build the tracking map.

## Notes

- Fan-made project, not affiliated with Roblox Corporation.
- Stripe Checkout requires an activated Stripe account (`charges_enabled`).
