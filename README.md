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
- 41 schema-validated game actions covering rides, tracks, entrances/exits, paths, staff, prices, research, marketing, land, water, scenery, pause, and speed.
- Full runtime catalog of 350 actual track pieces from the pinned engine, with ride-specific normal-construction and chain eligibility. The names table also contains aliases and sentinels; those are not extra buildable pieces.
- Custom blueprints with repetition, curves, banking, slopes, chain lifts, brakes, inversions, diagonal transitions, per-piece colours and seat rotation. Some special track systems have additional engine constraints.
- New-coaster construction or appending to an existing closed ride; optional entrance/exit placement and testing; existing-track traversal with gap/circuit detection.
- Screenshots and uniquely named save checkpoints.
- Loopback authentication, read-only startup, session-bound writes, spend prechecks, STOP, per-action receipts, and a client journal that refuses to resend an existing mutation ID.
- Researched-only ride construction, enforced by the bridge before native queries and again before execution.

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

**Ride research:** `objects {"type":"ride"}` lists loaded objects, including ones that have not been researched. Each ride object now includes `researched`: `true`, `false`, or `null` if the native research status cannot be read. Select an explicit object `index` with `researched:true` and a supported, non-null `rideType`. Automatic object selection (`rideObject:65535` or `-1`) is rejected.

The bridge checks `park.research.isObjectResearched("ride", index)` in the pinned API rather than trusting the loaded catalog, invented/uninvented lists, or a successful engine query. Direct `ridecreate`, batches, and `coaster.build` use the same guard. It also covers new track, maze build cells, entrances/exits, and vehicle changes on existing rides, including `track.build`. Cheat-only ride-type changes are blocked separately. Research-bypass cheats do not override this restriction. Missing or unreadable research status blocks these construction actions; use the pinned OpenRCT2 v0.5.5 / API 122. Closing, ordinary ride management, demolition, track/gate removal, and maze move/fill remain available for existing rides. Native legality, cost, and operating checks still apply.

**Units:** map inspection uses tile coordinates. Construction uses world x/y (32 per tile), world z (8 per base-height unit, 16 per land increment), and cardinal direction 0=(-x), 1=(+y), 2=(+x), 3=(-y). Directions 4..7 represent diagonal connections for the planner. Money is the engine's integer unit: 10 units = one pound/dollar in the default display. E.g. maxCost 100000 is £/$10,000. Ratings are fixed-point integers: 652 means 6.52. Consult engine schema/source for action-specific enums.

## Build paths with matching object families

Inspect the live `objects` catalogs before choosing path indices. `footpath` contains legacy combined paths; `footpath_surface` and `footpath_railings` contain the separate modern objects. Returned `type` and actual `index` identify the family and slot; array positions are not object indices. Modern surfaces also expose native `flags` and `isQueue` (`null` means it could not be verified).

For `footpathplace`, use the pinned engine's `constructFlags` values:

- `0`: regular modern path. `object` must be a loaded `footpath_surface` with `isQueue:false`; `railingsObject` must be a loaded `footpath_railings` index.
- `1`: modern queue. The same families apply, with `isQueue:true` on the surface.
- `2`: regular legacy path. `object` must be a loaded `footpath` index.
- `3`: legacy queue, using the queue appearance built into that same legacy `footpath` object.

Legacy paths supply their own railings. Their required `railingsObject` argument is ignored by the native engine; use `65535` (the null sentinel), or an unsigned 16-bit value. Modern paths require a real loaded railings object, so the sentinel is rejected there. All path object families have indices `0..254` in API 122, and an in-range index must still be loaded.

The bridge rejects unknown construction bits, wrapped/sentinel object indices, missing or wrong-family objects, and modern queue/surface mismatches before native query and again before execution. This applies to direct actions and each batch step, including replacement of an existing path. It does not silently change flags or select another family. The same numeric index can legitimately exist in several catalogs; `constructFlags` selects the namespace, so an overlap alone is not an error. Regular-surface-as-queue cheats do not bypass the queue check.

The native action can accept invalid object references and create invisible, walkable paths. Its success is therefore insufficient verification. `map` read-back exposes `object` for legacy paths, or `surfaceObject` and `railingsObject` for modern paths, together with `isQueue`. After building, check those references, native visibility, queue connections, and actual guest access. These guards do not repair existing paths or prove the resulting guest network works.

## Choose supported ride track

The global `track.catalog` is a geometry reference, not permission to use every piece on every ride. Before designing, request `track.catalog {"ride":12}` for an existing ride, or `track.catalog {"rideType":15,"rideObject":0}` with an explicit researched object for a new ride. Returned pieces include `supported`, `supportReason` when rejected, `chainSupported`, `chainReason`, and `requiresChainLift`. Use `inverted:true` to inspect a ride's inverted construction variant. An unfiltered catalog intentionally omits ride-specific support fields.

The bridge independently checks normal construction eligibility against generated metadata from the pinned engine. It uses each ride's regular/inverted enabled track groups, the normal UI's union of compatible loaded vehicle sprite support, and ride-specific covered pieces and bases. Cheat-only extra drawable groups are excluded. Incomplete native descriptor groups for vertical/diagonal geometry are resolved using the pinned construction UI rules; short/long slope substitutions are respected. Neither loaded track names nor a successful native placement query establishes this eligibility.

Chain eligibility is separate from geometry. A supported steep drop or climb does not necessarily support a forward chain lift. Checks include ordinary, curved and steep lift capabilities, piece flags, banking, and covered/inverted variants. Legal backward steep chains remain available. Spiral curved-lift pieces require their native chain flag; `track.plan` supplies it automatically. Alpine uphill pieces require an explicit chain in a generic plan. The ride-specific catalog explains these requirements.

`trackplace`, direct execution, batches, `track.build` and `coaster.build` share the guard, regardless of `isFromTrackDesign`. Builders preflight every planned piece before the first action, then each placement is checked again before query and immediately before execution against live ride/object metadata. Unknown types, unsupported flag bits, wrapped values, missing metadata and mismatched API versions fail closed with an error. `trackPlaceFlags` is exactly 0..3: bit 0 chain, bit 1 inverted. Flags never grant a capability the ride lacks.

Cheat-only ride-type changes (`ridesetsetting`, setting 10) are blocked. Compatible researched same-type vehicle swaps, ordinary settings, closures, brake-speed changes and removal remain available. Maze construction continues through its dedicated actions. These guards do not repair existing illegal track, verify adjacent-piece connectivity, certify rendering or train physics, or override other native placement checks. Keep cheats off and inspect, walk and test the resulting ride before opening it.

## Build a custom coaster

1. Inspect land, finances, available ride objects, and station objects. Select a ride object with `researched:true`, its actual `index`, and a compatible non-null entry from its `rideType` array, then inspect the ride-specific `track.catalog`; IDs in the build template are placeholders.
2. Choose a surveyed start location and elevation. Update examples/custom-coaster-plan.json or create a new blueprint. The file examples/custom-coaster-plan.json is provided as a technical syntax example, not as a recommended coaster design or template. It demonstrates how a track.plan request expresses track pieces, repetition, slopes, banking and chain lifts. For a new coaster, create an independent piece sequence based on the intended ride concept, available terrain and space, budget, pacing, capacity, and desired guest experience. Do not copy what the README sample provides regarding station length, lift/drop arrangement, turn pattern, straight sections, brake placement, footprint, or overall sequence. Do not copy layouts merely because they appear in the example. A normal circuit coaster should use a closed track plan; unusual layouts such as shuttle coasters should only be used when they are deliberately part of the ride concept.
3. Request `track.plan`. The returned `planId` is bound to this park session. It reports placements, footprint, potential shared-tile overlaps and exact geometric closure. Shared tiles can be legal because pieces use different quadrants; the engine decides clearance.
4. Fill examples/build-coaster.template.json with the plan ID, actual ride/station objects, name, and spending limit. `coaster.build` creates the ride, places each piece, optionally places entrances/exits, and optionally requests testing. `track.build` instead takes `planId`, `ride`, and `maxCost` to add pieces to an existing closed ride.
5. Each action is queried immediately before execution. Later pieces depend on earlier ones, so there is no claim of an atomic full-layout preview. On failure, construction stops and reports the ride ID, completed actions, rejected step, and costs. Correct the problem and compile a plan for the missing portion after inspecting the result.
6. Inspect map elements to find the first track tile's element index. `track.walk` takes `{x,y,elementIndex,limit}` in tile units; it follows the real engine track iterator to detect a circuit or gap.
7. Connect entrance, exit, queue and ordinary paths. Example entrance entry: `{x:2016,y:2016,direction:1,station:0,isExit:false}`; these coordinates are illustrative, not validated against the sample. The engine determines entrance height from the station.
8. Query and execute `ridesetstatus` with status 2 (testing). Let a train complete its circuit; inspect `ride` for speed, forces, excitement, intensity, nausea and reliability. Successful placement or setting the testing flag does not prove the train completes the circuit. Status 1 opens the ride only when ready.

Track-piece names come from generated/track-names.json. `track.catalog` supplies live geometry. The sample coordinates are illustrative and must be changed for the actual park. A physically slow or unsafe layout needs redesign even when it closes geometrically.

## Build a maze

Maze construction uses the native `mazeplacetrack` and `mazesettrack` actions, rather than generic `trackplace` with the maze track identifier. Create a researched Maze ride (ride type 20), keep it closed during construction, and inspect the exact schemas before querying and executing actions.

- `mazeplacetrack` places a full tile at world x/y multiples of 32. Its `mazeEntry` is the engine's 16-bit cell-and-wall mask (0..65535).
- `mazesettrack` edits a half-tile cell at world x/y multiples of 16. `direction` is 0..3, `mode` is 0 (build), 1 (move), or 2 (fill), and `isInitialPlacement` is a required boolean.
- Both actions require world z aligned to 16 and a valid, closed Maze ride. The engine's query still decides normal ownership, clearance, terrain and construction legality.

Default to two or three routes to the exit, with useful cross-connections, modest route lengths and short dead ends. A long, unique solution can make guests wander repeatedly and reduce throughput.

Before construction, describe relative pre-gate tile masks and gates using the format in `examples/maze-layout.json`, then run `node scripts/maze-layout.js YOUR-LAYOUT.json`. The checker applies native gate openings, checks connectivity and reports up to three independent route choices between the gate regions; it fails when the layout is invalid or has fewer than two routes. Shared gate cells are allowed. The example demonstrates the format; choose a fresh layout for the park and translate its relative coordinates to a surveyed world location.

Bounded `map` inspection includes the native `mazeEntry` mask for Maze track elements. Inspect these masks again after placing entrances and exits, because gates change the adjoining maze walls. Verify the resulting routes, normal gate/path legality, and a native screenshot before opening.

Mazes need operating guest-flow checks. Observe completed visits over elapsed game time, queue waits, crowding and escape thoughts such as “I want to get out.” If guests struggle or queues grow, add useful cross-connections or shorten troublesome routes, then observe again. Connectivity and a completed visit establish that escape is possible; sustained guest flow establishes whether the design works well.

## Coaster design is not prescribed

- The bridge provides the construction tools and geometric validation; it does not prescribe a particular coaster shape.
- The included example is intentionally not a canonical ride. It should be treated like an API usage example rather than a blueprint to imitate. There is no required sequence of station → lift → drop → turns → straightaway → brakes.
- When designing a coaster, first decide what kind of ride you are trying to create, then translate that concept into track pieces. Different rides may reasonably have different station lengths, elevations, lift arrangements, curves, inversions, brake sections, on-ride photo sections, underground segments, block sections, train configurations, footprints and pacing.
- Use track.plan to verify the proposed geometry and the normal testing workflow to evaluate the finished ride. Geometry validation establishes track connectivity and footprint information; it does not establish that the resulting ride has appropriate physics, forces, ratings, capacity or guest access.

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

GPL-3.0-only. API schemas, track identifiers, normal-construction metadata, and geometry test fixtures are derived from [OpenRCT2 v0.5.5](https://github.com/OpenRCT2/OpenRCT2/tree/v0.5.5), commit `8694e3483690323b6a75fa7264b6c58116f51f31`. Geometry follows `TrackDesign.cpp`, `TrackIteration.cpp`, `Location.hpp`, and the scripting TrackSegment bindings. Retain LICENSE and upstream notices when distributing source. Do not share bridge.config.json, the token-bearing plugin bundle, receipts, or private park saves.
