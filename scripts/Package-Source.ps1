[CmdletBinding()]
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path $PSScriptRoot -Parent
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $bridgeRoot 'release-output' }
# Explicit files only: new files require deliberate review before inclusion.
$files = @(
    '.gitignore', 'README.md', 'AGENTS.md', 'SETUP.md', 'START-HERE.md',
    'VERIFICATION.md', 'RELEASE-CHECKS.md', 'SKOOL-POST.md', 'LICENSE', 'package.json', 'cli.js',
    'src/core.js', 'src/plugin.js', 'src/track-guard.js', 'src/money.js', 'src/ride-inspector.js', 'src/ride-auditor.js', 'src/pricing-inspector.js', 'src/path-furniture.js', 'src/amenity-inspector.js', 'src/path-inspector.js', 'src/access-inspector.js', 'src/access-monitor.js',
    'scripts/build.js', 'scripts/compatibility.json', 'scripts/colour-palette.js', 'scripts/track-support.js', 'scripts/access-support.js', 'scripts/furniture-support.js', 'scripts/footpath-additions-reference.json', 'scripts/pricing-support.js', 'scripts/extract-fixtures.js', 'scripts/maze-layout.js', 'scripts/Install-Bridge.ps1',
    'scripts/Start-Bridge.ps1', 'scripts/Setup-Bridge.ps1', 'scripts/Package-Source.ps1', 'scripts/display-settings.js', 'scripts/source-manifest.js',
    'test/core.test.js', 'test/plugin.test.js', 'test/scenario.test.js', 'test/banner.test.js', 'test/client.test.js', 'test/maze.test.js', 'test/path.test.js', 'test/ride-inspector.test.js', 'test/ride-auditor.test.js', 'test/pricing-inspector.test.js', 'test/pricing-support.test.js', 'test/path-furniture.test.js', 'test/amenity-inspector.test.js', 'test/furniture-support.test.js', 'test/path-inspector.test.js', 'test/access-inspector.test.js', 'test/access-monitor.test.js', 'test/access-support.test.js', 'test/quality-integration.test.js',
    'test/track.test.js', 'test/track-support-metadata.test.js', 'test/colours.test.js', 'test/money.test.js', 'test/client-identity.test.js', 'test/display-settings.test.js', 'test/source-manifest.test.js', 'test/helpers/track-harness.js', 'test/fixtures/segments.json',
    'examples/custom-coaster-plan.json', 'examples/build-coaster.template.json',
    'examples/park-management.template.json', 'examples/maze-layout.json', 'generated/actions.json', 'generated/colours.json', 'generated/track-names.json', 'generated/track-support.json', 'generated/access-support.json', 'generated/furniture-support.json', 'generated/pricing-support.json', 'generated/bridge-manifest.json'
)
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$archive = Join-Path $OutputDirectory ('openrct2-agent-bridge-source-' + [guid]::NewGuid().ToString() + '.zip')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($archive, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($relative in $files) {
        $file = Join-Path $bridgeRoot $relative
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required source file missing: $relative" }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file, ('openrct2-agent-bridge/' + $relative)) | Out-Null
    }
} finally { $zip.Dispose() }
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($archive + '.sha256') -Value ($hash + '  ' + [System.IO.Path]::GetFileName($archive))
Write-Output $archive
Write-Output "SHA256: $hash"
