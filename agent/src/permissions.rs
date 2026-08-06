//! What a connected viewer is allowed to do.
//!
//! Resolution is a pure function so the rules can be tested without a
//! filesystem, a network, or a running agent.

use crate::config::{AccessMode, AppSettings};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Permissions {
    /// Keyboard and mouse injection.
    pub input: bool,
    pub file_transfer: bool,
    /// A shell over the `terminal` data channel. Only ever reachable in
    /// `SessionMode::Terminal` — a GUI session starts no PTY at all
    /// (`lib.rs` hands it `idle_terminal()`), so in practice this governs
    /// headless agents.
    pub terminal: bool,
}

impl Default for Permissions {
    fn default() -> Self {
        resolve(&AppSettings::default())
    }
}

/// The rules, in one place.
///
/// Input takes the most restrictive of the two settings that both claim to
/// govern it: `access_mode: ViewOnly` and `allow_keyboard_mouse: false` mean
/// the same thing and can disagree, so a setting that restricts is never
/// loosened by another setting.
pub fn resolve(settings: &AppSettings) -> Permissions {
    Permissions {
        input: settings.access_mode == AccessMode::Full && settings.allow_keyboard_mouse,
        file_transfer: settings.allow_file_transfer,
        terminal: settings.allow_terminal,
    }
}

/// A receiver that will only ever yield `p`.
///
/// A `watch` receiver keeps serving the last value after its sender is
/// dropped, so dropping the sender here is not a loss of behaviour — it is how
/// a caller with nothing to update says "these permissions, forever". Used by
/// the CLI agent, which cannot change its settings while running, and by
/// `AgentConfig::default()`, which has no sender to borrow.
pub fn fixed(p: Permissions) -> tokio::sync::watch::Receiver<Permissions> {
    let (tx, rx) = tokio::sync::watch::channel(p);
    drop(tx);
    rx
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AccessMode, AppSettings};

    #[test]
    fn input_needs_full_access_and_the_toggle() {
        let s = AppSettings {
            access_mode: AccessMode::Full,
            allow_keyboard_mouse: true,
            ..AppSettings::default()
        };
        assert!(resolve(&s).input);
    }

    #[test]
    fn the_toggle_alone_does_not_grant_input() {
        // Most restrictive wins: ViewOnly means no injection even if the
        // permissions screen says keyboard and mouse are allowed.
        let s = AppSettings {
            access_mode: AccessMode::ViewOnly,
            allow_keyboard_mouse: true,
            ..AppSettings::default()
        };
        assert!(!resolve(&s).input);
    }

    #[test]
    fn full_access_alone_does_not_grant_input() {
        let s = AppSettings {
            access_mode: AccessMode::Full,
            allow_keyboard_mouse: false,
            ..AppSettings::default()
        };
        assert!(!resolve(&s).input);
    }

    #[test]
    fn file_transfer_and_terminal_follow_their_toggles() {
        let on = AppSettings {
            allow_file_transfer: true,
            allow_terminal: true,
            ..AppSettings::default()
        };
        assert!(resolve(&on).file_transfer);
        assert!(resolve(&on).terminal);

        let off = AppSettings {
            allow_file_transfer: false,
            allow_terminal: false,
            ..AppSettings::default()
        };
        assert!(!resolve(&off).file_transfer);
        assert!(!resolve(&off).terminal);
    }

    #[test]
    fn defaults_permit_everything_that_worked_before_this_feature() {
        // THE OUTAGE GUARD. File transfer and the terminal work
        // unconditionally today. If either default returns to `false`, the
        // first upgraded agent silently loses a working capability — and for
        // the terminal that is the whole session on a headless host, which has
        // no screen to fall back to.
        let p = resolve(&AppSettings::default());
        assert!(p.input, "keyboard/mouse worked by default before this feature");
        assert!(p.file_transfer, "file transfer worked unconditionally before this feature");
        assert!(p.terminal, "the terminal IS the session on a headless agent");
    }

    #[test]
    fn fixed_keeps_serving_its_value_after_the_sender_is_gone() {
        let p = Permissions { input: false, file_transfer: true, terminal: false };
        let rx = fixed(p);
        assert_eq!(*rx.borrow(), p);
    }
}
