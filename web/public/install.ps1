# PeerDesk Agent — Windows installer (run as Administrator)
# Usage:
#   irm https://raw.githubusercontent.com/Ancyent/peerdesk/main/scripts/deploy/install.ps1 | iex
#   .\install.ps1 -Server "https://api.example.com" -ApiKey "YOUR_TOKEN"

param(
    [string]$ApiKey = "",
    [string]$Server = "",
    [string]$Password = ""
)

$ErrorActionPreference = "Stop"
$GitHubRepo = "Ancyent/peerdesk"
$InstallDir = "$env:ProgramFiles\PeerDesk"
$BinaryPath = "$InstallDir\peerdesk-agent.exe"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: Run this script as Administrator." -ForegroundColor Red
    exit 1
}

Write-Host "==> Fetching latest PeerDesk release..."
$Release = Invoke-RestMethod "https://api.github.com/repos/$GitHubRepo/releases/latest"
$Asset   = $Release.assets | Where-Object { $_.name -like "*windows-x86_64.exe" } | Select-Object -First 1

if (-not $Asset) {
    Write-Error "Could not find Windows binary in latest release."
    exit 1
}

if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir | Out-Null }
Write-Host "==> Downloading $($Asset.name)..."
Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $BinaryPath
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
