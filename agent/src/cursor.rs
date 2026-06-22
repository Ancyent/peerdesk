//! Reads the host's cursor position and publishes it (normalized 0..1) so the
//! viewer can draw a cursor overlay — the captured frame doesn't include the
//! hardware cursor.

use enigo::{Enigo, Mouse, Settings};

/// Normalize an absolute cursor position to 0..1 for a display of size (sw, sh).
/// Returns None if the display size is non-positive.
pub fn normalize(cx: i32, cy: i32, sw: i32, sh: i32) -> Option<(f32, f32)> {
    if sw <= 0 || sh <= 0 {
        return None;
    }
    let x = (cx as f32 / sw as f32).clamp(0.0, 1.0);
    let y = (cy as f32 / sh as f32).clamp(0.0, 1.0);
    Some((x, y))
}

/// Poll the host cursor ~30x/s and publish normalized positions on `tx`
/// (only when changed). Runs on its own thread (enigo is !Send). Returns when
/// the receiver is dropped.
pub fn run(tx: tokio::sync::watch::Sender<(f32, f32)>) {
    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("cursor reader: enigo init failed: {}", e);
            return;
        }
    };
    let mut last = (f32::NAN, f32::NAN);
    loop {
        if tx.is_closed() {
            return;
        }
        if let (Ok((cx, cy)), Ok((sw, sh))) = (enigo.location(), enigo.main_display()) {
            if let Some(p) = normalize(cx, cy, sw, sh) {
                if p != last {
                    last = p;
                    let _ = tx.send(p);
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(33));
    }
}

#[cfg(test)]
mod tests {
    use super::normalize;
    #[test]
    fn normalizes_within_bounds() {
        assert_eq!(normalize(960, 540, 1920, 1080), Some((0.5, 0.5)));
        assert_eq!(normalize(0, 0, 1920, 1080), Some((0.0, 0.0)));
    }
    #[test]
    fn clamps_and_guards_zero() {
        assert_eq!(normalize(5000, 5000, 1920, 1080), Some((1.0, 1.0)));
        assert_eq!(normalize(10, 10, 0, 100), None);
    }
}
