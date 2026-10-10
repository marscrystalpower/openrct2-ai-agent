[CmdletBinding()]
param([string]$DisplayConfig)
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path $PSScriptRoot -Parent
$compatibility = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'compatibility.json') -Raw | ConvertFrom-Json
$profileRootJson = & node -e 'const p=require("path"),fs=require("fs"),root=process.argv[1],c=JSON.parse(fs.readFileSync(p.join(root,"bridge.config.json"),"utf8"));process.stdout.write(JSON.stringify(require(p.join(root,"cli.js")).profileRoot(c,root)));' $bridgeRoot
if ($LASTEXITCODE -ne 0) { throw 'Invalid selected OpenRCT2 profile path' }
$profileRoot = $profileRootJson | ConvertFrom-Json
$release = 'v' + $compatibility.openrct2
$asset = "OpenRCT2-$release-windows-portable-x64.zip"
$runtimeRoot = Join-Path $bridgeRoot "runtime\$release"
$cacheRoot = Join-Path $bridgeRoot 'runtime\downloads'
$bundle = Join-Path $bridgeRoot 'dist\agent-bridge.js'
if (-not (Test-Path -LiteralPath $bundle)) { throw 'Build first: node scripts/build.js' }
$buildInfo = Get-Content -LiteralPath (Join-Path $bridgeRoot 'dist\build-info.json') -Raw | ConvertFrom-Json
if ($buildInfo.openrct2 -ne $compatibility.openrct2 -or $buildInfo.api -ne $compatibility.api -or $buildInfo.sourceCommit -ne $compatibility.sourceCommit) { throw 'Build compatibility does not match the pinned runtime; rebuild before installing.' }
& node -e 'const p=require("path"),root=process.argv[1],m=require(p.join(root,"scripts/source-manifest.js"));const expected=m.generateBridgeManifest(root),built=require(p.join(root,"dist/build-info.json")).bridgeManifest;if(!built||built.version!==expected.version||built.sourceHash!==expected.sourceHash)throw Error("Build does not match current public bridge source; rebuild before installing");' $bridgeRoot
if ($LASTEXITCODE -ne 0) { throw 'Bridge source identity verification failed' }
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
$pluginRoot = Join-Path $profileRoot 'plugin'
New-Item -ItemType Directory -Force -Path $pluginRoot | Out-Null
$profileConfig = Join-Path $profileRoot 'config.ini'
if (-not (Test-Path -LiteralPath $profileConfig)) {
    $explicitDisplayConfig = [bool]$DisplayConfig
    if (-not $DisplayConfig) { $DisplayConfig = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'OpenRCT2\config.ini' }
    $settings = $null
    if (Test-Path -LiteralPath $DisplayConfig -PathType Leaf) {
        $settingsJson = & node -e 'const fs=require("fs"),p=require(process.argv[2]);process.stdout.write(JSON.stringify(p.parseDisplaySettings(fs.readFileSync(process.argv[1],"utf8"))));' $DisplayConfig (Join-Path $bridgeRoot 'scripts\display-settings.js')
        if ($LASTEXITCODE -ne 0) { throw 'Could not read display settings from the selected OpenRCT2 profile' }
        $settings = $settingsJson | ConvertFrom-Json
    }
    if ($explicitDisplayConfig -and -not $settings) { throw 'Selected DisplayConfig is missing or has invalid/ambiguous currency and language settings; no profile configuration was created' }
    $lines = @('[general]', 'play_intro = false')
    if ($settings) {
        $lines += 'language = ' + $settings.language
        $lines += 'currency_format = ' + $settings.currencyCode
        if ($settings.currencyCode -eq 'CUSTOM') {
            $lines += 'custom_currency_rate = ' + $settings.customCurrencyRate
            $lines += 'custom_currency_affix = ' + $settings.customCurrencyAffix
            $symbol = $settings.customCurrencySymbol.Replace('\', '\\').Replace('"', '\"')
            $lines += 'custom_currency_symbol = "' + $symbol + '"'
        }
    }
    Set-Content -LiteralPath $profileConfig -Value ($lines -join "`r`n") -Encoding UTF8
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
Copy-Item -LiteralPath (Join-Path $bridgeRoot 'dist\build-info.json') -Destination (Join-Path $pluginRoot 'agent-bridge.build-info.json') -Force
Write-Output "Installed isolated OpenRCT2: $($exe.FullName)"
Write-Output "Plugin: $destination"
Write-Output 'Steam files and existing profile settings were preserved. The plugin was installed into the selected profile. Run scripts/Start-Bridge.ps1 when ready.'
