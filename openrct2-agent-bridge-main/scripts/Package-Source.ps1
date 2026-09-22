[CmdletBinding()]
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path $PSScriptRoot -Parent
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $bridgeRoot 'release-output' }
# Explicit files only: new files require deliberate review before inclusion.
$files = @(
    '.gitignore', 'README.md', 'AGENTS.md', 'SETUP.md', 'START-HERE.md',
    'VERIFICATION.md', 'RELEASE-CHECKS.md', 'SKOOL-POST.md', 'LICENSE', 'package.json', 'cli.js',
    'src/core.js', 'src/plugin.js',
    'scripts/build.js', 'scripts/extract-fixtures.js', 'scripts/Install-Bridge.ps1',
    'scripts/Start-Bridge.ps1', 'scripts/Setup-Bridge.ps1', 'scripts/Package-Source.ps1',
    'test/core.test.js', 'test/plugin.test.js', 'test/client.test.js', 'test/fixtures/segments.json',
    'examples/custom-coaster-plan.json', 'examples/build-coaster.template.json',
    'examples/park-management.template.json', 'generated/actions.json', 'generated/track-names.json'
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
