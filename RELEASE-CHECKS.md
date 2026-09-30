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
- Native maze construction, gate changes, guest access and guest completion have not yet been verified. This update does not qualify fresh-machine setup or claim turnkey installation.
