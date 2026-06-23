//! Absolute mouse positioning that works across multiple monitors. enigo's
//! `move_mouse(Abs)` normalizes against the PRIMARY display only (no
//! `VIRTUALDESK`), so on Windows we inject via Win32 `SendInput` over the whole
//! virtual desktop instead.

/// The absolute screen pixel for a normalized (0..1) point on a display whose
/// top-left is (ox, oy) and size is (w, h), in virtual-desktop coordinates.
pub fn target_pixel(ox: i32, oy: i32, w: i32, h: i32, x: f32, y: f32) -> (i32, i32) {
    let px = ox + (x.clamp(0.0, 1.0) * w as f32).round() as i32;
    let py = oy + (y.clamp(0.0, 1.0) * h as f32).round() as i32;
    (px, py)
}

/// Normalize a virtual-desktop pixel to the 0..65535 absolute range that
/// `SendInput(MOUSEEVENTF_ABSOLUTE|VIRTUALDESK)` expects, given the virtual
/// desktop origin (vx,vy) and size (vw,vh). Pure + testable on any platform.
pub fn to_abs_65535(px: i32, py: i32, vx: i32, vy: i32, vw: i32, vh: i32) -> (i32, i32) {
    let w = (vw - 1).max(1) as i64;
    let h = (vh - 1).max(1) as i64;
    let nx = ((px - vx) as i64 * 65535 / w).clamp(0, 65535) as i32;
    let ny = ((py - vy) as i64 * 65535 / h).clamp(0, 65535) as i32;
    (nx, ny)
}

/// Move the cursor to a normalized point on the given display (virtual-desktop
/// coords). Windows: Win32 SendInput over the virtual desktop.
#[cfg(windows)]
pub fn move_abs(ox: i32, oy: i32, w: i32, h: i32, x: f32, y: f32) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_MOUSE, MOUSEINPUT, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_MOVE,
        MOUSEEVENTF_VIRTUALDESK,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    };
    let (px, py) = target_pixel(ox, oy, w, h, x, y);
    let (vx, vy, vw, vh) = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    };
    if vw <= 0 || vh <= 0 {
        return;
    }
    let (nx, ny) = to_abs_65535(px, py, vx, vy, vw, vh);
    let mut input: INPUT = unsafe { std::mem::zeroed() };
    input.r#type = INPUT_MOUSE;
    input.Anonymous.mi = MOUSEINPUT {
        dx: nx,
        dy: ny,
        mouseData: 0,
        dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
        time: 0,
        dwExtraInfo: 0,
    };
    unsafe {
        SendInput(1, &input, std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn target_pixel_offsets_by_origin() {
        assert_eq!(target_pixel(1920, 0, 1920, 1080, 0.5, 0.5), (2880, 540));
        assert_eq!(target_pixel(0, 0, 1920, 1080, 0.0, 0.0), (0, 0));
    }
    #[test]
    fn abs_65535_spans_virtual_desktop() {
        let (nx, _) = to_abs_65535(2880, 540, 0, 0, 3840, 1080);
        assert_eq!(nx, (2880i64 * 65535 / 3839) as i32);
        assert_eq!(to_abs_65535(0, 0, 0, 0, 3840, 1080), (0, 0));
        assert_eq!(to_abs_65535(3839, 1079, 0, 0, 3840, 1080), (65535, 65535));
    }
}
