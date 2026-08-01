import struct
import zlib

from themes.imageprobe import probe


def png(width: int, height: int) -> bytes:
    ihdr = struct.pack(">II5B", width, height, 8, 6, 0, 0, 0)
    chunk = struct.pack(">I", len(ihdr)) + b"IHDR" + ihdr
    chunk += struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))
    return b"\x89PNG\r\n\x1a\n" + chunk


def jpeg(width: int, height: int) -> bytes:
    sof = b"\xff\xc0" + struct.pack(">HBHHB", 17, 8, height, width, 3)
    return b"\xff\xd8\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00" + b"\x00" * 9 + sof


def webp_vp8x(width: int, height: int) -> bytes:
    body = b"WEBP" + b"VP8X" + struct.pack("<I", 10) + b"\x00" * 4
    body += (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(3, "little")
    return b"RIFF" + struct.pack("<I", len(body)) + body


def test_reads_png_dimensions():
    info = probe(png(1280, 800))
    assert info.kind == "png"
    assert (info.width, info.height) == (1280, 800)


def test_reads_jpeg_dimensions():
    info = probe(jpeg(640, 480))
    assert info.kind == "jpeg"
    assert (info.width, info.height) == (640, 480)


def test_reads_webp_dimensions():
    info = probe(webp_vp8x(300, 200))
    assert info.kind == "webp"
    assert (info.width, info.height) == (300, 200)


def test_detects_svg_and_reports_no_raster_size():
    info = probe(b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')
    assert info.kind == "svg"
    assert (info.width, info.height) == (0, 0)


def test_detects_svg_without_an_xml_declaration():
    assert probe(b'<svg xmlns="http://www.w3.org/2000/svg"/>').kind == "svg"


def test_detects_woff2():
    assert probe(b"wOF2" + b"\x00" * 32).kind == "woff2"


def test_a_png_extension_does_not_make_a_script_an_image():
    # The caller passes bytes, never a filename. This is the whole point.
    assert probe(b"#!/bin/sh\nrm -rf /\n") is None


def test_returns_none_for_a_truncated_png_header():
    assert probe(b"\x89PNG\r\n\x1a\n") is None


def test_returns_none_for_empty_input():
    assert probe(b"") is None


def test_returns_none_for_a_zip_disguised_as_an_image():
    assert probe(b"PK\x03\x04" + b"\x00" * 40) is None


def test_a_malformed_jpeg_segment_chain_terminates():
    # A zero-length segment would loop forever if the walk were not bounded.
    assert probe(b"\xff\xd8\xff\xe0\x00\x00" + b"\x00" * 32) is None


def test_html_containing_svg_tag_returns_none():
    # SVG tag inside HTML body is not an SVG document.
    assert probe(b"<html><body>hi<svg xmlns='x'></svg></body></html>") is None


def test_text_containing_svg_string_returns_none():
    # SVG tag as a literal string in text/JS is not an SVG document.
    assert probe(b"var x = '<svg'; console.log(x);") is None


def test_svg_with_xml_prolog_is_detected():
    # SVG preceded by XML prolog should be detected (already tests this).
    info = probe(b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')
    assert info.kind == "svg"


def test_svg_with_doctype_is_detected():
    # SVG preceded by DOCTYPE should be detected.
    info = probe(b'<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"></svg>')
    assert info.kind == "svg"


def test_svg_with_xml_comment_is_detected():
    # SVG preceded by XML comment should be detected.
    info = probe(b'<!-- comment --><svg xmlns="http://www.w3.org/2000/svg"></svg>')
    assert info.kind == "svg"


def test_svg_with_utf8_bom_is_detected():
    # SVG preceded by UTF-8 BOM should be detected.
    info = probe(b'\xef\xbb\xbf<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    assert info.kind == "svg"


def test_svg_with_leading_whitespace_is_detected():
    # SVG preceded by leading whitespace and newlines should be detected.
    info = probe(b'  \n\t<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    assert info.kind == "svg"


def test_unterminated_comment_with_large_body_returns_none():
    # An unterminated comment followed by large body must not scan the entire file.
    # The search is bounded to 1024 bytes, so this returns None quickly without
    # scanning the full 50 MB body.
    big = b"<!--" + b"x" * (50 * 1024 * 1024)
    assert probe(big) is None


def test_unterminated_xml_prolog_with_large_body_returns_none():
    # An unterminated XML prolog followed by large body must not scan the entire file.
    # The search is bounded to 1024 bytes.
    big = b"<?xml" + b"x" * (50 * 1024 * 1024)
    assert probe(big) is None


def test_unterminated_doctype_with_large_body_returns_none():
    # An unterminated DOCTYPE followed by large body must not scan the entire file.
    # The search is bounded to 1024 bytes.
    big = b"<!DOCTYPE" + b"x" * (50 * 1024 * 1024)
    assert probe(big) is None


def test_svg_with_preamble_longer_than_1024_bytes_returns_none():
    # An SVG whose valid preamble (XML declaration, comments, etc.) exceeds the
    # 1024-byte window is rejected. This is a deliberate consequence of the bound
    # to prevent unbounded parsing; real SVG files have minimal preambles.
    preamble = b"<?xml version='1.0'?>\n" + b"<!-- comment -->\n" * 100
    svg_content = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    data = preamble + svg_content
    assert len(preamble) > 1024
    assert probe(data) is None
