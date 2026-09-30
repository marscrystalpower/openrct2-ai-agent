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

Native maze construction, gate effects, access and guests completing the maze remain pending an authorized gameplay session. No save or screenshot is included in the source package.
