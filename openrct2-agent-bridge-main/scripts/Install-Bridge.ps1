[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path $PSScriptRoot -Parent
$release = 'v0.5.5'
$asset = "OpenRCT2-$release-windows-portable-x64.zip"
$runtimeRoot = Join-Path $bridgeRoot "runtime\$release"
$cacheRoot = Join-Path $bridgeRoot 'runtime\downloads'
$bundle = Join-Path $bridgeRoot 'dist\agent-bridge.js'
if (-not (Test-Path -LiteralPath $bundle)) { throw 'Build first: node scripts/build.js' }
$buildInfo = Get-Content -LiteralPath (Join-Path $bridgeRoot 'dist\build-info.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant() -ne $buildInfo.sha256) { throw 'Plugin build hash mismatch' }
New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
$zipPath = Join-Path $cacheRoot $asset
$sumsPath = Join-Path $cacheRoot 'sha256sums.txt'
$releaseUrl = "https://github.com/OpenRCT2/OpenRCT2/releases/download/$release"
Invoke-WebRequest "$releaseUrl/OpenRCT2-$release-sha256sums.txt" -OutFile $sumsPath
if (-not (Test-Path -LiteralPath $zipPath)) { Invoke-WebRequest "$releaseUrl/$asset" -OutFile $zipPath }
$sumLine = Get-Content -LiteralPath $sumsPath | Where-Object { $_ -match ([regex]::Escape($asset) + '$') }
if (@($sumLine).Count -ne 1) { throw 'Release checksum entry missing or ambiguous' }
$expectedHash = ($sumLine -split '\s+')[0].ToLowerInvariant()
if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'OpenRCT2 archive checksum mismatch' }
if (-not (Test-Path -LiteralPath $runtimeRoot)) { Expand-Archive -LiteralPath $zipPath -DestinationPath $runtimeRoot }
$exe = Get-ChildItem -LiteralPath $runtimeRoot -Recurse -File -Filter 'openrct2.exe' | Select-Object -First 1
if (-not $exe) { throw 'OpenRCT2 executable missing from portable archive' }
$pluginRoot = Join-Path $bridgeRoot 'user-data\plugin'
New-Item -ItemType Directory -Force -Path $pluginRoot | Out-Null
$profileConfig = Join-Path $bridgeRoot 'user-data\config.ini'
if (-not (Test-Path -LiteralPath $profileConfig)) {
    Set-Content -LiteralPath $profileConfig -Value "[general]`r`nlanguage = en-GB`r`nplay_intro = false`r`n"
}
$destination = Join-Path $pluginRoot 'agent-bridge.js'
if (Test-Path -LiteralPath $destination) {
    if ((Get-FileHash -LiteralPath $destination).Hash -ne (Get-FileHash -LiteralPath $bundle).Hash) {
        $backupRoot = Join-Path $bridgeRoot 'runtime\plugin-backups'
        New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
        Copy-Item -LiteralPath $destination -Destination (Join-Path $backupRoot ('agent-bridge-' + [guid]::NewGuid().ToString() + '.js'))
    }
}
Copy-Item -LiteralPath $bundle -Destination $destination -Force
if ((Get-FileHash -LiteralPath $destination).Hash -ne (Get-FileHash -LiteralPath $bundle).Hash) { throw 'Installed plugin hash mismatch' }
Write-Output "Installed isolated OpenRCT2: $($exe.FullName)"
Write-Output "Plugin: $destination"
Write-Output 'No Steam files or existing OpenRCT2 profile were modified. Run scripts/Start-Bridge.ps1 when ready.'
