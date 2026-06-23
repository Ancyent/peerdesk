//! Fast box-average 8888 (4-byte/pixel) downscaler for the capture path. Only ever shrinks;
//! output dimensions are forced even (the H.264 encoder requires it).

/// Even-rounded target dims preserving aspect ratio, capping height to
/// `max_height`. `max_height == 0` (or already-small frames) → unchanged
/// (even-rounded).
pub fn target_dims(w: u32, h: u32, max_height: u32) -> (u32, u32) {
    if max_height == 0 || h <= max_height {
        return (w & !1, h & !1);
    }
    let nh = max_height;
    let nw = ((w as u64 * nh as u64) / h as u64) as u32;
    (nw & !1, nh & !1)
}

/// Box-average downscale of a 4-byte-per-pixel buffer from (sw,sh) to (dw,dh).
/// Channel-order agnostic (each of the 4 bytes is averaged independently).
/// Caller guarantees dw<=sw, dh<=sh, and src.len() == sw*sh*4.
pub fn downscale_8888(src: &[u8], sw: u32, sh: u32, dw: u32, dh: u32) -> Vec<u8> {
    let (sw, sh, dw, dh) = (sw as usize, sh as usize, dw as usize, dh as usize);
    let mut dst = vec![0u8; dw * dh * 4];
    for dy in 0..dh {
        let sy0 = dy * sh / dh;
        let sy1 = (((dy + 1) * sh / dh).max(sy0 + 1)).min(sh);
        for dx in 0..dw {
            let sx0 = dx * sw / dw;
            let sx1 = (((dx + 1) * sw / dw).max(sx0 + 1)).min(sw);
            let (mut b, mut g, mut r, mut a, mut n) = (0u32, 0u32, 0u32, 0u32, 0u32);
            for sy in sy0..sy1 {
                let row = sy * sw;
                for sx in sx0..sx1 {
                    let si = (row + sx) * 4;
                    b += src[si] as u32;
                    g += src[si + 1] as u32;
                    r += src[si + 2] as u32;
                    a += src[si + 3] as u32;
                    n += 1;
                }
            }
            let di = (dy * dw + dx) * 4;
            dst[di] = (b / n) as u8;
            dst[di + 1] = (g / n) as u8;
            dst[di + 2] = (r / n) as u8;
            dst[di + 3] = (a / n) as u8;
        }
    }
    dst
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_dims_caps_height_and_keeps_aspect_even() {
        assert_eq!(target_dims(1920, 1080, 720), (1280, 720));
        assert_eq!(target_dims(1366, 768, 720), (1280, 720)); // 1366*720/768=1280.6 -> 1280
    }

    #[test]
    fn target_dims_no_cap_or_already_small() {
        assert_eq!(target_dims(1920, 1080, 0), (1920, 1080));
        assert_eq!(target_dims(1280, 720, 1080), (1280, 720));
        assert_eq!(target_dims(641, 481, 0), (640, 480)); // forced even
    }

    #[test]
    fn downscale_halves_and_averages() {
        // 2x2 source downscaled to 1x1 = average of the four pixels.
        let src = vec![
            0, 0, 0, 255, 100, 100, 100, 255, // row 0
            200, 200, 200, 255, 40, 40, 40, 255, // row 1
        ];
        let out = downscale_8888(&src, 2, 2, 1, 1);
        assert_eq!(out.len(), 4);
        assert_eq!(out[0], ((0 + 100 + 200 + 40) / 4) as u8); // 85
        assert_eq!(out[3], 255);
    }
}
