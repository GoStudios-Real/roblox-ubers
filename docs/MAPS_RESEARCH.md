# Original test-place maps

The app's two map slots are fictional prototypes for separate Roblox
experiences: a Brookhaven-inspired roleplay city and a Bloxburg-inspired
neighborhood town. They use original landmark labels and do not link to the
official experiences by default.

## Prototype layout

Map coordinates use a `0..1000` range on both axes. The plotted locations and
route stops are illustrative placeholders for the block-built environment in
[`roblox/UBERS_FakeTown_Starter.server.lua`](../roblox/UBERS_FakeTown_Starter.server.lua).
Before testing rides, adjust `lib/maps.js` POIs, roads/routes, and the Luau
dispatcher world bounds to match the experience you own.

The city map has a town plaza, civic buildings, shops, an airfield, shoreline,
and memorial park. The neighborhood map has a town center, shops, a mountain
trail, green spaces, and a pier. Both include example bus, taxi, and car loops.

## Roblox API

Live game and public-server data is fetched only for place IDs configured in
the server `.env` as `ROBLOX_UBERS_PLACE_ID_BROOKHAVEN` and
`ROBLOX_UBERS_PLACE_ID_BLOXBURG`. No official third-party place IDs are used as
fallbacks. The public endpoints used by the app are:

- `apis.roblox.com/universes/v1/places/:placeId/universe` for place resolution
- `games.roblox.com/v1/games?universeIds=` for aggregate game statistics
- `games.roblox.com/v1/games/votes?universeIds=` for votes and rating
- `thumbnails.roblox.com/v1/games/icons?universeIds=` for game icons
- `games.roblox.com/v1/games/:placeId/servers/Public` for public server listings
