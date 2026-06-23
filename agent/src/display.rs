//! Resolves the on-screen bounds (virtual-desktop origin + size) of a captured
//! display so mouse input targets the right monitor. Uses `xcap::Monitor::all()`
//! — the SAME source and ordering as `capture::run` — so the captured monitor
//! and the input target always share one index space.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DisplayBounds {
    pub ox: i32,
    pub oy: i32,
    pub w: i32,
    pub h: i32,
}

impl Default for DisplayBounds {
    fn default() -> Self {
        Self { ox: 0, oy: 0, w: 1920, h: 1080 }
    }
}

/// A monitor as (x, y, width, height, is_primary).
pub type Monitor = (i32, i32, u32, u32, bool);

/// Bounds of the monitor at `index`. Falls back to the primary monitor, then to
/// the default box. Pure + unit-testable.
pub fn bounds_at_index(index: usize, monitors: &[Monitor]) -> DisplayBounds {
    if let Some(&(x, y, w, h, _)) = monitors.get(index) {
        if w > 0 && h > 0 {
            return DisplayBounds { ox: x, oy: y, w: w as i32, h: h as i32 };
        }
    }
    if let Some(&(x, y, w, h, _)) = monitors.iter().find(|&&(_, _, w, h, p)| p && w > 0 && h > 0) {
        return DisplayBounds { ox: x, oy: y, w: w as i32, h: h as i32 };
    }
    DisplayBounds::default()
}

/// Resolve bounds for the captured display at `index` from the live monitor list.
/// Never panics; returns the default box on failure.
pub fn resolve(index: usize) -> DisplayBounds {
    let monitors = match xcap::Monitor::all() {
        Ok(list) => list,
        Err(e) => {
            tracing::warn!("Monitor::all failed ({}); input maps to default bounds", e);
            return DisplayBounds::default();
        }
    };
    let geom: Vec<Monitor> = monitors
        .iter()
        .map(|m| {
            (
                m.x().unwrap_or(0),
                m.y().unwrap_or(0),
                m.width().unwrap_or(0),
                m.height().unwrap_or(0),
                m.is_primary().unwrap_or(false),
            )
        })
        .collect();
    bounds_at_index(index, &geom)
}

#[cfg(test)]
mod tests {
    use super::*;
    // (x, y, width, height, is_primary)
    fn sample() -> Vec<Monitor> {
        vec![(0, 0, 1920, 1080, true), (1920, 0, 2560, 1440, false)]
    }

    #[test]
    fn picks_monitor_at_index() {
        assert_eq!(bounds_at_index(1, &sample()), DisplayBounds { ox: 1920, oy: 0, w: 2560, h: 1440 });
        assert_eq!(bounds_at_index(0, &sample()), DisplayBounds { ox: 0, oy: 0, w: 1920, h: 1080 });
    }

    #[test]
    fn out_of_range_falls_back_to_primary_then_default() {
        assert_eq!(bounds_at_index(9, &sample()), DisplayBounds { ox: 0, oy: 0, w: 1920, h: 1080 });
        assert_eq!(bounds_at_index(0, &[]), DisplayBounds::default());
    }
}
