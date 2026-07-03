//! Reads the host's cursor position and publishes it (normalized 0..1 within the
//! CAPTURED monitor's bounds) so the viewer can draw a cursor overlay — the
//! captured frame doesn't include the hardware cursor. Normalizing against the
//! captured monitor (not the primary) keeps the overlay correct on multi-monitor
//! hosts and when viewing a secondary display.

use crate::display::DisplayBounds;
#[cfg(feature = "gui-capture")]
use enigo::{Enigo, Mouse, Settings};

/// Normalize an absolute (virtual-desktop) cursor position to 0..1 within the
/// captured display's bounds `b`. Returns None if the display size is non-positive.
pub fn normalize_in_bounds(cx: i32, cy: i32, b: DisplayBounds) -> Option<(f32, f32)> {
    if b.w <= 0 || b.h <= 0 {
        return None;
    }
    let x = ((cx - b.ox) as f32 / b.w as f32).clamp(0.0, 1.0);
    let y = ((cy - b.oy) as f32 / b.h as f32).clamp(0.0, 1.0);
    Some((x, y))
}

/// Poll the host cursor ~30x/s and publish normalized positions on `tx`
/// (only when changed), using the current captured-display `bounds_rx` so the
/// overlay maps to whichever monitor is being viewed. Runs on its own thread
/// (enigo is !Send). Returns when the receiver is dropped.
#[cfg(feature = "gui-capture")]
pub fn run(
    tx: tokio::sync::watch::Sender<(f32, f32)>,
    bounds_rx: tokio::sync::watch::Receiver<DisplayBounds>,
) {
    let enigo = match Enigo::new(&Settings::default()) {
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
        if let Ok((cx, cy)) = enigo.location() {
            let b = *bounds_rx.borrow();
            if let Some(p) = normalize_in_bounds(cx, cy, b) {
                if p != last {
                    last = p;
                    let _ = tx.send(p);
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(33));
    }
}

/// Headless build: no host cursor to read (no display). The symbol exists only so
/// the GUI-mode call site in `lib.rs` compiles; it is never spawned.
#[cfg(not(feature = "gui-capture"))]
pub fn run(
    _tx: tokio::sync::watch::Sender<(f32, f32)>,
    _bounds_rx: tokio::sync::watch::Receiver<DisplayBounds>,
) {
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_within_primary_origin_bounds() {
        let b = DisplayBounds { ox: 0, oy: 0, w: 1920, h: 1080 };
        assert_eq!(normalize_in_bounds(960, 540, b), Some((0.5, 0.5)));
        assert_eq!(normalize_in_bounds(0, 0, b), Some((0.0, 0.0)));
    }

    #[test]
    fn normalizes_relative_to_offset_monitor() {
        // A second monitor at x-origin 1920, size 2560x1440. A cursor at virtual
        // (1920+1280, 720) is the centre of that monitor -> (0.5, 0.5).
        let b = DisplayBounds { ox: 1920, oy: 0, w: 2560, h: 1440 };
        assert_eq!(normalize_in_bounds(1920 + 1280, 720, b), Some((0.5, 0.5)));
        // Cursor on the primary (x < 1920) clamps to the left edge of monitor 2.
        assert_eq!(normalize_in_bounds(100, 720, b), Some((0.0, 0.5)));
    }

    #[test]
    fn clamps_and_guards_zero() {
        let b = DisplayBounds { ox: 0, oy: 0, w: 1920, h: 1080 };
        assert_eq!(normalize_in_bounds(5000, 5000, b), Some((1.0, 1.0)));
        assert_eq!(normalize_in_bounds(10, 10, DisplayBounds { ox: 0, oy: 0, w: 0, h: 100 }), None);
    }
}
