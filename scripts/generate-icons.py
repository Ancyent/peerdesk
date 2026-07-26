#!/usr/bin/env python3
"""Generate every icon PeerDesk ships, from one master image.

To change the icon, replace this file:

    branding/icon-master-1024x1024.png

then re-run:

    python3 scripts/generate-icons.py

Everything else is derived. A new logo never means hunting for stray PNGs.

If the master is missing, a placeholder is drawn — a purple bolt on the brand's
dark surface, matching web/public/favicon.svg — so the pipeline works before
real artwork exists.

Requires Pillow only; no SVG rasteriser needed.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

MASTER = ROOT / "branding" / "icon-master-1024x1024.png"
OUT_BRANDING = ROOT / "branding" / "icons"
OUT_WEB = ROOT / "web" / "public"
OUT_TAURI = ROOT / "desktop" / "src-tauri" / "icons"

# Brand colours, matching web/src/branding.css and web/public/favicon.svg.
BG = (24, 32, 48, 255)        # --bg-base  #182030
MARK = (134, 59, 255, 255)    # brand purple #863bff

# Every size we emit, and what each is for. One list, so adding a platform is
# a new row rather than an edit in three places.
SIZES = [
    (16, "web favicon (browser tab)"),
    (32, "web favicon / Tauri 32x32.png"),
    (48, "Android mdpi launcher"),
    (64, "Windows small tile"),
    (72, "Android hdpi launcher"),
    (96, "Android xhdpi launcher"),
    (128, "Tauri 128x128.png"),
    (144, "Android xxhdpi launcher"),
    (180, "iOS apple-touch-icon"),
    (192, "Android xxxhdpi launcher, PWA"),
    (256, "Tauri 128x128@2x.png"),
    (512, "PWA install, store listing"),
    (1024, "master, store upload"),
]

# Multi-resolution .ico contents; Windows picks the closest.
ICO_SIZES = [16, 32, 48, 64, 128, 256]


def draw_placeholder(size: int) -> Image.Image:
    """A bolt on a rounded square, redrawn per size so edges stay crisp."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = max(2, round(size * 0.22))
    d.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=BG)

    bolt = [
        (0.56, 0.06), (0.22, 0.56), (0.45, 0.56),
        (0.38, 0.94), (0.76, 0.44), (0.53, 0.44),
    ]
    d.polygon([(x * size, y * size) for x, y in bolt], fill=MARK)
    return img


def render(master: Image.Image | None, size: int) -> Image.Image:
    # A real master is resampled; the placeholder is redrawn, which is sharper
    # than downscaling it.
    if master is None:
        return draw_placeholder(size)
    return master.resize((size, size), Image.LANCZOS)


def main() -> int:
    for d in (OUT_BRANDING, OUT_WEB, OUT_TAURI, MASTER.parent):
        d.mkdir(parents=True, exist_ok=True)

    master: Image.Image | None = None
    if MASTER.exists():
        master = Image.open(MASTER).convert("RGBA")
        print(f"master: {MASTER.relative_to(ROOT)}")
    else:
        draw_placeholder(1024).save(MASTER)
        print(f"no master found — wrote a placeholder to "
              f"{MASTER.relative_to(ROOT)}  (replace this file)")

    rendered: dict[int, Image.Image] = {}

    print("\nbranding/icons/   — dimension-named, the set to inspect")
    for size, purpose in SIZES:
        img = render(master, size)
        rendered[size] = img
        name = f"peerdesk-icon-{size}x{size}.png"
        img.save(OUT_BRANDING / name)
        print(f"  {name:<30} {purpose}")

    print("\nweb/public/")
    for size in (16, 32, 180, 192, 512):
        name = f"peerdesk-icon-{size}x{size}.png"
        rendered[size].save(OUT_WEB / name)
        print(f"  {name}")
    rendered[256].save(OUT_WEB / "favicon.ico", format="ICO",
                       sizes=[(s, s) for s in ICO_SIZES])
    print("  favicon.ico                    "
          + ", ".join(f"{s}x{s}" for s in ICO_SIZES))

    # Tauri's bundler looks these up by exact filename, so they cannot carry
    # dimensions in their names.
    print("\ndesktop/src-tauri/icons/   — fixed names required by Tauri")
    for name, size in {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
    }.items():
        rendered[size].save(OUT_TAURI / name)
        print(f"  {name:<30} {size}x{size}")
    rendered[256].save(OUT_TAURI / "icon.ico", format="ICO",
                       sizes=[(s, s) for s in ICO_SIZES])
    print("  icon.ico                       multi-size")

    print("\nNot generated: icon.icns (macOS) — Pillow cannot write that format,")
    print("and this project does not build macOS.")
    print("Android launcher icons come from `cargo tauri android init`, which")
    print("derives them from desktop/src-tauri/icons/, so they follow along.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
