[CmdletBinding()]
param(
    [string]$Park,
    [string]$Rct2Path = 'C:\Program Files (x86)\Steam\steamapps\common\Rollercoaster Tycoon 2',
    [switch]$Headless
)
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path $PSScriptRoot -Parent
$connection = [System.Net.Sockets.TcpClient]::new()
try {
    $bridgeConfig = Get-Content -LiteralPath (Join-Path $bridgeRoot 'bridge.config.json') -Raw | ConvertFrom-Json
    $connect = $connection.ConnectAsync('127.0.0.1', [int]$bridgeConfig.port)
    try { $null = $connect.Wait(500) } catch { }
    if ($connection.Connected) { throw 'The agent-ready game is already running. Switch to its OpenRCT2 window.' }
} finally { $connection.Dispose() }
$exe = Get-ChildItem -LiteralPath (Join-Path $bridgeRoot 'runtime\v0.5.5') -Recurse -File -Filter 'openrct2.exe' | Select-Object -First 1
if (-not $exe) { throw 'Run scripts/Install-Bridge.ps1 first' }
if (-not (Test-Path -LiteralPath (Join-Path $Rct2Path 'Data\g1.dat'))) { throw 'RCT2 assets not found; provide -Rct2Path' }
if ($Headless -and -not $Park) { throw 'Headless mode requires a park/scenario file' }
$arguments = @()
if ($Park) { $resolvedPark = (Resolve-Path -LiteralPath $Park).Path; $arguments += ('"' + $resolvedPark + '"') }
$profileRoot = Join-Path $bridgeRoot 'user-data'
$arguments += @('--user-data-path', ('"' + $profileRoot + '"'), '--rct2-data-path', ('"' + $Rct2Path + '"'))
if ($Headless) { $arguments += '--headless' }
$logRoot = Join-Path $bridgeRoot 'logs'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$launch = @{FilePath=$exe.FullName; ArgumentList=$arguments; WorkingDirectory=$exe.DirectoryName; PassThru=$true;
    RedirectStandardOutput=(Join-Path $logRoot "openrct2-$stamp.stdout.log"); RedirectStandardError=(Join-Path $logRoot "openrct2-$stamp.stderr.log")}
if ($Headless) { $launch.WindowStyle = 'Hidden' }
$process = Start-Process @launch
Write-Output "OpenRCT2 PID: $($process.Id)"
Write-Output 'Bridge starts read-only. Inspect with: node cli.js hello'
