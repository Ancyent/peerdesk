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

/// What a service agent runs with: whatever the settings file the desktop
/// writes says, resolved by exactly the same rules the desktop uses.
///
/// This is the whole of `main.rs`'s permission logic, moved here so it can be
/// tested against a real file — a service install has no UI, so before this
/// existed the settings screen's decisions simply did not reach the machines
/// installed by `install.sh`.
///
/// Missing, unreadable or malformed all converge on `AppSettings::default()`,
/// which permits everything that worked before enforcement. A service agent
/// must never be locked out of its own capabilities by a bad file.
///
/// The result is `fixed` because a CLI agent cannot change its settings while
/// running; only the desktop pushes updates.
pub fn for_service_agent(
    settings_path: &std::path::Path,
) -> tokio::sync::watch::Receiver<Permissions> {
    fixed(resolve(&AppSettings::load(settings_path).unwrap_or_default()))
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
    fn a_service_agent_resolves_the_same_permissions_the_desktop_would() {
        // The spec's named test for the service install. Every value below is
        // deliberately NOT the default, so a resolution that ignored the file
        // and fell back to defaults would differ on all three booleans.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("peerdesk-settings.json");
        let on_disk = AppSettings {
            access_mode: AccessMode::ViewOnly,
            allow_keyboard_mouse: false,
            allow_file_transfer: false,
            allow_terminal: false,
            ..AppSettings::default()
        };
        on_disk.save(&path).unwrap();

        let from_file = *for_service_agent(&path).borrow();
        assert_eq!(
            from_file,
            resolve(&on_disk),
            "the service agent and the desktop must read one file the same way"
        );
        // Spelled out, so the assertion above cannot pass by both sides being
        // wrong in the same direction.
        assert!(!from_file.input);
        assert!(!from_file.file_transfer);
        assert!(!from_file.terminal);
    }

    #[test]
    fn a_service_agent_with_no_settings_file_permits_what_worked_before() {
        // install.sh writes no settings file — the desktop does. A machine
        // that never ran the desktop must keep every capability it had.
        let dir = tempfile::tempdir().unwrap();
        let p = *for_service_agent(&dir.path().join("does-not-exist.json")).borrow();
        assert_eq!(p, Permissions::default());
        assert!(p.input && p.file_transfer && p.terminal);
    }

    #[test]
    fn a_service_agent_reading_a_pre_enforcement_file_keeps_its_capabilities() {
        // The upgrade path, end to end for a service install: a v0 file's
        // accidental `false` reaches `resolve` already rescued by the
        // migration, so the shell keeps being served.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("peerdesk-settings.json");
        std::fs::write(
            &path,
            r#"{"allow_file_transfer": false, "allow_terminal": false, "language": "ro"}"#,
        )
        .unwrap();
        let p = *for_service_agent(&path).borrow();
        assert!(p.file_transfer);
        assert!(p.terminal);
    }

    #[test]
    fn fixed_keeps_serving_its_value_after_the_sender_is_gone() {
        let p = Permissions { input: false, file_transfer: true, terminal: false };
        let rx = fixed(p);
        assert_eq!(*rx.borrow(), p);
    }
}
