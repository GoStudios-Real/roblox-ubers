# Map research: Brookhaven RP & Welcome to Bloxburg

Research used to build the ROBLOX UBERS tracking map (SVG, 0–1000 coordinate space).

## Sources

- Brookhaven official site — https://www.brookhavenrp.com/discover (iconic locations) and /guides/locations-worth-knowing
- Brookhaven game page — https://www.roblox.com/games/4924922222 (placeId `4924922222`, universe `1686885941`)
- Bloxburg official site — https://heybloxburg.com/about
- Bloxburg wiki — https://welcome-to-bloxburg.fandom.com/wiki/Bloxburg and `/wiki/Minimap` (full POI + bus stop list)
- Bloxburg interactive maps — https://welcome-to-bloxburg.fandom.com/wiki/Special:AllMaps (2016-2018 / 2018-2025 / 2025 layouts)
- Bloxburg game page — https://www.roblox.com/games/185655149 (placeId `185655149`)

### Why the site draws its own map instead of embedding screenshots

Official map screenshots are copyrighted art, and hotlinked wiki images break or get rate-limited.
So the dashboard renders an **original SVG map** whose zones and landmarks come from the research
below, and pulls **game art from Roblox's own Thumbnails API** (`thumbnails.roblox.com`) for the
Roblox API tab — always fresh, always allowed.

## Brookhaven RP — tracked landmarks

| Category | Locations |
|---|---|
| Landmark | Town Fountain (spawn), Town Lake |
| Medical | St Luke's Hospital, Pet Hospital |
| Service | Fire Station, Police Station, Post Office, Car Wash, **The Prison (Aug 2026 update)** |
| Education | Brookhaven High School |
| Shops | Haven Plaza (the mall), Grocery Store, Brookhaven Bank |
| Transport | Airport Hangar, Gas Station |
| Fun | The Beach, Arcade, Museum, Spooky Mansion, Cemetery |
| New (2026) | Adoption Center, Pet Hospital, Post Office cluster near the Museum |
| WiFi hotspots | Downtown, Haven Plaza, Beach, Airport |

**Districts used as zones:** Residential, Downtown, Airport, Suburban, Commercial, Industrial, Beach & Lake, Hills.

**Routes:** Downtown Loop (bus), Airport Express (bus), Beach Route (taxi), Prison Run (taxi), Residential (car), Highway 7 (car).

## Welcome to Bloxburg — tracked landmarks

| Category | Locations |
|---|---|
| Landmark | Bloxburg Town Hall, Peak Mountain, Meh-Meh Falls, Cape Beacon Lighthouse, Greenfield Plains |
| Shops | BFF Supermarket, Fancy Furniture, Stylez Hair Studio, Fiona's Flowers, Gazblox, Mike's Motors |
| Food/jobs | Blox Burgers, Pizza Planet, Ben's Ice Cream |
| Fun | Movie Theater, Beat Nightclub, Ferris Wheel, Pier, Riverside Park, Community Pool, Graveyard, Starlight Observatory |
| Education | Bloxburg High School (Billygoat High), Bloxburg Gym |
| Transport | Bloxburg Central bus stop, Gazblox, Mike's Motors, rental bike stands |
| WiFi hotspots | City Centre, Pier, Peak Mountain, Beach |

**Districts used as zones:** Peak Mountain, City Centre, Greenfield, Riverside, Downtown, Industrial, Beach & Pier, Sunset Pointe.

**Bus routes modelled from the wiki minimap stops:** Bloxburg Central, Billygoat High, Riverside Estates,
Lakeview Heights, Ocean Avenue, Sunset Pointe, Cape Beacon, Starlight Observatory, Bloxy Acres,
Peak Mountain, Riverside Park.

**Routes:** Central Circle (bus), Coastal Line (bus), Mountain Route (bus), Downtown Dash (taxi),
Late Night Run (taxi), Suburban Cruise (car), Innerloop Highway (car).

## Live data (no scraping)

- `games.roblox.com/v1/games?universeIds=` → playing now, visits, favorites, max players, update time
- `games.roblox.com/v1/games/votes?universeIds=` → up/down votes → approval rating
- `thumbnails.roblox.com/v1/places/icons?placeIds=` → game icon image
- `apis.roblox.com/universes/v1/places/:placeId/universe` → place → universe resolution
- `apis.roblox.com/cloud/v2/...` with `x-api-key` → Open Cloud key validation

All cached for 60s in the server.
