# PeerDesk Windows Build Script
# Run on a Windows machine with Rust + Node.js installed
# Requirements: Rust 1.78+, Node.js 20+, WebView2 Runtime

param(
    [string]$SignCert = "",
    [string]$SignPassword = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent

Write-Host "Building PeerDesk for Windows..." -ForegroundColor Green

Set-Location "$Root\desktop"

# Frontend
Write-Host "Building frontend..." -ForegroundColor Cyan
npm ci
npm run build

# Install Tauri CLI if needed
if (-not (Get-Command "cargo-tauri" -ErrorAction SilentlyContinue)) {
    Write-Host "Installing tauri-cli..." -ForegroundColor Cyan
    cargo install tauri-cli --version "^2" --locked
}

# Build
Write-Host "Building Tauri app..." -ForegroundColor Cyan
cargo tauri build

Write-Host ""
Write-Host "Build complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Packages:"
Get-ChildItem "src-tauri\target\release\bundle" -Recurse -Include "*.msi","*.exe","*.nsis" -ErrorAction SilentlyContinue |
    Select-Object @{N="Size";E={"{0:N1} MB" -f ($_.Length/1MB)}}, FullName |
    Format-Table -AutoSize
