# Build environment for self-hosted client builds. Toolchains only - the build
# logic lives in build.sh so this layer stays cacheable.
#
# No Wine. It was installed during the investigation on the assumption that WiX
# needed it, and nothing used it: wixl builds MSIs natively on Linux.
FROM rust:1-bookworm

# mingw-w64, pinned as the full set. Two experiments failed here, first on
# dlltool and then on g++, before this was mirrored from a host where the
# Windows cross-build already worked. Do not trim to gcc-mingw-w64-x86-64 alone.
RUN apt-get update && apt-get install -y --no-install-recommends \
      binutils-mingw-w64-x86-64 \
      gcc-mingw-w64-base gcc-mingw-w64-x86-64 \
      gcc-mingw-w64-x86-64-posix gcc-mingw-w64-x86-64-posix-runtime \
      gcc-mingw-w64-x86-64-win32 gcc-mingw-w64-x86-64-win32-runtime \
      g++-mingw-w64-x86-64 g++-mingw-w64-x86-64-posix g++-mingw-w64-x86-64-win32 \
      mingw-w64-common mingw-w64-x86-64-dev \
 && rm -rf /var/lib/apt/lists/*

# Windows packaging. Debian splits these: msitools ships only the inspection
# tools and leaves no wixl on PATH, which cost one experiment to discover.
#
# minisign is here for verification, not signing: Tauri's updater signatures are
# minisign signatures, so this is what lets a build prove its artifacts verify
# against the operator's key and fail against anyone else's.
RUN apt-get update && apt-get install -y --no-install-recommends \
      wixl wixl-data msitools nsis uuid-runtime minisign \
 && rm -rf /var/lib/apt/lists/*

# Linux bundling, for the one path where the Tauri CLI works normally because
# host and target agree. libappindicator is what the CLI checks for and panics
# without - it did so even when asked for a Windows target.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
      libssl-dev pkg-config file rpm python3 \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN rustup target add x86_64-pc-windows-gnu

# Pinned deliberately, not the ^2 that CI uses. Cross-compilation is not a path
# Tauri guarantees, so a CLI upgrade is a change that requires re-running the
# feasibility experiments rather than something a rebuild should pick up.
RUN cargo install tauri-cli --version "=2.11.4" --locked

WORKDIR /work
ENTRYPOINT ["/work/deploy/builder/build.sh"]
