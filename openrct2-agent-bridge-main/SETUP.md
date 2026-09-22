# Installation and troubleshooting

This is an agent-operated setup guide. Members give the repository link to their agent; they should not have to run these commands themselves.

1. Explain OpenRCT2 as described in README.md and AGENTS.md. Check installation and launch authorization separately against the current conversation.
2. Check Windows x64, node --version (20+), and git --version. If missing, arrange installation from nodejs.org or git-scm.com within the user's authorization. Reopen the shell to refresh PATH if needed. No npm install is required.
3. Find the user's RCT2 folder. Inspect their Steam libraries (including custom drives) or ask for the installation location if it cannot be found. Verify Data/g1.dat. Do not download proprietary game assets. RCT1 assets are not required.
4. Run scripts/Setup-Bridge.ps1 from a writable extracted repository. It obtains OpenRCT2 source at v0.5.5, verifies commit 8694e3483690323b6a75fa7264b6c58116f51f31, builds, runs automated tests and installs the official portable runtime with a checksum check. Each installation gets its own random token. Never copy a token from someone else.
5. When launch is authorized, run scripts/Start-Bridge.ps1 -Rct2Path ACTUAL_FOLDER. Optionally supply -Park with a full path to a user-selected scenario or copy of a save. The launcher creates an isolated user-data profile with en-GB language. Opening the original game from Steam does not load this bridge.
6. Run node cli.js hello, then node cli.js park after opening a scenario. Confirm API 122, read-only mode and the expected park. Ask the user what to build/manage before arming. Save and inspect a unique checkpoint before substantial work.

## Common issues

- **Tiny icons/text:** use OpenRCT2 Options to increase the interface/window scale, starting around 2x. This differs from zooming the park view.
- **Original Steam game asks for DirectPlay or crashes:** verify which executable was launched. This package launches its isolated OpenRCT2 executable; it does not diagnose or repair the original RCT2 executable.
- **Assets not found:** -Rct2Path must name the folder containing Data/g1.dat, not the executable or Data folder itself.
- **PowerShell blocked:** inspect the error and device policy. Use an allowed shell/session policy only with authorization; do not change machine-wide policy or evade organization controls.
- **Download/checksum failure:** stop. Do not skip verification. If the cached archive is corrupt, remove only that confirmed archive and download again.
- **Wrong source revision:** setup stops rather than resetting an existing checkout. Preserve local edits; arrange a separate clean upstream checkout at the pinned commit.
- **Connection refused:** check that OpenRCT2 is running through Start-Bridge.ps1, inspect logs locally, verify plugin installation and API version. Do not expose the port beyond localhost or add public firewall rules.
- **Already running:** use the existing matching instance. Do not start competing instances with the same port/profile.
- **Authentication failure:** rebuild and reinstall the plugin from the same local config with the game closed. Do not print or share the token.
- **Crash/disconnection during a mutation:** do not retry. Follow receipt/state reconciliation in README.md. Runtime logs and park saves may contain private information; redact before sharing.

## Updating and uninstalling

Do not auto-upgrade OpenRCT2; compatibility is pinned. Close the game before replacing the plugin. Preserve local config, logs and saves during updates. To uninstall, close the game and remove this installation folder only after the user has preserved saves they want. Steam RCT2 and other OpenRCT2 profiles are separate.
