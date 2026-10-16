# OpenRCT2 Agent Bridge

Let an AI agent inspect and manage a RollerCoaster Tycoon 2 park, including building custom coaster tracks piece by piece.

## What is OpenRCT2?

OpenRCT2 is a community-developed, open-source replacement for the engine that runs RollerCoaster Tycoon 2. It uses the graphics, sounds and other game assets from your own RCT2 installation. You still play the familiar game, but launch OpenRCT2 for this bridge. Installing the bridge does not replace your Steam game.

OpenRCT2 supports plugins. This bridge uses that plugin interface to let an agent read park state and send game commands. It does not operate by clicking your screen. Native screenshots help the agent inspect its work.

## Start here

Give your agent this repository and say: **Read AGENTS.md, explain the setup to me, and help me install this bridge.** The agent handles technical setup; you supply your RCT2 copy, any necessary approvals, and your choice of park.

Windows x64, an installed copy of RCT2, Node.js 20 or newer, Git, and internet access are required. The agent should check and arrange missing prerequisites with your authorization. OpenRCT2 is pinned to v0.5.6 / scripting API 124. Other releases and operating systems have not been qualified for this package.

**Status:** community test release. The original bridge passed native construction, train testing, screenshot and save/reload checks. The shared package has a separate verification report in VERIFICATION.md. It is not guaranteed to design safe, profitable rides or finish scenarios.

No game assets, saved parks, screenshots, authentication tokens, session records or installed runtimes are included. Each installation builds its own authenticated plugin locally.

## Included

- Park finances, scenario, guests and thoughts, staff, rides and operating statistics, bounded map inspection, and loaded object catalogs.
- Detailed ride inspection with native test flags, departure waits, music, breakdown state, actual vehicle chains and seat capacity.
- Read-only path connection inspection and bounded route tracing, including slopes, banner restrictions and possible missing joins.
- 44 schema-validated game actions covering rides, tracks, entrances/exits, paths, no-entry banners, staff, prices, research, marketing, land, water, scenery, pause, and speed.
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
node cli.js verify
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

`hello` reports a token-free `bridgeSourceHash`, a bridge manifest and versioned capabilities, including `native-research-bitmap-v1`. This identifies the actual public bridge code; `engineSourceCommit` (and the older `sourceCommit` alias) identifies OpenRCT2 instead. The CLI compares the live identity with `generated/bridge-manifest.json`. `verify` exits nonzero for a mismatch, and the client refuses to arm or send mutations until identities match. A version number alone is insufficient because earlier builds shared the same number.

For an existing game profile, the local, private `bridge.config.json` may include an absolute `profilePath` pointing to its OpenRCT2 user-data directory. The CLI then reads that profile's display settings and verifies artifacts there. The default is this installation's isolated `user-data` folder. This avoids editing the public client code for a particular computer.

For anything complex, place this shape in a JSON file and use `node cli.js request FILE`:

```json
{"op":"action.query","args":{"action":"ridesetprice","args":{"ride":12,"price":20,"isPrimaryPrice":true}}}
```

Use `action.execute` with the same action/args plus `maxCost` to execute; `batch.execute` takes an `actions` array and a shared `maxCost`. Argument names and required fields are in generated/actions.json or `node cli.js schema`. Arbitrary JavaScript, action flags, cheats, file paths, multiplayer actions, and unlisted actions are not accepted.

**Ride research:** `objects {"type":"ride"}` lists loaded objects, including ones that have not been researched. Each ride object now includes `researched`: `true`, `false`, or `null` if the native research status cannot be read. Select an explicit object `index` with `researched:true` and a supported, non-null `rideType`. Automatic object selection (`rideObject:65535` or `-1`) is rejected.

The bridge checks `park.research.isObjectResearched("ride", index)` in the pinned API rather than trusting the loaded catalog, invented/uninvented lists, or a successful engine query. Direct `ridecreate`, batches, and `coaster.build` use the same guard. It also covers new track, maze build cells, entrances/exits, and vehicle changes on existing rides, including `track.build`. Cheat-only ride-type changes are blocked separately. Research-bypass cheats do not override this restriction. Missing or unreadable research status blocks these construction actions; use the pinned OpenRCT2 v0.5.6 / API 124. Closing, ordinary ride management, demolition, track/gate removal, and maze move/fill remain available for existing rides. Native legality, cost, and operating checks still apply.

**Units:** map inspection uses tile coordinates. Construction uses world x/y (32 per tile), world z (8 per base-height unit, 16 per land increment), and cardinal direction 0=(-x), 1=(+y), 2=(+x), 3=(-y). Directions 4..7 represent diagonal connections for the planner. Raw money and `maxCost` remain engine integer units. Display conversion varies by the selected currency; for USD, 100000 raw units displays as $10,000.00. Ratings are fixed-point integers: 652 means 6.52. Consult engine schema/source for action-specific enums.

**Currency:** `hello` and `park` include currency metadata; `park.moneyDisplay`, ride `moneyDisplay`, query `costDisplay` and receipt display fields use the running game's native formatter. Use those strings in reports, following the actual selected currency, custom conversion rate, symbol placement and language. Never assume GBP from the repository, language, examples or raw money. The plugin cannot read a currency code reliably; the CLI reports `currency.configuredCode` and `profileSettings` from the explicitly selected profile, without guessing a code from `$`. Native display strings remain authoritative if settings are missing or have changed. API 124 narrows formatting arguments to signed 32-bit integers, so larger valid raw amounts are preserved with display `null`, rather than being wrapped or mislabeled.

## Inspect ride operation and capacity

`ride {"ride":12}` now includes an `inspection` object alongside all existing ride fields and money display strings. It is read-only, requires no arming, and does not save, test, close or change the ride. Use a request file:

```json
{"op":"ride","args":{"ride":12}}
```

- `testing` reports native `tested`, `testInProgress`, `onTrack`, `noRawStats`, `fixedRatings`, crash and stall flags, plus whether all three ratings are available. A testing status or existing rating alone is not test completion. The native `tested` flag is not proof that every train has completed a circuit; run and observe the intended full fleet. Flat rides can have ratings without raw track statistics.
- `operation` reports the actual minimum/maximum waiting times in seconds, their enable flags, the load rule, synchronization, lift speed in mph, and music enable/object settings. Native clamping is reflected in these values. `musicObject:65535` is the native no-object sentinel; a selected object does not imply music is enabled. A load rule is active only when `waitForLoad:true`.
- `maintenance` reports the breakdown string (`"none"` means no current breakdown), pending/broken/inspection flags, inspection interval enum and the native `isEmpty` value. A pending breakdown may still have `breakdown:"none"`.
- `fleet.configuredTrains` reads the native train-slot count, including empty slots when a ride is closed and cleared. `spawnedTrains` counts resolvable head vehicles. Each train includes its current status, raw engine velocity, track location in world coordinates, vehicle chain, seats and assigned seats. `vehiclesPerTrain` counts all entities; `carsPerTrain` subtracts the ride object's `zeroCars`, matching the vehicle-tab car count. Invisible dummy cars therefore do not inflate the displayed count or seating capacity.
- `fleet.totalSeats` and `assignedSeats` are totals only when the entire on-track fleet can be read. Absent vehicles, broken links, shared/cyclic chains, unreadable seats and inspection limits produce `null` totals rather than a partial count. Train-level `issues`, fleet `issues` and `unavailable` identify missing evidence. Traversal is bounded to 255 train slots and 4096 vehicle entities.

`assignedSeats` counts non-null entries in each vehicle's native guest-slot list. Those slots can include boarding or stale assignments, so they are not a count of passengers physically aboard. Use the existing ride `guestCount` for the native rider count.

API 124 does not expose the ride-specific maximum train/car settings or configured cars while vehicles are absent. `fleet.rideLimits` explicitly returns `null`. `objectCarLimits` contains static object metadata, including dummy cars; these are **not** the station/block/operating limits of the current ride. A null value means unknown, never zero. The inspector neither parses saves nor guesses unsupported settings.

The new capability is `ride-inspection-v1` in the source manifest. The `rides` list retains its existing shape and avoids traversing every fleet; request details only for the rides being checked. This inspection does not replace circuit traversal, native visual review, full-fleet testing or guest-access checks.

## Build paths with matching object families

Inspect the live `objects` catalogs before choosing path indices. `footpath` contains legacy combined paths; `footpath_surface` and `footpath_railings` contain the separate modern objects. Returned `type` and actual `index` identify the family and slot; array positions are not object indices. Modern surfaces also expose native `flags` and `isQueue` (`null` means it could not be verified).

For `footpathplace`, use the pinned engine's `constructFlags` values:

- `0`: regular modern path. `object` must be a loaded `footpath_surface` with `isQueue:false`; `railingsObject` must be a loaded `footpath_railings` index.
- `1`: modern queue. The same families apply, with `isQueue:true` on the surface.
- `2`: regular legacy path. `object` must be a loaded `footpath` index.
- `3`: legacy queue, using the queue appearance built into that same legacy `footpath` object.

Legacy paths supply their own railings. Their required `railingsObject` argument is ignored by the native engine; use `65535` (the null sentinel), or an unsigned 16-bit value. Modern paths require a real loaded railings object, so the sentinel is rejected there. All path object families have indices `0..254` in API 124, and an in-range index must still be loaded.

The bridge rejects unknown construction bits, wrapped/sentinel object indices, missing or wrong-family objects, and modern queue/surface mismatches before native query and again before execution. This applies to direct actions and each batch step, including replacement of an existing path. It does not silently change flags or select another family. The same numeric index can legitimately exist in several catalogs; `constructFlags` selects the namespace, so an overlap alone is not an error. Regular-surface-as-queue cheats do not bypass the queue check.

The native action can accept invalid object references and create invisible, walkable paths. Its success is therefore insufficient verification. `map` read-back exposes `object` for legacy paths, or `surfaceObject` and `railingsObject` for modern paths, together with `isQueue`. After building, check those references, native visibility, queue connections, and actual guest access. These guards do not repair existing paths or prove the resulting guest network works.

## Automatic facility and ride access checks

The ordinary CLI `park`, `rides` and `ride` requests now include `access` results. The client automatically waits for the initial audit when needed, so a single overview identifies named access problems without a guest survey, map inspection or screenshot. `path.access` requests the full park audit directly; no coordinates are required:

```powershell
node cli.js park
node cli.js path.access
node cli.js path.access '{"refresh":true}'
```

The audit checks the actual front sides of shop/facility footprints, ride entrances and exits, and the native center tiles of park entrances. It validates doorway height, slope alignment and stored doorway edges, then checks directed access to or from the park entrance network. Queues may provide access only to their own ride and station; queues for other rides cannot act as public shortcuts. A multi-sided shop needs one usable approach that also permits a return route. Legal pickup-only and dropoff-only ride stations are supported.

`warnings` reports real endpoint failures: missing front paths or doorway edges, incompatible heights, wrong queues, one-way restrictions, unreachable ride queues and isolated exit paths. Each warning identifies the ride/facility and location, with bounded supporting evidence for a likely nearby gap. Boundary walls explain missing connections; trees and ride supports are not assumed to block an existing native connection. Closed/testing rides appear as informational `observations`, keeping construction details out of the active guest-access warning count. An open ride with a missing required gate is checked against the native station rules.

Intentional gaps elsewhere in the path network do not produce access warnings. The detailed `path.inspect` operation below still exposes raw adjacency observations for construction/debugging, but those are not the primary health report. Park gates are handled explicitly rather than treating the outside forecourt as a disconnected park.

Work is divided over bounded game ticks. Direct protocol overviews can initially return `access.status:"checking"`; `path.access` waits for the result, and the CLI performs that wait automatically. Results are cached for up to two seconds and invalidated when a native action, map load or map resize changes the inspection revision. Changes during a scan cancel that scan so it cannot publish an old healthy result. Missing data, unsupported metadata or exhausted limits produce `unknown`/incomplete results. There is no fallback that guesses the largest path component is the park entrance network.

The source identity advertises `facility-access-v1`. All checks are read-only and require the pinned API. They establish structural guest access under the reported rules; dynamic vehicle blockages and actual congestion are separate operating observations.

## Detailed path connection inspection

`path.inspect` reads a rectangle of up to 32 by 32 tiles, plus neighboring tiles needed to inspect connections across its boundary. It works without arming and does not read guest thoughts or change the park. The source manifest advertises `path-inspection-v1`. For example, after building a junction:

```powershell
node cli.js path.inspect '{"x":60,"y":60,"width":8,"height":8}'
node cli.js path.route '{"start":{"x":60,"y":60,"elementIndex":1},"end":{"x":67,"y":67,"elementIndex":1},"limit":1024}'
```

These coordinates and element indices are illustrative. Use `map` or `path.inspect` to select actual footpath elements. Request coordinates are tiles; returned native positions and heights use world units (32 per XY tile). Directions are 0=(-x), 1=(+y), 2=(+x), 3=(-y). Separate elements at different heights remain separate nodes.

Inspection exposes each path's stored edges and native permitted edges, its reachable neighboring footpaths, and observations for each direction. It flags compatible adjacent paths without a stored join, asymmetric edge bits, banner restrictions and temporary vehicle blockage. A possible gap is a prompt to investigate: adjacent queue tiles, deliberate separations and height changes can be intentional. Walls on a missing boundary are construction evidence; nearby trees, scenery and tracks are context. The tool does not assume that visual overlap blocks a connected path. Ride supports are not independent path-navigation obstacles.

The native navigator respects no-entry banners, includes queues and wide paths, and excludes preview/ghost paths. It follows outgoing stored edges and chooses the first eligible neighbor in tile order; it does not require the neighbor's reverse edge. The inspector reports that asymmetry separately. `path.route` searches this directed footpath graph, with a default limit of 1024 visited nodes and a maximum of 4096. A result of `found:null` means the search was incomplete or capped; it does not establish that no route exists.

Inspection limits include 4096 path nodes, 4096 evidence elements and bounded geometry/wall comparisons and diagnostics. Evidence is stored once in `evidence`; `evidenceTiles` maps tile keys to evidence keys, and each direction's `nearbyEvidence` references its two tiles. Missing native APIs, unreadable data or exhausted limits produce an explicit incomplete/truncated result; inspect a smaller region for details.

These tools inspect footpath topology, not the complete guest decision process. Routes through queues are not filtered for a particular guest's destination. The navigator does not traverse ride entrances/exits, shop counters or park entrance elements, and vehicle blockage can change. An outgoing edge without a neighboring footpath may lead to a valid facility endpoint. A route proves structural reachability under the stated rules, not congestion-free access, placement legality or actual guest use. Check the relevant connections after construction, then verify endpoints, normal rendering and guest flow as appropriate.

## Ride design, furniture and pricing review (0.1.7)

Ordinary `park` inspection now includes `rideReview` and park-entry `pricing`; `rides` and `ride` include `design` and item `pricing`. These are read-only observations alongside structural `access`. Connected endpoints and high ratings can coexist with a long single-train circuit, unnecessary banking at a lift crest, missing amenities or default photo prices.

The design audit follows the native circuit from a station, with a maximum of 4096 pieces per ride and 16384 uncached pieces per overview. It identifies banked turns following a chain lift before a drop or powered acceleration, counts ordinary versus block brakes and photos, and highlights circuits of at least 90 seconds running one train with zero block brakes when the native ride type supports a block operating mode. Findings ask for design review; they do not estimate turn speed, certify a multi-train system or change the track. Partial circuits and exhausted limits return `unknown`. Inspect the individual ride for a full budget. Cache results expire after two seconds and native actions invalidate them.

`map` now exposes path additions and native damage/fullness fields. `path.inspect` includes per-path furniture and a bounded furniture inventory. The full `path.access` audit returns a separate `furniture` report, also included in `park.access.furniture`, with bench/bin/lamp counts, usable public furniture, broken-item warnings and full-bin warnings. Complete public-network evidence with no usable benches or bins produces advisories. Native bin status distinguishes full slots from vandalism; ghost additions do not supply amenities. Standard object classification uses an included 20-object metadata reference; custom objects without verified metadata remain unknown. Inventory does not assess seat occupancy, spacing or nearby ride demand; local coverage is assessed separately below. Furniture issues never change navigation endpoint counts.

## Local exit and food amenities (0.1.8)

Ordinary `park`, `rides` and `ride` overviews now include `access.amenities`. The full `path.access` report contains every audited site; overviews retain bounded sites and observations with omitted counts. This read-only job reuses the access audit's native directed public path graph and actual doorway connections. It needs no guest thoughts, screenshot or manual coordinates. Distances count connected path steps, with the first path tile outside the doorway at distance zero; queues and disconnected height layers cannot provide nearby furniture.

As of 0.1.9, ride exit sites follow permitted outgoing connections across paths that lead back to a park entrance. They do not require guests to be able to walk toward the exit from the main park. A correctly oriented no-entry sign can protect an exit corridor without hiding its benches and bins from the audit. Shop sites retain the public network that permits both arrival and return. Each site's `routePolicy` records which rule it uses. Missing route evidence remains unknown; the audit never ignores banners or invents reverse links to satisfy furniture targets.

These are design heuristics requested for this bridge, not native guest demand equations:

| Ride nausea | Recommended usable bench-equipped path tiles within 10 steps | First bench within |
| --- | --- | --- |
| Below 2.50 | No exit bench minimum | — |
| 2.50–3.99 | 2 | 4 steps |
| 4.00–5.99 | 3 | 4 steps |
| 6.00–7.99 | 5 | 3 steps |
| 8.00 or higher | 7 | 3 steps |

All ride exits are reviewed for at least one usable bin within six steps, including gentle rides. Native food/drink item categories identify stalls needing three bench-equipped path tiles within eight steps and two bins within ten, with the first bench and bin each within four. Ride names and categories do not override an actual measured nausea rating. Missing ratings leave bench demand unknown while bins can still be assessed.

Only usable, nonpreview, unbroken furniture counts; benches require level public paths with free sides, and bins need at least one usable nonfull slot. Unknown custom furniture or incomplete path searches cannot establish a shortfall. Nearby sites may share furniture: recommendations are not additive construction orders, and candidate empty tiles still require normal native placement queries. Spread additions across routes and shared rest areas instead of filling every tile. Continue providing benches and bins throughout the wider park; these checks focus on local demand and do not certify all park-wide spacing.

Native guests check their next path tile for seating; they do not follow this audit's search to a distant bench. The report measures furniture placement rather than occupied seats, traffic volume, recovery time or vomiting probability. New-build reviews should read `access.amenities` after the automatic audit finishes; a pending review is not a completed amenity check.

## Building protected exit routes (0.1.9)

An outward-only exit corridor is an intentional layout option. Build a normally connected public path from the actual ride exit to the main network, provide suitable furniture along that route, and use a no-entry sign where it usefully prevents main-path guests walking toward the exit. Verify that guests leaving the ride can still reach the park gate. Existing signs do not need removal merely because the corridor cannot be entered from the main path.

`objects` accepts `type: "banner"` to discover loaded sign objects. Three native actions are available through the existing query, execution, budget, session and receipt workflow: `bannerplace`, `bannersetstyle` and `bannerremove`. Inspect `generated/actions.json` for exact fields. Placement uses world XY and the native path-height argument; removal uses the banner element's native base Z, so do not reuse placement Z blindly. Place the sign first, reconcile its receipt and read back the returned `bannerIndex` or native map reference, then use a new request to set the no-entry style with `type: 2` and `parameter: 1` (or `0` to disable). A single static batch cannot substitute a newly returned banner ID into a later action.

The bridge supports only the no-entry style switch through `bannersetstyle`; it validates loaded object family, coordinates, direction, palette IDs and nonwrapped selectors before the normal native query. Ownership, actual path edges and native placement rules still apply. Read-back includes `bannerIndex` and `isNoEntry`, but the banner edge mask is not exposed by API 124. Verify permitted directions using `path.inspect`/`path.route` and the automatic access/amenity audit. Do not write the scripting `isNoEntry` property directly: the pinned setter changes the display flag without updating the traversal mask, while the native style action updates both.

## Pricing review (0.1.7)

Pricing inspection identifies native shop items and photo variants, shows current prices and native item values with display strings, and flags prices below useful references. Every native photo type has a 30-raw-unit reference ($3.00 in USD) at or below which price itself causes no refusals. Guests still need sufficient cash and photo eligibility; this is not a guarantee of purchase. Food, drinks and souvenirs have different values, weather can change them, and umbrellas bypass price refusal during precipitation while affordability remains relevant. Park entry inspection reports the native guest-generation penalties relative to ride value. Recommendations are starting points for profit review; they do not automatically change prices or claim a universal profit optimum. Successful `coaster.build` receipts also include a `postBuildReview` so default settings are reviewed immediately; pending access or test results remain explicit.

## Colours and terrain painting

`colours` returns the source-verified 74-entry palette. The 18 colours added in 0.5.6 use IDs 56..73; invisible and void remain 54 and 55. Actual colour arguments accept IDs 0..73. Track placement `colour` is a scheme index 0..3. Use `ridesetappearance` to change track and vehicle colours, then inspect `ride` for `colourSchemes` and `vehicleColours`.

`surfacesetstyle` requires both `surfaceColour1` and `edgeColour1` in addition to its previous six arguments. These fields are missing from the upstream scripting declarations, so the build verifies them against native action source. Scripting API 124 exposes terrain styles but does not expose terrain primary colours or recolouring flags. Use native visuals or save inspection to verify recolouring on a recolourable terrain object.

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
8. Review lift-crest banking, block sections, intended train count, queue size, working benches and bins, and admission/photo prices. Read `postBuildReview` and the ordinary `park`/`ride` reports; resolve review findings and incomplete evidence. A photo-equipped new coaster should normally charge the native 30-raw-unit reference when money rules permit.
9. Query and execute `ridesetstatus` with status 2 (testing). Let the intended fleet complete its test; inspect `ride` for speed, forces, excitement, intensity, nausea and reliability, plus `inspection.testing` and `inspection.fleet` for the native test flags, actual cars and seat capacity. Successful placement or setting the testing flag does not prove the train completes the circuit. Status 1 opens the ride only when ready.

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
- Before track.plan, review banking against expected speed and turn radius, and runs of four or more ordinary flat straights for wasted space. Prefer unbanked slow turns and purposeful hills or other suitable elements. Keep functional station, lift, launch and braking runs. For multiple trains in block mode, plan legal block boundaries and braking into block brakes; ordinary brakes alone do not create blocks. Test forces, stopping, restart and block clearance with the intended train count. These are agent design checks; track.plan validates geometry, not physics, ratings, capacity or guest access.

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

GPL-3.0-only. API schemas, track identifiers, normal-construction metadata, and geometry test fixtures are derived from [OpenRCT2 v0.5.6](https://github.com/OpenRCT2/OpenRCT2/tree/v0.5.6), commit `82b309798a83346b7f9fc61a53847f4323deb19d`. Geometry follows `TrackDesign.cpp`, `TrackIteration.cpp`, `Location.hpp`, and the scripting TrackSegment bindings. Retain LICENSE and upstream notices when distributing source. Do not share bridge.config.json, the token-bearing plugin bundle, receipts, or private park saves.
