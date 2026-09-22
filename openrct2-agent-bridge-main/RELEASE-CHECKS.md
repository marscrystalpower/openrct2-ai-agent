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
