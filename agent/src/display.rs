//! Resolves the on-screen bounds (virtual-desktop origin + size) of a captured
//! display, so mouse input can target the right monitor. scrap gives size but
//! not origin; `display-info` supplies both, matched by resolution + primary.

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

/// A monitor as reported by `display-info`: (x, y, width, height, is_primary).
pub type Monitor = (i32, i32, u32, u32, bool);

/// Find the monitor matching the captured display's (width, height, is_primary)
/// and return its bounds. Falls back to the primary monitor, then to a 0-origin
/// box of the target size. Pure + unit-testable.
pub fn match_bounds(target_w: u32, target_h: u32, target_primary: bool, monitors: &[Monitor]) -> DisplayBounds {
    if let Some(&(x, y, w, h, _)) = monitors
        .iter()
        .find(|&&(_, _, w, h, p)| w == target_w && h == target_h && p == target_primary)
    {
        return DisplayBounds { ox: x, oy: y, w: w as i32, h: h as i32 };
    }
    if let Some(&(x, y, w, h, _)) = monitors.iter().find(|&&(_, _, _, _, p)| p) {
        return DisplayBounds { ox: x, oy: y, w: w as i32, h: h as i32 };
    }
    DisplayBounds { ox: 0, oy: 0, w: target_w as i32, h: target_h as i32 }
}

/// Resolve bounds for the captured display at `index` (scrap order). Reads the
/// live monitor list from `display-info` and the scrap display size for the
/// index, then matches. Never panics; returns a sane default on failure.
pub fn resolve(index: usize) -> DisplayBounds {
    let scrap = crate::capture::list_displays();
    let target = scrap.iter().find(|d| d.index == index).or_else(|| scrap.first());
    let (tw, th, tp) = match target {
        Some(d) => (d.width, d.height, d.is_primary),
        None => return DisplayBounds::default(),
    };
    let monitors: Vec<Monitor> = match display_info::DisplayInfo::all() {
        Ok(list) => list
            .into_iter()
            .map(|m| (m.x, m.y, m.width, m.height, m.is_primary))
            .collect(),
        Err(e) => {
            tracing::warn!("display-info failed ({}); input maps to primary-origin", e);
            Vec::new()
        }
    };
    match_bounds(tw, th, tp, &monitors)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_by_resolution_and_primary() {
        let mons = vec![(0, 0, 1920, 1080, true), (1920, 0, 2560, 1440, false)];
        assert_eq!(match_bounds(2560, 1440, false, &mons), DisplayBounds { ox: 1920, oy: 0, w: 2560, h: 1440 });
        assert_eq!(match_bounds(1920, 1080, true, &mons), DisplayBounds { ox: 0, oy: 0, w: 1920, h: 1080 });
    }
    #[test]
    fn falls_back_to_primary_then_origin() {
        let mons = vec![(0, 0, 1920, 1080, true)];
        assert_eq!(match_bounds(3440, 1440, false, &mons), DisplayBounds { ox: 0, oy: 0, w: 1920, h: 1080 });
        assert_eq!(match_bounds(1280, 720, false, &[]), DisplayBounds { ox: 0, oy: 0, w: 1280, h: 720 });
    }
}
