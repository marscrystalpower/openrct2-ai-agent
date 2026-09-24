# OpenRCT2 Agent Bridge

Let an AI agent inspect and manage a RollerCoaster Tycoon 2 park, including building custom coaster tracks piece by piece.

## What is OpenRCT2?

OpenRCT2 is a community-developed, open-source replacement for the engine that runs RollerCoaster Tycoon 2. It uses the graphics, sounds and other game assets from your own RCT2 installation. You still play the familiar game, but launch OpenRCT2 for this bridge. Installing the bridge does not replace your Steam game.

OpenRCT2 supports plugins. This bridge uses that plugin interface to let an agent read park state and send game commands. It does not operate by clicking your screen. Native screenshots help the agent inspect its work.

## Start here

Give your agent this repository and say: **Read AGENTS.md, explain the setup to me, and help me install this bridge.** The agent handles technical setup; you supply your RCT2 copy, any necessary approvals, and your choice of park.

Windows x64, an installed copy of RCT2, Node.js 20 or newer, Git, and internet access are required. The agent should check and arrange missing prerequisites with your authorization. OpenRCT2 is pinned to v0.5.5 / scripting API 122. Other releases and operating systems have not been qualified for this package.

**Status:** community test release. The original bridge passed native construction, train testing, screenshot and save/reload checks. The shared package has a separate verification report in VERIFICATION.md. It is not guaranteed to design safe, profitable rides or finish scenarios.

No game assets, saved parks, screenshots, authentication tokens, session records or installed runtimes are included. Each installation builds its own authenticated plugin locally.

## Included

- Park finances, scenario, guests and thoughts, staff, rides and operating statistics, bounded map inspection, and loaded object catalogs.
- 39 schema-validated game actions covering rides, tracks, entrances/exits, paths, staff, prices, research, marketing, land, water, scenery, pause, and speed.
- Full runtime track catalog with 353 named track identifiers from the pinned engine. Ride-specific availability still depends on the engine and selected vehicle.
- Custom blueprints with repetition, curves, banking, slopes, chain lifts, brakes, inversions, diagonal transitions, per-piece colours and seat rotation. Some special track systems have additional engine constraints.
- New-coaster construction or appending to an existing closed ride; optional entrance/exit placement and testing; existing-track traversal with gap/circuit detection.
- Screenshots and uniquely named save checkpoints.
- Loopback authentication, read-only startup, session-bound writes, spend prechecks, STOP, per-action receipts, and a client journal that refuses to resend an existing mutation ID.

## Setup (for the agent)

Read AGENTS.md and SETUP.md first. Explain OpenRCT2 and obtain any missing installation/launch authorization before executing setup. From this repository:

```powershell
.\scripts\Setup-Bridge.ps1
.\scripts\Start-Bridge.ps1 -Rct2Path 'FULL PATH TO THE MEMBER’S RCT2 FOLDER'
```

Setup obtains pinned upstream source, builds a fresh local token-bearing plugin, runs tests, downloads the official portable runtime, verifies its published SHA-256 and installs an isolated profile. It does not launch the game. Launch is a separate action. The checksum checks archive consistency, not an independent publisher signature. There are no npm dependencies.

## Client

```powershell
node cli.js hello
node cli.js park
node cli.js rides
node cli.js objects '{"type":"ride"}'
node cli.js map '{"x":60,"y":60,"width":16,"height":16}'
node cli.js schema trackplace
node cli.js arm
node cli.js save
node cli.js request examples/custom-coaster-plan.json
node cli.js stop
```

Read-only inspections work without arming. `arm` is explicit and tied to the current park; it grants no authority beyond the user's gameplay instructions. Save checkpoints are named `agent-checkpoint-REQUEST-ID.park` in user-data/save. Screenshots use `capture` and appear in user-data/screenshot.

For anything complex, place this shape in a JSON file and use `node cli.js request FILE`:

```json
{"op":"action.query","args":{"action":"ridesetprice","args":{"ride":12,"price":20,"isPrimaryPrice":true}}}
```

Use `action.execute` with the same action/args plus `maxCost` to execute; `batch.execute` takes an `actions` array and a shared `maxCost`. Argument names and required fields are in generated/actions.json or `node cli.js schema`. Arbitrary JavaScript, action flags, cheats, file paths, multiplayer actions, and unlisted actions are not accepted.

**Units:** map inspection uses tile coordinates. Construction uses world x/y (32 per tile), world z (8 per base-height unit, 16 per land increment), and cardinal direction 0=(-x), 1=(+y), 2=(+x), 3=(-y). Directions 4..7 represent diagonal connections for the planner. Money is the engine's integer unit: 10 units = one pound/dollar in the default display. E.g. maxCost 100000 is £/$10,000. Ratings are fixed-point integers: 652 means 6.52. Consult engine schema/source for action-specific enums.

## Build a custom coaster

1. Inspect land, finances, available ride objects, and station objects. Select the ride object's actual `index` and a compatible entry from its `rideType` array; IDs in the build template are placeholders.
2. Choose a surveyed start location and elevation. Update examples/custom-coaster-plan.json or create a new blueprint. The file examples/custom-coaster-plan.json is provided as a technical syntax example, not as a recommended coaster design or template. It demonstrates how a track.plan request expresses track pieces, repetition, slopes, banking and chain lifts. For a new coaster, create an independent piece sequence based on the intended ride concept, available terrain and space, budget, pacing, capacity, and desired guest experience. Do not copy what the README sample provides regarding station length, lift/drop arrangement, turn pattern, straight sections, brake placement, footprint, or overall sequence. Do not copy layouts merely because they appear in the example. A normal circuit coaster should use a closed track plan; unusual layouts such as shuttle coasters should only be used when they are deliberately part of the ride concept.
3. Request `track.plan`. The returned `planId` is bound to this park session. It reports placements, footprint, potential shared-tile overlaps and exact geometric closure. Shared tiles can be legal because pieces use different quadrants; the engine decides clearance.
4. Fill examples/build-coaster.template.json with the plan ID, actual ride/station objects, name, and spending limit. `coaster.build` creates the ride, places each piece, optionally places entrances/exits, and optionally requests testing. `track.build` instead takes `planId`, `ride`, and `maxCost` to add pieces to an existing closed ride.
5. Each action is queried immediately before execution. Later pieces depend on earlier ones, so there is no claim of an atomic full-layout preview. On failure, construction stops and reports the ride ID, completed actions, rejected step, and costs. Correct the problem and compile a plan for the missing portion after inspecting the result.
6. Inspect map elements to find the first track tile's element index. `track.walk` takes `{x,y,elementIndex,limit}` in tile units; it follows the real engine track iterator to detect a circuit or gap.
7. Connect entrance, exit, queue and ordinary paths. Example entrance entry: `{x:2016,y:2016,direction:1,station:0,isExit:false}`; these coordinates are illustrative, not validated against the sample. The engine determines entrance height from the station.
8. Configure capacity and dispatch deliberately using the operating workflow below, then query and execute `ridesetstatus` with status 2 (testing). Test the final train configuration; inspect `ride` for speed, forces, excitement, intensity, nausea and reliability. Successful placement or setting the testing flag does not prove the trains complete the circuit or restart after block stops. Status 1 opens the ride only when ready.

Track-piece names come from generated/track-names.json. `track.catalog` supplies live geometry. The sample coordinates are illustrative and must be changed for the actual park. A physically slow or unsafe layout needs redesign even when it closes geometrically.

## Coaster design is not prescribed

- The bridge provides the construction tools and geometric validation; it does not prescribe a particular coaster shape.
- The included example is intentionally not a canonical ride. It should be treated like an API usage example rather than a blueprint to imitate. There is no required sequence of station → lift → drop → turns → straightaway → brakes.
- When designing a coaster, first decide what kind of ride you are trying to create, then translate that concept into track pieces. Different rides may reasonably have different station lengths, elevations, lift arrangements, curves, inversions, brake sections, on-ride photo sections, underground segments, block sections, train configurations, footprints and pacing.
- Use track.plan to verify the proposed geometry and the normal testing workflow to evaluate the finished ride. Geometry validation establishes track connectivity and footprint information; it does not establish that the resulting ride has appropriate physics, forces, ratings, capacity or guest access.

## Capacity and operating settings

Treat operation as part of the ride design. For a substantial compatible coaster, consider multiple trains when demand and traversal time justify the extra capacity, and plan any needed block sections before construction. Choose train count and block sections to suit the ride; they are not a universal requirement. Ordinary `brakes` regulate speed; `blockBrakes` are a different track piece. A final block section before the station is worth considering, with additional sections on a longer course where traversal times and restart geometry justify them. Select the compatible block-sectioned mode, configure trains, and verify the engine's actual allowed count. A long run of ordinary brakes does not provide block separation.

Use `ride` or `rides` to inspect `mode`, `vehicles` (head vehicle IDs, one per train), `liftHillSpeed`, `minLiftHillSpeed`, `maxLiftHillSpeed`, `departFlags`, `minimumWaitingTime`, and `maximumWaitingTime`. Lift speeds are mph and waiting times are seconds. The six operating readouts are an additive source update: older installed bundles omit them until rebuilt and installed. Missing properties mean unavailable, not zero. API 122 does not expose cars-per-train through this ride view; verify train length/capacity in the game and do not treat `vehicles.length` as seat capacity.

Prefer the maximum normally allowed lift speed, then run a fresh test. Lower it when testing warrants it; do not enable cheats to exceed the limit. Choose load thresholds and waiting times to suit the ride and demand instead of inheriting a 10-second minimum. For example, many small cars may benefit from departures around 3 seconds apart, while a two-train coaster might start with a 20-second minimum. Neither value is a universal default or a guarantee of actual spacing. A carousel can run with any load; a popular coaster may benefit from fuller trains with a bounded maximum wait.

The existing `ridesetsetting` action takes `{ride, setting, value}`. Relevant IDs for the pinned OpenRCT2 version are:

| Setting | ID | Value |
| --- | --- | --- |
| Operating mode | 0 | Supported mode enum; continuous circuit = 1, continuous circuit with block sections = 34 |
| Departure flags | 1 | Bitmask described below |
| Minimum waiting time | 2 | Seconds, 0–250 |
| Maximum waiting time | 3 | Seconds, 0–250 |
| Chain-lift speed | 8 | mph within the ride's normal reported limits |

`ridesetvehicle` takes `{ride, type, value, colour}`: type 0 changes train count; type 1 changes cars per train. The engine applies ride, station, and block limits. Query before executing and verify the resulting configuration.

Departure flags encode the load selection in bits 0–2: quarter = 0, half = 1, three-quarter = 2, full = 3, any = 4. Bit 3 (`8`) enables waiting for that load; bit 4 (`16`) leaves when another vehicle arrives; bit 5 (`32`) synchronises adjacent stations; bit 6 (`64`) enables minimum waiting time; bit 7 (`128`) enables maximum waiting time. Preserve unrelated choices rather than blindly replacing the bitmask. Merely changing a waiting-time number does not enable its checkbox. For example, full-load waiting plus minimum and maximum waits, with the other flags off, is `3 | 8 | 64 | 128 = 203`; it is an example, not a prescribed policy. Setting a minimum above the maximum raises the maximum; setting a maximum below the minimum lowers the minimum. Read both back.

Use request files, `action.query`, and the normal session-bound mutation workflow. Before altering existing track, save a checkpoint, close the ride twice, and verify trains are cleared. Test all trains for multiple circuits after changing blocks, train count/length, mode, or lift speed. Verify restart after block stops, section clearance, guest access, actual departure intervals, and queue waits. A successful single-train circuit or an accepted action is not proof of multi-train operation. Block separation is not a blanket guarantee against every breakdown or crash. Size queues to the resulting capacity and finish names, colours, and landscaping as part of the same design.

Sources for these pinned values: [ride setting IDs](https://github.com/OpenRCT2/OpenRCT2/blob/8694e3483690323b6a75fa7264b6c58116f51f31/src/openrct2/actions/ride/RideSetSettingAction.h), [setting validation and effects](https://github.com/OpenRCT2/OpenRCT2/blob/8694e3483690323b6a75fa7264b6c58116f51f31/src/openrct2/actions/ride/RideSetSettingAction.cpp), [modes and departure flags](https://github.com/OpenRCT2/OpenRCT2/blob/8694e3483690323b6a75fa7264b6c58116f51f31/src/openrct2/ride/Ride.h), [vehicle settings](https://github.com/OpenRCT2/OpenRCT2/blob/8694e3483690323b6a75fa7264b6c58116f51f31/src/openrct2/actions/ride/RideSetVehicleAction.h), and [API 122 ride properties](https://github.com/OpenRCT2/OpenRCT2/blob/8694e3483690323b6a75fa7264b6c58116f51f31/distribution/scripting/openrct2.d.ts).

## Recovery and limits

- Client intent is flushed to disk before a mutation is sent. Plugin receipts use OpenRCT2 sharedStorage and update before dispatch and after each successful action. Engine storage is not a transactional write-ahead database; after an engine/OS crash, use the client journal and map state as well.
- Never resend a timed-out mutation or create a new ID to repeat it. Run `node cli.js receipt REQUEST-ID`. `started`, an `inFlight` entry, and `outcome_unknown` require reconciliation. The CLI refuses existing request IDs; duplicate requests reaching the plugin only return the stored receipt if content matches.
- Execution results use `completed`, `partial`, `stopped`, or `outcome_unknown`. `ok:true` means a valid protocol response; it does not mean construction succeeded. The CLI exits nonzero on non-completed mutation states.
- STOP and park changes prevent subsequent actions. A command already dispatched may finish. Batches do not auto-rollback or auto-demolish anything.
- Cost limits check positive quoted costs before each action; refunds do not replenish the budget. Other activity can change the park between checks. Receipts record actual engine cost.
- Read requests are bounded: map rectangles up to 32x32, entities up to 500 per page, track plans up to 2048 pieces. Plan cache: 100 per session. Receipts: 5000 before manual archiving while the engine is closed.
- If construction is rejected while paused, unpause through the normal game action. The bridge does not enable build-in-pause cheats.
- A refused connection usually means OpenRCT2 is closed, the wrong profile was launched, or the plugin failed to load. Check logs/openrct2-*.stderr.log, the installed plugin hash, and hello's API version. Use the pinned release; older engines lack required interfaces.

## Source and license

GPL-3.0-only. API schemas, track identifiers, and geometry test fixtures are derived from [OpenRCT2 v0.5.5](https://github.com/OpenRCT2/OpenRCT2/tree/v0.5.5), commit `8694e3483690323b6a75fa7264b6c58116f51f31`. Geometry follows `TrackDesign.cpp`, `TrackIteration.cpp`, `Location.hpp`, and the scripting TrackSegment bindings. Retain LICENSE and upstream notices when distributing source. Do not share bridge.config.json, the token-bearing plugin bundle, receipts, or private park saves.
