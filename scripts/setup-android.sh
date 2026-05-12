#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $*"; }

ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"

info "Setting up Android SDK for PeerDesk Android builds..."

# Java
if ! command -v java &>/dev/null; then
  info "Installing OpenJDK 17..."
  apt-get install -y openjdk-17-jdk
fi

# Android command-line tools
if [[ ! -d "$ANDROID_HOME/cmdline-tools/latest" ]]; then
  info "Downloading Android command-line tools..."
  mkdir -p "$ANDROID_HOME"
  cd /tmp
  wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O cmdtools.zip
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  unzip -q cmdtools.zip -d "$ANDROID_HOME/cmdline-tools/"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm cmdtools.zip
fi

export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"

# SDK packages
info "Installing Android SDK packages..."
yes | sdkmanager --licenses > /dev/null 2>&1
sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools" "ndk;26.1.10909125"

# Rust Android targets
info "Adding Rust Android targets..."
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android

# Export paths for shell profiles
cat >> ~/.bashrc << 'EOF'

# Android SDK
export ANDROID_HOME="$HOME/android-sdk"
export NDK_HOME="$ANDROID_HOME/ndk/26.1.10909125"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
EOF

echo ""
echo -e "${BOLD}Android SDK setup complete!${NC}"
echo ""
echo "Initialize Android target in your project:"
echo "  cd desktop && cargo tauri android init"
echo ""
echo "Build APK:"
echo "  bash scripts/build-android.sh"
