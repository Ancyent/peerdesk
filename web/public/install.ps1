# PeerDesk Agent — Windows installer (run as Administrator)
# Usage:
#   irm https://raw.githubusercontent.com/Ancyent/peerdesk/main/scripts/deploy/install.ps1 | iex
#   .\install.ps1 -Server "https://api.example.com" -Token "YOUR_TOKEN"

param(
    [string]$Token  = "",
    [string]$Server = ""
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

$ExtraArgs = @()
if ($Server) { $ExtraArgs += "--server=$Server" }
if ($Token)  { $ExtraArgs += "--token=$Token"  }

Write-Host "==> Installing Windows service..."
& $BinaryPath --install-service @ExtraArgs

$PeerID = (& $BinaryPath --get-id 2>$null) -join ""

Write-Host ""
Write-Host "===============================================" -ForegroundColor Green
Write-Host " PeerDesk Agent installed successfully!"       -ForegroundColor Green
Write-Host " Peer ID : $PeerID"
Write-Host " Service : Get-Service peerdesk-agent"
Write-Host " Logs    : $env:APPDATA\peerdesk\agent.log"
Write-Host "===============================================" -ForegroundColor Green
