# Drop original artwork here

This directory holds the **originals** you provide. Nothing here is consumed by
a build directly — `scripts/generate-icons.py` derives everything shipped from
`branding/icon-master-1024x1024.png`, and that master is produced from what
lands here.

Keep the originals even after the icons are generated: regenerating from a
resized copy loses quality every time.

## What to put here

| Filename | Format | Notes |
|---|---|---|
| `logo-1024x1024.png` | PNG | Square, transparent background. The safest input. |
| `logo.svg` | SVG | Optional. Preferred in principle — see the caveat below. |
| `wordmark.png` | PNG | The "PeerDesk" lettering. Any aspect ratio, transparent. |
| `wordmark.svg` | SVG | Optional, same caveat. |

Exact names are not critical — anything descriptive works, I will find them.

## Requirements for the icon source

- **Square, 1024×1024.** A non-square source gets stretched or letterboxed.
- **Transparent background** if possible; backgrounds are composited per
  platform (iOS in particular handles transparency badly).
- **Mark inside the central ~80%.** Android adaptive icons mask the outer edge,
  so anything touching the border can be cropped away.
- **No fine detail or text.** The icon renders at 16×16 in a browser tab; thin
  strokes and lettering disappear at that size.

## SVG caveat

SVG is supported (rasterised with cairosvg in a local venv), but the existing
`web/public/favicon.svg` renders **black instead of purple** and is 48×46 rather
than square — its colours do not survive rasterisation cleanly. If you send SVG,
I render it and check visually before relying on it; if it comes out wrong I
will ask for a PNG instead.

## About the wordmark

The "PeerDesk" lettering **cannot be the app icon** — at 16–48 px, text is an
unreadable smudge. It is genuinely useful elsewhere:

- the web app header and login screen,
- the Windows installer banner,
- README and release pages,
- a wide "mark + wordmark" lockup for docs.

Send it and it gets used in those places, not in the icon set.
