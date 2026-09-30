# Share-package checks

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
