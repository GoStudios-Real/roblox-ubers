# ROBLOX UBERS / GoStudios Of Roblox Transport

An Uber-inspired app with **real human drivers** for Roblox. Every map is **generated from a Roblox profile's public games** (load any username from the site, or set `ROBLOX_PROFILE_USERNAME`), so routes, stops, and WiFi hotspots come straight from the games you already own or play. Plan in-game rides, reserve and manage seats, claim driving jobs, and use **free WiFi hotspots**, **OpenRouter AI support**, and **Stripe** integrations.

![status](https://img.shields.io/badge/status-live-brightgreen)

## Features

| Feature | What it does |
|---|---|
| 🎮 Profile Games | Maps are generated from any Roblox profile's public games (username or `group:<id>`); deterministic zones, POIs, routes, and WiFi per game |
| 🗺️ Map | Generated city layouts with POIs, zones, and routes per profile game; position overlays only appear when reported by an experience you own |
| 🚗🚌🚕 Tracking | Real car, bus, and taxi positions reported from a Roblox experience you own; no generated vehicles |
| 👤 Player map | Anonymous player positions from a connected Roblox experience you own; expires after 20 seconds, with per-player opt-out |
| 📶 Free WiFi | Every hotspot on the map issues a free 30-minute access code (`POST /api/wifi/connect`) |
| 🤖 AI Support | Chat support via **OpenRouter** (`openai/gpt-4o-mini` by default) |
| 💳 Stripe | Premium plans (Rider / Driver / Fleet) with hosted Checkout |
| 🎮 Roblox API | Live playing/visits/favorites/rating and public servers for the loaded profile games (their root places); other places are rejected |
| 🔌 Roblox script | `roblox/UBERS_VehicleTracker.server.lua` — reports anonymous player positions and tagged vehicles from your own experience |
| 🗓️ Timetables | 30-minute departures on configured map routes, shown in the visitor's local time |
| 🎟️ Ride bookings | Persistent seat reservations, route capacity checks, private booking references, secure management keys, lookup and cancellation |
| 🧑‍✈️ Drive jobs | Real players claim open bookings on the Drive tab, get a private hashed driver code, and post live ride statuses (on the way → at pickup → picked up → completed) that update the rider's booking bar |
| 🔊 Sound effects | Original synthesized interface tones for navigation and notifications, with a saved opt-in sound toggle |
| 🚘 Owner-run driver scripts | Dispatches a configured vehicle in an experience whose owner installs `roblox/UBERS_Dispatch.server.lua` |
| ❔ Help & terms | In-app FAQ, terms, privacy details, trademark notices, and a © 2026 notice |
| 🎨 Brand art | Original custom SVG ride icon and city/taxi banner |

Rides are driven by real human players inside Roblox games. They do not arrange real-world transport. Timetables, bookings, and cancellation need the Node server; the static Pages site reports when that API is unavailable.

Owner-installed driver dispatch is an optional integration for **your own Roblox experience** only. Load a profile (the `ROBLOX_PROFILE_USERNAME` default or any username in the Profile Games bar) whose public games include your published place; bookings on that game's map carry its root place ID, and the dispatcher uses it. Adapt the generated POIs/routes to your world if needed. In third-party games like Brookhaven RP, real human drivers claim rides on the Drive tab instead. An attached public profile is not account verification. See [`roblox/README.md`](roblox/README.md) for the Studio starter-world and dispatcher setup.

## Quick start

```bash
npm install
copy .env.example .env  # Windows; add your keys
npm start               # http://localhost:3000
npm test
```

## GitHub Pages and Windows app

The GitHub Pages site at <https://gostudios-real.github.io/roblox-ubers/> contains no fabricated player or vehicle positions. Its public-server counts, game stats, and booking API work when the `UBERS_API_BASE_URL` repository variable points to a running API v2 server's Cloudflare Tunnel HTTPS URL; Pages rejects outdated backends and displays safe static maps until the Windows app is updated. Otherwise live data and booking actions are explicitly unavailable. Pages cannot receive Roblox reports directly. Booking records are stored by the Node server in `data/bookings.json` during development, or `%LOCALAPPDATA%\ROBLOX-UBERS\bookings.json` when packaged as the Windows app. Set `UBERS_DATA_DIR` to choose another server data directory. Back up and protect that folder.

To build the Windows executable locally, run `npm ci` and `npm run package:exe`. The versioned `dist/ROBLOX-UBERS-v1.6.0.exe` starts the full server and opens it in your browser; keep its console window open while using the app. Configure integrations in a `.env` file beside the executable. Publishing a `v*` tag builds the executable and attaches it to a GitHub Release.

The Integrate tab on GitHub Pages offers Notepad-friendly `.txt` downloads of the original town starter, driver dispatch, and vehicle tracker scripts. Rename a downloaded `.txt` file to `.lua` before installing it in Roblox Studio, and only install scripts in an experience you own or are authorized to edit.

### Connect GitHub Pages through Cloudflare Tunnel

1. Install Cloudflare Tunnel (`winget install --id Cloudflare.cloudflared`) and start the app/server on the Windows computer that will stay online.
2. For a temporary URL that requires no Cloudflare account, run `cloudflared tunnel --url http://127.0.0.1:3000`. Copy the `https://…trycloudflare.com` hostname it prints. Keep this command and the app running; Quick Tunnel URLs change when restarted.
3. For a permanent hostname, sign in to a Cloudflare account with a domain you control, create a named Tunnel in the Zero Trust dashboard, and configure its public hostname to forward to `http://127.0.0.1:3000`. Keep the installed `cloudflared` connector running.
4. From the repository folder, run `powershell -ExecutionPolicy Bypass -File .\scripts\start-cloudflare-tunnel.ps1` to create a Quick Tunnel, verify it reaches the local server, save its URL to the repository's `UBERS_API_BASE_URL` Actions variable, and trigger a Pages deployment. Keep the script's tunnel process and the app running. The URL changes if the Quick Tunnel is restarted. For a manually managed or named tunnel, set `UBERS_API_BASE_URL` yourself and run **Deploy GitHub Pages**. The backend allows the published Pages origin by default; set `CORS_ORIGINS` in `.env` only if you need another exact website origin.

Quick Tunnels display a browser interstitial unless requests include Cloudflare's `cf-skip-browser-warning` header; the Pages frontend adds that header for `trycloudflare.com` URLs and the server allows it in CORS preflight. Use a named Tunnel for a stable, always-on deployment. Pages shows **API NOT CONNECTED** until a working tunnel hostname is configured and the site is rebuilt.

### Profile Games (generated maps)

1. Open the Live Map and type a Roblox username in the **Profile Games** bar, or use the one-click chips (`?? Brookhaven RP` loads `group:3104358`, `?? Roblox` loads the official account). Set `ROBLOX_PROFILE_USERNAME` in `.env` to pick the profile loaded on every start (default `group:3104358`; `none` disables it).
2. The server fetches the profile's public games (`games.roblox.com`), enriches them with playing/visits/ratings/icons, and generates a deterministic map per game: stable POI ids (`central`, `plaza`, `depot`, …), four routes (`b1`, `b2`, `c1`, `v1`), zones, and free WiFi hotspots.
3. Maps refresh automatically every 5 minutes (`GET /api/maps` re-resolves the default profile; `GET /api/profile/games?username=…` loads another). Fixture mode for tests: `UBERS_PROFILE_FIXTURE=1`.

Map ids are `game-<universeId>`, so bookings, timetables, tracking, and dispatch stay stable across restarts.

### Always online

Run `START-ALWAYS-ONLINE.cmd` (or `npm run always-online`) to supervise the stack:

- restarts the Node server if it crashes or `/api/health` stops responding,
- restarts the Cloudflare Quick Tunnel if the public URL dies, waits for the new URL, saves it to `UBERS_API_BASE_URL`, and redeploys GitHub Pages when it changes,
- writes a log to `%TEMP%\roblox-ubers-always-online\status.txt`; add `-SkipGitHubPages` to keep the tunnel local-only.

For a stable address, prefer a named Cloudflare Tunnel (step 3 above) and keep `scripts/start-cloudflare-tunnel.ps1` for one-off setup.

### Real Roblox player positions

Roblox's public API reports aggregate player counts and public server counts, but **not player identities or their location inside a game**. Live position dots therefore require installing `roblox/UBERS_VehicleTracker.server.lua` in a Roblox experience you own and running this app's server at a publicly reachable HTTPS address. The official Brookhaven and Bloxburg experiences are third-party games; this project cannot install scripts in their servers or read their live player positions. The map illustrations are approximations, so configure the script's world bounds to match your experience before using position overlays.

1. Generate a long random token with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, set it as `TRACKING_TOKEN` in the server `.env` and Roblox script, and publish the Node server at a public HTTPS URL. A local-only Windows app/GitHub Pages address cannot receive requests from Roblox servers.
2. Enable HTTP requests for your Roblox experience. Copy `roblox/UBERS_VehicleTracker.server.lua` to `ServerScriptService`, set `BASE_URL`, the matching token and `MAP_ID`, and configure `WORLD_MIN_X`, `WORLD_MAX_X`, `WORLD_MIN_Z`, and `WORLD_MAX_Z` for the world.
3. Publish and start your experience. The server reports anonymous positions every five seconds; the map refreshes every two seconds and removes reports after 20 seconds. Set a player instance's `UBERS_TrackingOptOut` attribute to `true` to omit them.

The server uses player account IDs only to create an HMAC pseudonym for refreshing dots; it never returns account IDs, usernames, or Roblox server IDs to the browser. Reports are held in memory and expire when the server stops or the 20-second heartbeat is missed. Make tracking clear to players in your experience.

### Owner-controlled driver dispatch

This integration does not operate in third-party experiences such as official Brookhaven or Bloxburg — real human drivers claim those rides on the Drive tab. To try owner dispatch, open a new experience you own in Roblox Studio, run `roblox/UBERS_FakeTown_Starter.server.lua` from `ServerScriptService`, and publish it. Load a profile whose public games include that place (its `rootPlaceId` becomes the map's `placeId`), so bookings, join links, game stats, and dispatch all point at your own place. Configure route POIs and world bounds to match your experience. The dispatch server script must run in the same place configured for the booking. The public Roblox profile lookup is not authentication; only the Roblox account with the looked-up user ID can board in-game.

Install and configure `roblox/UBERS_Dispatch.server.lua` in your experience's `ServerScriptService`. Enable HTTP requests, give the server script the server's public HTTPS URL and the same secret `TRACKING_TOKEN`, and follow the vehicle/seat/depot setup in [`roblox/README.md`](roblox/README.md). Do not put the tracking token in a LocalScript, client UI, or a public repository. A ride dispatches in a 15-minute early to 30-minute late window; the rider must join that same server and board within three minutes after pickup arrival. The sample driver moves a configured vehicle in a straight line between map coordinates; it is a basic integration example, not Roblox pathfinding or tested vehicle physics.

### Driver jobs (real players, no bots)

Third-party experiences such as Brookhaven RP cannot be scripted from outside — a "bot" driving there would require a script executor, which violates Roblox's terms and risks permanent bans and malware. Driver jobs are the legitimate alternative: open the **Drive** tab, claim an open booking, and you get a private driver code (SHA-256 hash stored; shown once; kept in the browser's local storage). Join the game with the join button, meet the rider at the pickup stop with a car, taxi or bus, and advance the status buttons. The rider's booking page polls every 15 seconds, so the rider's Ride tracking bar reflects your progress live. Claimed rides are locked out of the owner dispatcher and other drivers; releasing returns the job to the open list. The public Roblox API cannot place driver and rider into one specific server, so both sides should pick the same public server from the Roblox API tab.

### Stripe Premium setup

Hosted Checkout requires a private `STRIPE_SECRET_KEY` and a fully onboarded Stripe account. If Stripe reports required business, registration/tax, payout, or terms details, the account owner must enter truthful information in the [Stripe Dashboard onboarding page](https://dashboard.stripe.com/get-started). This project cannot fill in or bypass identity, legal, tax, or payout verification.

#### BloxBot AI

[BloxBot AI v0.13.7](https://github.com/paralov/app-bloxbot-ai/releases/tag/v0.13.7) can assist an experience creator inside Roblox Studio using Studio's official MCP integration. It is a Studio development assistant, **not a running-game bot or live player client**. Use it to author and test your own vehicle assets and adapt the owner-installed dispatcher; it cannot join or inject bots into Brookhaven or Bloxburg. This repository does not bundle BloxBot.

Deep links: `/#book` `/#myrides` `/#map` `/#wifi` `/#ai` `/#premium` `/#roblox` `/#integrate` `/#faq` `/#legal`

## .env

```env
PORT=3000
BASE_URL=http://localhost:3000
TRACKING_TOKEN=<long random string>
OPENROUTER_API_KEY=...       # https://openrouter.ai/keys
OPENROUTER_MODEL=openai/gpt-4o-mini
STRIPE_PUBLISHABLE_KEY=pk_test_... # public key; not used by hosted Checkout
STRIPE_SECRET_KEY=sk_test_...  # use test keys while developing
STRIPE_CURRENCY=usd
ROBLOX_PROFILE_USERNAME=Roblox  # default profile whose public games become maps
ROBLOX_API_KEY=...           # optional, Create > Credentials (Open Cloud)
ROBLOX_UBERS_UNIVERSE_ID=    # optional override for key-status checks
```

> ⚠️ `.env` is gitignored. Never commit real keys — if a key leaks, roll it immediately.

The browser-safe Stripe publishable key (`pk_…`) is optional for future
client-side Stripe integrations and does not activate payments by itself.
Hosted Checkout requires the private server-side `STRIPE_SECRET_KEY` (`sk_…`);
keep it only in the server's private environment.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Server + integration status |
| GET | `/api/maps` · `/api/maps/:id` | Map, zone, POI and route data |
| GET | `/api/rides/timetable?map=game-90010001&routeId=b1` | Available 30-minute departures and remaining seats for the next 7 days |
| POST | `/api/bookings` | Reserve 1–4 seats; returns a booking reference and a private management key once |
| POST | `/api/bookings/:reference/lookup` | Private booking lookup (`manageKey` in request body) |
| POST | `/api/bookings/:reference/profile` | Attach a public Roblox profile to a future scheduled ride (`manageKey` in request body) |
| DELETE | `/api/bookings/:reference` | Cancel a future booking (`manageKey` in request body) |
| GET | `/api/jobs?map=game-90010001` | Open driver jobs (bookings without a driver; no secrets) |
| POST | `/api/jobs/:reference/claim` | Claim a job as driver; returns private `driverCode` (64-hex, shown once) |
| GET | `/api/jobs/driver?code=...` | Driver's claimed job (`driverCode` in query) |
| POST | `/api/jobs/:reference/status` | Driver status update: `claimed → enroute → arrived → picked_up → completed` or `failed` (`driverCode` + `status` in body) |
| POST | `/api/jobs/:reference/release` | Release a claimed job back to the open list (`driverCode` in body) |
| GET | `/api/roblox/dispatch/next?map=game-90010001` | Owner-installed game server checks for a due ride (tracking token required) |
| POST | `/api/roblox/dispatch/claim` · `/api/roblox/dispatch/:reference/status` | Claim a ride and update its dispatch state (tracking token required) |
| GET | `/api/tracking?map=game-90010001` | Live vehicle positions |
| POST | `/api/tracking/ping` | Roblox place reports vehicles (header `x-ubers-token`) |
| GET | `/api/players?map=game-90010001` | Recent anonymous player positions and active game-server count |
| POST | `/api/players/ping` | Roblox server submits its player position snapshot (`x-ubers-token`) |
| GET | `/api/roblox/games` | Roblox game stats for the loaded profile-game places only |
| GET | `/api/roblox/servers?placeId=<profile-game-place-id>` | Up to 100 live public servers for a loaded profile game |
| GET | `/api/roblox/key-status` | Validate your Open Cloud key |
| POST | `/api/ai/chat` | OpenRouter AI support |
| GET | `/api/billing/plans` · POST `/api/billing/checkout` | Stripe |
| GET | `/api/wifi/hotspots` · POST `/api/wifi/connect` · GET `/api/wifi/status` | Free WiFi |

## Roblox integration

Install the script only in an experience you own, using the public-server and coordinate setup above. Tag vehicle models with the `UBERS_Vehicle` attribute (or name them with `bus` / `taxi` / `car`) to report vehicles too.

## Map research

See [docs/MAPS_RESEARCH.md](docs/MAPS_RESEARCH.md) for original test-place map labels, prototype routes, and Roblox API behavior.

## Notes

- ROBLOX UBERS / GoStudios Of Roblox Transport · Real Human Drivers. Third-party names and marks belong to their owners.
- ROBLOX UBERS is not claimed as a registered trademark. Original interface artwork © 2026 GoStudios-Real; code is provided under this repository's MIT License.
- Stripe Checkout requires an activated Stripe account (`charges_enabled`).
