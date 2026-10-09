# Owner-controlled NPC ride dispatch

This is a server-side example for an original Roblox experience you own and
publish, including your own Brookhaven-style or Bloxburg-inspired test place.
It does not join, automate, or modify the official Brookhaven RP or Welcome to
Bloxburg games. Their owners would have to authorize and install any equivalent
integration.

## Requirements

- A public HTTPS address for the ROBLOX UBERS Node server (for example a running
  Cloudflare Tunnel).
- `TRACKING_TOKEN` configured on that Node server and the same secret entered in
  the server script. Keep the token out of LocalScripts and client-visible UI.
- HTTP requests enabled in the Roblox experience's security settings.
- An experience-specific copy of `UBERS_Dispatch.server.lua` in
  `ServerScriptService`, with `BASE_URL`, `TRACKING_TOKEN`, and `MAP_ID` configured.
- An owned or authorized Roblox place ID configured as
  `ROBLOX_UBERS_PLACE_ID_BROOKHAVEN` or `ROBLOX_UBERS_PLACE_ID_BLOXBURG` in the
  Node server's `.env`. These variables point bookings at your participating
  original experiences. If blank, game stats, joins, and dispatch are disabled;
  official third-party games are never used as fallbacks. Adapt the map POIs,
  route stops, and world bounds to the original experience you control.

For two separate test experiences, publish each place and set its numeric place
ID on the matching variable in `.env`:

```env
ROBLOX_UBERS_PLACE_ID_BROOKHAVEN=<your Brookhaven-style original place ID>
ROBLOX_UBERS_PLACE_ID_BLOXBURG=<your Bloxburg-inspired original place ID>
```

In each Roblox place, install the vehicle tracker and dispatcher scripts from
this repository in `ServerScriptService`. Set `MAP_ID` to `brookhaven` in the
first place and `bloxburg` in the second, use the same server URL and
`TRACKING_TOKEN`, and configure world bounds separately for each actual map.
The app's sample POIs and route lines are illustrative; edit `lib/maps.js` to
match each original world before testing rides. Use original names, assets, and
branding and do not present either experience as the official game.

## Starter town with homes and vehicles

In a new Roblox Studio place you own, remove the default `Baseplate`, copy
`UBERS_FakeTown_Starter.server.lua` into `ServerScriptService` as a normal server
`Script`, and press Play. It builds
a small original town with a road grid, 16 simple houses, a park, three drivable
demo vehicles, and `ServerStorage/UBERSVehicles` templates for car, bus, and
taxi rides. It also creates the `UBERSDepot` part used by the dispatcher.

Publish one place for each app map slot. Change the script's `MAP_ID` to
`bloxburg` in the Bloxburg-inspired place. These block-built houses and vehicles
are a starter prototype; customize them in Studio before publishing. Demo vehicle
movement is kinematic and intended for testing, not realistic vehicle physics.
The dispatch NPC models are generated from Roblox's default R15 rig and appear
when the server dispatcher starts an actual booked ride. Set each place's
numeric ID in the server `.env`; without those IDs, the app deliberately offers
no Roblox game joins or live game statistics.

## Vehicle template

In `ServerStorage`, create a folder named `UBERSVehicles` and add `car`, `bus`,
and/or `taxi` Models. Each selected model needs:

- A `PrimaryPart`.
- A `Driver` NPC Model containing a `Humanoid`.
- A `VehicleSeat` named `DriverSeat`.
- A `Seat` or `VehicleSeat` named `PassengerSeat`.

Add a `BasePart` called `UBERSDepot` in `Workspace`. The example clones the
configured vehicle, moves it from the depot to the booking's pickup and drop-off
map coordinates, and removes it after the ride. The sample motion uses straight
line CFrame updates: it does not implement road/pathfinding navigation, traffic,
or production vehicle physics. Test with a disposable experience and adjust the
movement for your map before inviting players.

At pickup, the dispatcher waits up to three minutes for the Roblox account
resolved from the booking's public username lookup to join that same game server,
then seats that player's character. Profile lookup is public data, not sign-in or
account ownership verification. Do not promise a ride until the experience owner
has installed and tested the integration.

## BloxBot AI v0.13.7

[BloxBot AI](https://github.com/paralov/app-bloxbot-ai/releases/tag/v0.13.7) is
a Roblox Studio development assistant that works with Studio's official MCP
server. It can help an authorized creator make or edit assets/scripts in an open
Studio project. It is not a live-game bot runtime, player client, or a way to
spawn a bot in another creator's game. This project does not download or bundle
BloxBot.

An example prompt to use in Studio after you have opened your own experience:

> In this experience that I own, help me create a test vehicle Model in
> ServerStorage/UBERSVehicles with a PrimaryPart, a Driver NPC Humanoid in a
> VehicleSeat named DriverSeat, and a separate Seat named PassengerSeat. Add a
> UBERSDepot part in Workspace. Keep all assets original and explain each setup
> step. Do not publish changes or add scripts to any experience I do not own.

Review and test any generated assets and code yourself. BloxBot does not run the
ride dispatcher; that is the separately reviewed server Script described above.

## Roblox bot-client research (not integrated)

[pyrobloxbot v2.2.3](https://github.com/Mews/pyrobloxbot/releases/tag/v.2.2.3)
is a separate, Windows-only Python library that automates a Roblox player
through keyboard input. Its project documentation describes joining games and
servers, character movement and chat, and support for multiple accounts. The
Roblox window must be active for its simulated key input; it is not a
server-side NPC framework or a headless game server. The v2.2.3 release has no
downloadable release assets.

This project does not install, bundle, launch, or control pyrobloxbot. For your
own original test places, use the owner-installed NPC dispatcher above instead
of simulating a player account. A keyboard-driven player account is not an NPC
owned by the experience. The official Brookhaven RP and Welcome to Bloxburg
games still require their creators' approval and an integration provided by
those creators. Do not put Roblox account passwords or session cookies in this
project.

Use the integration that matches the intended task:

| Goal | Appropriate tool |
|---|---|
| Create or edit NPC and vehicle assets/scripts in an experience you control | Roblox Studio and its [official MCP server](https://create.roblox.com/docs/studio/mcp); BloxBot AI can act as a Studio authoring client |
| Run an NPC driver inside an experience you control | A reviewed server-side Luau Script installed by that experience's creator, such as `UBERS_Dispatch.server.lua` |
| Manage supported Roblox resources over REST | [Roblox Open Cloud](https://create.roblox.com/docs/cloud), using its documented API-key or OAuth authentication |
| Automate a desktop Roblox player account | pyrobloxbot; not used by UBERS and not a substitute for an authorized server NPC |

Roblox Studio MCP operates on the open Studio project; it does not connect an
AI to a live third-party game server. Roblox Open Cloud provides documented
REST APIs for supported resources; it does not turn an external app into an
NPC/player inside an unrelated experience. See Roblox's [HttpService
guidance](https://create.roblox.com/docs/cloud-services/http-service) for
creator-authorized server integrations.

Sources: [pyrobloxbot README](https://github.com/Mews/pyrobloxbot),
[pyrobloxbot FAQ](https://pyrobloxbot.readthedocs.io/en/latest/faq.html),
[v2.2.3 release metadata](https://api.github.com/repos/Mews/pyrobloxbot/releases/tags/v.2.2.3),
[BloxBot AI](https://github.com/paralov/app-bloxbot-ai),
[Roblox Studio MCP](https://create.roblox.com/docs/studio/mcp), and
[Roblox Open Cloud](https://create.roblox.com/docs/cloud).
