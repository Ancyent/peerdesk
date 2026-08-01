"""Type and dimensions from the file header alone.

No decoding library, for two reasons: dimensions are all we need, and a decoder
is a large attack surface to point at untrusted bytes. Header parsing is bounded
work regardless of what the file claims about itself.
"""
import re
import struct
from dataclasses import dataclass

SVG_ROOT_RE = re.compile(rb"<svg[\s>/]", re.IGNORECASE)


@dataclass(frozen=True)
class ImageInfo:
    kind: str
    width: int
    height: int


def _png(data: bytes) -> ImageInfo | None:
    if len(data) < 24 or data[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return ImageInfo("png", width, height)


def _jpeg(data: bytes) -> ImageInfo | None:
    # Walk the segment chain to the first start-of-frame. Bounded by len(data),
    # so a malformed chain terminates rather than looping.
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        # SOF0-SOF15, excluding the three markers in that range that are not
        # frame headers.
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height, width = struct.unpack(">HH", data[i + 5:i + 9])
            return ImageInfo("jpeg", width, height)
        (length,) = struct.unpack(">H", data[i + 2:i + 4])
        if length < 2:
            return None
        i += 2 + length
    return None


def _webp(data: bytes) -> ImageInfo | None:
    if len(data) < 30 or data[8:12] != b"WEBP":
        return None
    chunk = data[12:16]
    if chunk == b"VP8X":
        width = int.from_bytes(data[24:27], "little") + 1
        height = int.from_bytes(data[27:30], "little") + 1
        return ImageInfo("webp", width, height)
    if chunk == b"VP8L":
        (bits,) = struct.unpack("<I", data[21:25])
        return ImageInfo("webp", (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
    if chunk == b"VP8 ":
        width, height = struct.unpack("<HH", data[26:30])
        return ImageInfo("webp", width & 0x3FFF, height & 0x3FFF)
    return None


def _is_svg(data: bytes) -> bool:
    """Check if data is an SVG document.

    Skips optional preamble (BOM, whitespace, XML prolog, DOCTYPE, comments)
    and verifies that the first real content is the <svg> root element.
    Stays bounded within the first 1024 bytes.
    """
    bound = min(len(data), 1024)
    i = 0

    # Skip UTF-8 BOM
    if data[i:i+3] == b"\xef\xbb\xbf":
        i += 3

    while i < bound:
        # Skip whitespace
        while i < bound and data[i:i+1] in (b" ", b"\t", b"\n", b"\r"):
            i += 1

        if i >= bound:
            return False

        # Check for XML prolog
        if data[i:i+5] == b"<?xml":
            # Skip to end of prolog
            end = data.find(b"?>", i)
            if end == -1:
                return False
            i = end + 2
            continue

        # Check for DOCTYPE
        if data[i:i+9].upper() == b"<!DOCTYPE":
            # Skip to end of DOCTYPE
            end = data.find(b">", i)
            if end == -1:
                return False
            i = end + 1
            continue

        # Check for comment
        if data[i:i+4] == b"<!--":
            # Skip to end of comment
            end = data.find(b"-->", i)
            if end == -1:
                return False
            i = end + 3
            continue

        # If we get here, we've reached the root element; it must be <svg>
        return SVG_ROOT_RE.match(data[i:i+5]) is not None

    return False


def probe(data: bytes) -> ImageInfo | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return _png(data)
    if data.startswith(b"\xff\xd8\xff"):
        return _jpeg(data)
    if data.startswith(b"RIFF"):
        return _webp(data)
    if data.startswith(b"wOF2"):
        return ImageInfo("woff2", 0, 0)
    # SVG is text, so it is recognised by content rather than a byte signature.
    # Only the head is searched: a huge file with <svg> buried at the end is not
    # an SVG worth accepting. The root element must be <svg>, not just any
    # occurrence of the tag.
    if _is_svg(data):
        return ImageInfo("svg", 0, 0)
    return None
