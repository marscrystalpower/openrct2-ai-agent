# Share-package checks

## Outward-only exit coverage and native signs — 2026-10-15 (0.1.9)

The build and all 455 automated tests pass with none skipped. Endpoint-specific amenity traversal preserves no-entry restrictions: exits use forward paths with outward park access, while shops retain round-trip public coverage. Independent replay of a fresh private native graph resolves all three earlier unknown exit areas without removing signs or masking the coaster's genuine shortfalls. Native banner placement, removal and no-entry toggling add three guarded actions (44 total); the explicit source allowlist contains 78 files. The manifest includes both new capabilities, and exact fields/semantics are checked against pinned native source. After hash-verified installation, ordinary automatic park/ride reports and a fresh native audit matched the replay: all 26 sites complete, nineteen passing, seven advisory and zero unknown, with all 54 navigation endpoints healthy. The three protected exits passed while the coaster's furniture shortfalls remained visible. Paused gameplay state was unchanged and the session remained unarmed and idle. No gameplay changes were issued. Newly placing or toggling a banner in the native game remains untested; its coverage is pinned source and mocked commands. See VERIFICATION.md for evidence and limits.

## Local amenity coverage — 2026-10-15 (0.1.8)

The build and all 426 automated tests pass with none skipped. `local-amenities-v1` identifies the bounded native-graph coverage inspector. It and its tests are added to the explicit 77-file source allowlist. The new reports expose local exit and food/drink counts, first-item distances, shared furniture and incomplete evidence separately from structural access; recommendations are documented as user design heuristics. Independent review resolved failed-empty-report certainty, native signed rating limits, unloaded furniture and custom bin-slot uncertainty. The existing profile's two installed bridge files match the tested build, with a private backup preserved. Native paused-park acceptance detected the coaster's complete local bench/bin shortfalls automatically and reproduced them in a fresh audit: seven advisory sites, sixteen passing sites and three unknown exit areas overall, with all 54 navigation endpoints healthy. The three unknown areas reveal the documented bidirectional-public-subset limitation in 0.1.8 and prevent a full park clearance claim for that version. No game mutations were issued; see VERIFICATION.md for evidence and limits.

## Design, furniture and pricing — 2026-10-15 (0.1.7)

The build and all 386 automated tests pass. The source manifest advertises `ride-design-review-v1`, `path-furniture-v1` and `pricing-guidance-v1`; runtime inspectors, metadata generators/references and tests are present in the explicit 75-file package allowlist. The archive was inspected for private paths, credentials and excluded runtime/save/media directories. Native-data replay detects the wooden-coaster design faults, while bundled mocked tests cover automatic reports, furniture damage and photo underpricing. After hash-verified installation and user reopening, the live paused park's automatic overview detected all four intended issues with complete native design/furniture evidence. The source identity matched and no gameplay mutations were issued. See VERIFICATION.md for evidence boundaries.

## Automatic facility access — 2026-10-15

Bridge 0.1.6 builds and passes all 318 tests. Its source manifest includes the access inspector, scheduler/cache, source extractor, generated metadata and `facility-access-v1` capability. The explicit source allowlist includes all three new test files and no private native evidence. A live, unarmed, paused park overview automatically found all five known access failures in 604 ms, including both shop/facility doorway failures; all three park gates and the valid ride exit remained healthy. Fresh audit and per-ride results agreed, with unchanged park snapshots. See VERIFICATION.md for limits and coverage.

## Path inspection — 2026-10-15

Bridge 0.1.5 adds a bounded native path navigator wrapper, early connection diagnostics and directed route tracing. The build and all 237 automated tests pass, including 28 path-inspection tests; PowerShell parser checks and whitespace validation also pass. The build manifest hashes `src/path-inspector.js` and advertises `path-inspection-v1`; the explicit package allowlist includes that module and its regression tests. The source package excludes private configuration, authenticated bundles, upstream checkouts, game profiles, saves and evidence. See VERIFICATION.md for source and automated-test scope. Installation and fresh native-game verification remain separate from this source update.

## Ride inspector — 2026-10-10

Bridge 0.1.4 builds against the existing pinned engine and passes 209 automated tests. A separate native instance inspected 79 rides/facilities and 32 active fleets without changing the paused park; see VERIFICATION.md for the cross-check scope. The source allowlist includes `src/ride-inspector.js` and `test/ride-inspector.test.js`, and the runtime source manifest includes the new module and `ride-inspection-v1` capability. Local profile/configuration, authenticated bundles, native evidence and park copies remain excluded. This change does not qualify a fresh-machine installation or deploy to the user's active game.

## Currency and source identity — 2026-10-10

Bridge 0.1.3 passes 195 automated tests and native USD display/installation checks. The package includes native money formatting, profile settings parsing, token-free source identity, source/edit preflight tests and the public bridge manifest. Source and installed bundle checks retain private authentication, profile paths, saves and journals locally. See VERIFICATION.md for native scope.

## OpenRCT2 0.5.6 update — 2026-10-10

Bridge 0.1.2 builds against the pinned OpenRCT2 0.5.6 commit and passes all 166 automated tests, including local TCP tests. Native gameplay, all 18 added palette IDs, save/reload and read-only session revocation were checked; see VERIFICATION.md for scope and limitations. PowerShell scripts parse and an independent source review found no runtime defects. The package allowlist includes the compatibility manifest, colour generator, colour catalog and regression tests. Configuration, built authenticated plugins, runtime files, saves, screenshots and receipts remain excluded.

## Previous package checks

Prepared 2026-09-19.

- Clean copy built using a local clone of the pinned upstream commit. Build produced 39 action schemas and 353 named track identifiers.
- All 31 automated tests passed, including geometry, real local TCP, authentication, read-only startup, budget limits, partial construction, STOP, session revocation and no-replay behavior. Plugin tests mock the game API.
- All four PowerShell scripts passed parser checks.
- Core runtime, CLI, build/extraction code and existing tests match the original implementation byte for byte. Sharing changes concern documentation, setup orchestration and source packaging.
- Source audit checked for the author's actual authentication token, Windows user paths, personal session/save markers and email addresses. None were found. Private folders, saves and media are excluded.
- The ZIP is generated from an explicit 28-file allowlist. It includes the license, attribution, source, fixtures, examples, setup scripts, agent instructions and a Skool post draft. Generated authentication configuration and plugin bundles are not distributed.

The build used existing upstream source through a local clone, not a fresh network download. Full setup, prerequisite installation and native game launch on a new member's PC have not been tested during this packaging pass. Historical native game results are summarized separately in VERIFICATION.md. No claim is made that all coaster designs are safe or all actions have native coverage.

Publication review: setup now expands test filenames explicitly in PowerShell for compatibility with Node 20. This small setup-script change was reviewed without rerunning tests. Fresh-machine acceptance was deferred at the publisher's request; it is not a publication prerequisite for this community test release.

Repository: https://github.com/FTPAiYT/openrct2-agent-bridge

## Maze source update, 2026-09-29 (0.1.1)

- Build inputs were compared with the Git blob IDs at pinned engine commit 8694e3483690323b6a75fa7264b6c58116f51f31. The cached copies matched after removing extra trailing blank lines; no engine source was changed.
- The build produced 41 action schemas and 353 track identifiers. All 43 automated tests passed, including 12 maze tests; plugin and maze tests mock the engine. Client tests use real local TCP.
- Existing geometry/build assertions now match the current 12-piece banked syntax example. Historical 48-piece native evidence remains separate.
- The explicit 29-file source archive was inspected for private paths and credentials. The old token-bearing root bundle is removed from the current source tree and ignored; new bundles and tokens are built locally. This does not rewrite earlier Git history.
- At publication of 0.1.1, native maze construction, gate changes, guest access and guest completion were still pending; subsequent evidence is recorded below. This update does not qualify fresh-machine setup or claim turnkey installation.

## Multi-route maze checks, 2026-09-29

- README now favors two or three exit routes and evaluates escape thoughts, waiting times and sustained completion rates. AGENTS.md is unchanged.
- The offline checker applies pinned native gate rules, verifies wall reciprocity and reachability, and checks independent routes between gate regions. Its CLI rejects invalid layouts and single-route layouts. The example has three route choices, two cycles and a six-cell shortest solution; these are topology results rather than predictions of guest behavior.
- All 50 automated tests passed. Regression checks cover one and two remaining routes, a loop with an exit bottleneck, disconnected exits, malformed masks and coordinates, unintended openings and input immutability. The CLI accepted the multi-route example and rejected the single-route case.
- The inspected source archive includes the checker and example through the explicit packaging allowlist. Installed plugin code and native action schemas do not change in this update.
- Native construction and guest completion were verified for the original single-route maze, while reported congestion showed that better throughput needs additional design and operating checks. The revised multi-route example has not been built or observed in the native game.
