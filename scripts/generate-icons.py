#!/usr/bin/env python3
"""Generate every icon and wordmark asset PeerDesk ships, from the originals.

Sources (put originals in branding/source/):
    branding/source/peerdesk_logo.png   the mark, transparent background
    branding/source/peerdesk_text.png   "PeerDesk" wordmark, transparent

Run:
    python3 scripts/generate-icons.py

The mark is cropped to its real alpha bounds, squared, and padded to a safe
area — Android masks the outer edge of adaptive icons, so artwork touching the
border gets clipped. The padded result is written to
branding/icon-master-1024x1024.png, and everything else derives from it.

If no source exists, a placeholder bolt is drawn so the pipeline stays testable.

Requires Pillow only.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

SRC_LOGO = ROOT / "branding" / "source" / "peerdesk_logo.png"
SRC_WORDMARK = ROOT / "branding" / "source" / "peerdesk_text.png"

MASTER = ROOT / "branding" / "icon-master-1024x1024.png"
OUT_BRANDING = ROOT / "branding" / "icons"
OUT_WORDMARK = ROOT / "branding" / "wordmark"
OUT_WEB = ROOT / "web" / "public"
OUT_TAURI = ROOT / "desktop" / "src-tauri" / "icons"

# Brand colours, matching web/src/branding.css.
BG_DARK = (24, 32, 48, 255)   # --bg-base #182030
MARK = (134, 59, 255, 255)    # placeholder purple, only used without a source

# Fraction of the canvas left empty around the mark. Android adaptive icons can
# mask roughly the outer quarter; 10% a side clears that without shrinking the
# mark to a dot.
SAFE_PAD = 0.10

# Alpha at or below this counts as empty when finding real bounds. The sources
# carry a soft outer glow fading to nothing, and a plain getbbox() would keep
# every last invisible pixel of it.
ALPHA_FLOOR = 12

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

ICO_SIZES = [16, 32, 48, 64, 128, 256]

# Wordmark heights; width follows the source aspect ratio.
WORDMARK_HEIGHTS = [32, 48, 64, 96, 128, 256]


def trimmed(img: Image.Image) -> Image.Image:
    """Crop to where the artwork is actually visible."""
    mask = img.getchannel("A").point(lambda v: 255 if v > ALPHA_FLOOR else 0)
    box = mask.getbbox()
    return img.crop(box) if box else img


def squared_with_padding(mark: Image.Image, size: int = 1024) -> Image.Image:
    """Centre the mark on a transparent square, keeping the safe margin."""
    inner = round(size * (1 - 2 * SAFE_PAD))
    w, h = mark.size
    scale = inner / max(w, h)
    fitted = mark.resize((max(1, round(w * scale)), max(1, round(h * scale))),
                         Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    fw, fh = fitted.size
    canvas.paste(fitted, ((size - fw) // 2, (size - fh) // 2), fitted)
    return canvas


def draw_placeholder(size: int) -> Image.Image:
    from PIL import ImageDraw

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([(0, 0), (size - 1, size - 1)],
                        radius=max(2, round(size * 0.22)), fill=BG_DARK)
    bolt = [(0.56, 0.06), (0.22, 0.56), (0.45, 0.56),
            (0.38, 0.94), (0.76, 0.44), (0.53, 0.44)]
    d.polygon([(x * size, y * size) for x, y in bolt], fill=MARK)
    return img


def build_master() -> Image.Image:
    if SRC_LOGO.exists():
        master = squared_with_padding(trimmed(Image.open(SRC_LOGO).convert("RGBA")))
        master.save(MASTER)
        print(f"master: built from {SRC_LOGO.relative_to(ROOT)} "
              f"(trimmed, squared, {int(SAFE_PAD * 100)}% safe margin)")
        return master

    if MASTER.exists():
        print(f"master: {MASTER.relative_to(ROOT)} (no source; reusing)")
        return Image.open(MASTER).convert("RGBA")

    master = draw_placeholder(1024)
    master.save(MASTER)
    print(f"master: no source found — wrote placeholder to {MASTER.relative_to(ROOT)}")
    return master


def emit_wordmark() -> None:
    if not SRC_WORDMARK.exists():
        print("\nwordmark: no source, skipped")
        return

    src = trimmed(Image.open(SRC_WORDMARK).convert("RGBA"))
    w, h = src.size
    OUT_WORDMARK.mkdir(parents=True, exist_ok=True)
    print(f"\nbranding/wordmark/   — from {SRC_WORDMARK.relative_to(ROOT)} "
          f"({w}x{h} after trim)")

    for height in WORDMARK_HEIGHTS:
        width = max(1, round(w * height / h))
        img = src.resize((width, height), Image.LANCZOS)
        name = f"peerdesk-wordmark-{width}x{height}.png"
        img.save(OUT_WORDMARK / name)
        img.save(OUT_WEB / name)   # served by the web app
        print(f"  {name}")
    print("  (also copied into web/public/ so the app can serve them)")


def main() -> int:
    for d in (OUT_BRANDING, OUT_WEB, OUT_TAURI, MASTER.parent):
        d.mkdir(parents=True, exist_ok=True)

    master = build_master()

    rendered: dict[int, Image.Image] = {}
    print("\nbranding/icons/   — dimension-named, transparent background")
    for size, purpose in SIZES:
        img = master.resize((size, size), Image.LANCZOS)
        rendered[size] = img
        name = f"peerdesk-icon-{size}x{size}.png"
        img.save(OUT_BRANDING / name)
        print(f"  {name:<30} {purpose}")

    print("\nweb/public/")
    for size in (16, 32, 180, 192, 512):
        name = f"peerdesk-icon-{size}x{size}.png"
        rendered[size].save(OUT_WEB / name)
        print(f"  {name}")

    # Older .ico consumers ignore alpha, so flatten onto the brand dark rather
    # than letting them composite the mark onto whatever they please.
    ico = Image.new("RGBA", rendered[256].size, BG_DARK)
    ico.alpha_composite(rendered[256])
    ico.save(OUT_WEB / "favicon.ico", format="ICO",
             sizes=[(s, s) for s in ICO_SIZES])
    print("  favicon.ico                    "
          + ", ".join(f"{s}x{s}" for s in ICO_SIZES))

    print("\ndesktop/src-tauri/icons/   — fixed names required by Tauri")
    for name, size in {"32x32.png": 32, "128x128.png": 128,
                       "128x128@2x.png": 256, "icon.png": 512}.items():
        rendered[size].save(OUT_TAURI / name)
        print(f"  {name:<30} {size}x{size}")
    ico.save(OUT_TAURI / "icon.ico", format="ICO",
             sizes=[(s, s) for s in ICO_SIZES])
    print("  icon.ico                       multi-size (flattened on dark)")

    emit_wordmark()

    print("\nNot generated: icon.icns (macOS) — Pillow cannot write it, and this")
    print("project does not build macOS. Android launcher icons come from")
    print("`cargo tauri android init`, derived from the Tauri set above.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
