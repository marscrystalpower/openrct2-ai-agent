[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path $PSScriptRoot -Parent
Push-Location $bridgeRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20+ is required; arrange installation with the user.' }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required; arrange installation with the user.' }
    $nodeVersion = & node -p 'process.versions.node.split(".")[0]'
    if ($LASTEXITCODE -ne 0 -or [int]$nodeVersion -lt 20) { throw 'Node.js 20+ is required.' }
    $upstream = Join-Path $bridgeRoot 'vendor/OpenRCT2'
    if (-not (Test-Path -LiteralPath $upstream)) {
        & git clone --depth 1 --branch v0.5.5 https://github.com/OpenRCT2/OpenRCT2.git $upstream
        if ($LASTEXITCODE -ne 0) { throw 'Upstream clone failed.' }
    }
    $revision = & git -C $upstream rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $revision -ne '8694e3483690323b6a75fa7264b6c58116f51f31') { throw 'Upstream source does not match the pinned commit. Preserve it and use a clean pinned checkout.' }
    $changes = & git -C $upstream status --porcelain
    if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Upstream checkout has changes; use a clean pinned checkout.' }
    & node scripts/build.js
    if ($LASTEXITCODE -ne 0) { throw 'Bridge build failed.' }
    $testFiles = @(Get-ChildItem -LiteralPath (Join-Path $bridgeRoot 'test') -Filter '*.test.js' -File | ForEach-Object { $_.FullName })
    if ($testFiles.Count -eq 0) { throw 'No automated test files found.' }
    & node --test @testFiles
    if ($LASTEXITCODE -ne 0) { throw 'Automated tests failed; installation stopped.' }
    & (Join-Path $PSScriptRoot 'Install-Bridge.ps1')
    Write-Output 'Setup complete. Game launch is separate; see SETUP.md.'
} finally { Pop-Location }
