# PeerDesk Agent — Windows installer (run as Administrator)
# Usage:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Ancyent/peerdesk/main/scripts/deploy/install.ps1))) -Server "https://api.example.com" -ApiKey "YOUR_TOKEN"
#   .\install.ps1 -Server "https://api.example.com" -ApiKey "YOUR_TOKEN"

param(
    [string]$ApiKey = "",
    [string]$Server = "",
    [string]$Password = ""
)

$ErrorActionPreference = "Stop"
$InstallDir = "$env:ProgramFiles\PeerDesk"
$BinaryPath = "$InstallDir\peerdesk-agent.exe"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: Run this script as Administrator." -ForegroundColor Red
    exit 1
}

if (-not $Server) {
    Write-Error "-Server <url> is required to resolve the agent binary (e.g. -Server https://api.example.com)."
    exit 1
}

Write-Host "==> Resolving agent binary from $Server..."
# Resolve from the PeerDesk server, not the GitHub API — see install.sh.
$manifest = Invoke-RestMethod -Uri "$Server/api/releases/latest"
# Match the agent's name shape, not the substring "windows": that also matches
# the Windows viewer installers (peerdesk-viewer-windows-*), and asset order
# in the manifest is controlled by GitHub, not us.
$asset = $manifest.assets | Where-Object { $_.name -like "peerdesk-agent-windows*" } | Select-Object -First 1
if (-not $asset) {
  Write-Error "No Windows agent binary in $Server/api/releases/latest — the server may not have fetched a release yet."
  exit 1
}
$DownloadUrl = "$Server/api/releases/download/$($asset.name)"

if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir | Out-Null }
Write-Host "==> Downloading $($asset.name)..."
Invoke-WebRequest -Uri $DownloadUrl -OutFile $BinaryPath
Write-Host "==> Installed to $BinaryPath"

# The access password is the gate for connecting. Generate one if not supplied,
# and print it below so the machine is actually reachable.
$GeneratedPw = $false
if (-not $Password) {
    $Password = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 14 | ForEach-Object { [char]$_ })
    $GeneratedPw = $true
}

$ExtraArgs = @()
if ($Server)   { $ExtraArgs += "--server=$Server" }
if ($ApiKey)   { $ExtraArgs += "--api-key=$ApiKey" }
if ($Password) { $ExtraArgs += "--password=$Password" }

Write-Host "==> Installing Windows service..."
& $BinaryPath --install-service @ExtraArgs

$PeerID = (& $BinaryPath --get-id 2>$null) -join ""

Write-Host ""
Write-Host "===============================================" -ForegroundColor Green
Write-Host " PeerDesk Agent installed successfully!"       -ForegroundColor Green
Write-Host " Peer ID : $PeerID"
Write-Host " Password: $Password"
Write-Host " Service : Get-Service peerdesk-agent"
Write-Host " Logs    : $env:APPDATA\peerdesk\agent.log"
Write-Host "===============================================" -ForegroundColor Green
if ($GeneratedPw) {
    Write-Host " NOTE: password auto-generated - save it. Connect with Peer ID + Password." -ForegroundColor Yellow
    Write-Host "       Pass -Password YOUR_PW to choose your own." -ForegroundColor Yellow
}
