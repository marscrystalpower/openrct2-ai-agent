# Verification and release status

Community test release, prepared 2026-09-19. Windows x64; OpenRCT2 v0.5.5, API 122.

## Historical development evidence

The original bridge passed native handshake, 48-piece wooden coaster construction, track-iterator circuit closure, completed train-test statistics, screenshot output, save/reload, STOP and read-only restart checks. These checks were recorded during development on 2026-09-16. Private evidence files and saves are intentionally excluded from this package.

The original native run exposed serialization and coordinate issues that were fixed. An early restricted launch crashed while saving; subsequent normal launches with explicit en-GB configuration passed save/reload. The root cause was not isolated.

Not every action, ride type or track variant has native coverage. Geometrically closed designs can stall or crash during train testing. Automated plugin tests use a mocked engine; passing them is not a fresh native-game acceptance test.

## Share-package validation

See RELEASE-CHECKS.md for checks actually performed on this package. Fresh-machine download, installation and game launch remain required before claiming turnkey setup across member machines. This packaging pass does not launch a game or install software.

## Maze extension (0.1.1)

The maze action schemas and read-back field come from the pinned OpenRCT2 v0.5.5 / API 122 source. The extension validates the live Maze ride, closed status, coordinate alignment and bounds, mask range, direction and mode before a native query. Map inspection reads the maze mask only for Maze track elements.

All 43 automated tests passed on Windows on 2026-09-29, including 12 maze tests. Automated maze tests use a mocked engine. They cover exact schemas, read-only queries, authentication and arming, invalid rides and native arguments, budget and clearance rejection, duplicate receipt recovery, STOP, and maze-only mask read-back. Two older fixture assertions were updated to match the current 12-piece banked example. These checks do not establish native maze placement or guest operation.

Native full-tile maze construction, wall-mask read-back, gate changes, legal guest access and guests completing the maze were verified on 2026-09-29 in an existing park. The single-route layout also produced reported long queues and escape thoughts. Successful exits alone did not establish satisfactory throughput. No save, screenshot or guest log is included in the source package.

The multi-route example and offline checker provide topology evidence, including independent routes between gate regions. All 50 automated tests passed, including seven additional topology checks. Native guest-flow checks remain necessary for each resulting design; the checker does not model guest decisions or predict completion times.

## Researched-only construction guard (2026-10-01)

The guard uses the pinned API's `park.research.isObjectResearched("ride", index)`, which reads the native ride-object invention bitmap. The pinned native `RideCreateAction` accepts explicit loaded objects without checking research; loaded catalogs and research-list membership are not sufficient construction authorization. Object/type compatibility and explicit object indices are checked as well. Research is checked before each native query and rechecked before execution.

Automated regression coverage includes a loaded, unresearched 3D Cinema accepted by the mock engine; researched creation; direct actions, batches, and coaster builds; existing-ride track/maze/gate construction; vehicle/type-switch bypasses; invalid and automatic indices; multi-type objects; unavailable research APIs; research changing after a query or between batch steps; completed research becoming available without restart; receipt no-replay behavior; and preserving management/removal of existing rides. These plugin tests use a mocked engine, not a running park. No native game was launched, changed, or installed for this fix.

## Path object-family guard (2026-10-01)

Verified against pinned source commit `8694e3483690323b6a75fa7264b6c58116f51f31`: `world/Footpath.h` defines construction bit 0 as queue and bit 1 as legacy. `actions/footpath/FootpathPlaceAction.cpp` selects either a legacy combined object or modern surface/railings indices without validating that those objects are loaded. `world/tile_element/PathElement.cpp` resolves them in separate object families and returns no render descriptor for missing references. `object/FootpathEntry.h` defines the modern surface's queue metadata separately, at bit 3; `openrct2-ui/windows/Footpath.cpp` uses that metadata for ordinary queue selection. Scripting bindings expose object families, live loaded indices and surface flags in API 122.

The bridge checks the declared family, loaded indices, exact construction flags and modern queue compatibility before every path query and again before execution. Legacy paths and queues remain supported, including the ignored railings argument. Overlapping numeric indices use the flag-selected namespace rather than guessing a family. Catalog and map inspection now expose enough information to choose and read back modern versus legacy references.

After integrating both construction guards, `npm run build` and all 99 automated tests passed in the Linux cloud workspace. The 24 path regression tests cover valid modern/legacy paths and queues; both mismatch directions; overlapping namespaces; unknown bits and integer wrapping; invalid/missing objects and queue metadata; direct/batch execution; live changes after query or between steps; partial costs and receipt no-replay; native clearance rejection; removal; catalog discovery; and map read-back. `git diff --check` and JavaScript syntax checks also passed. These are mocked-engine tests and source inspection, not native render or guest-flow acceptance. No game was launched, installed, or modified, and no existing park paths were repaired.
