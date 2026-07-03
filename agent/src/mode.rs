//! Chooses GUI (screen capture) vs Terminal (shell) mode for this host.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionMode {
    Gui,
    Terminal,
}

/// Pure decision: given whether a display env var is set and how many monitors
/// were enumerated, decide the mode. Extracted so it is testable without a real
/// display. On non-Linux this is never called (callers force `Gui`).
pub fn decide(display_present: bool, monitor_count: usize) -> SessionMode {
    if display_present && monitor_count > 0 {
        SessionMode::Gui
    } else {
        SessionMode::Terminal
    }
}

/// Live detection. Without the `gui-capture` feature (headless build) always
/// `Terminal` — there is no capture stack to drive. Otherwise: on Windows/macOS
/// always `Gui`; on Linux `Gui` only when a display env var is set AND xcap
/// enumerates at least one monitor.
pub fn detect() -> SessionMode {
    #[cfg(not(feature = "gui-capture"))]
    {
        tracing::info!("session mode: Terminal (headless build — no capture feature)");
        SessionMode::Terminal
    }
    #[cfg(feature = "gui-capture")]
    {
        #[cfg(not(target_os = "linux"))]
        {
            SessionMode::Gui
        }
        #[cfg(target_os = "linux")]
        {
            let display_present = std::env::var_os("DISPLAY").is_some()
                || std::env::var_os("WAYLAND_DISPLAY").is_some();
            let monitor_count = if display_present {
                xcap::Monitor::all().map(|m| m.len()).unwrap_or(0)
            } else {
                0
            };
            let mode = decide(display_present, monitor_count);
            tracing::info!("session mode: {:?} (display_present={}, monitors={})", mode, display_present, monitor_count);
            mode
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gui_only_with_display_and_monitor() {
        assert_eq!(decide(true, 2), SessionMode::Gui);
        assert_eq!(decide(true, 1), SessionMode::Gui);
        assert_eq!(decide(true, 0), SessionMode::Terminal);
        assert_eq!(decide(false, 2), SessionMode::Terminal);
        assert_eq!(decide(false, 0), SessionMode::Terminal);
    }
}
