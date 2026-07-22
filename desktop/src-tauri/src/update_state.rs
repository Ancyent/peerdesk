//! Desktop-only update bookkeeping (skip/snooze), kept out of the shared
//! AppSettings so it can grow (last_check_at, …) without touching that struct.
use std::path::{Path, PathBuf};

#[cfg(not(target_os = "android"))]
use peerdesk_agent::config::AppSettings;

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct UpdateState {
    /// Exact version the user chose to skip; "" = none skipped.
    #[serde(default)]
    pub skip_version: String,
    /// Epoch-millis until which prompts are snoozed; None = not snoozed.
    #[serde(default)]
    pub snooze_until: Option<i64>,
}

impl UpdateState {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> anyhow::Result<()> {
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }
}

#[cfg(not(target_os = "android"))]
pub fn state_path() -> PathBuf {
    AppSettings::settings_path(false)
        .parent()
        .unwrap_or(Path::new("."))
        .join("peerdesk-update-state.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_default_and_round_trips() {
        let dir = std::env::temp_dir().join("pd_update_state_test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("s.json");
        let _ = std::fs::remove_file(&path);
        assert_eq!(UpdateState::load(&path).skip_version, "");
        assert_eq!(UpdateState::load(&path).snooze_until, None);
        let s = UpdateState { skip_version: "0.5.0".into(), snooze_until: Some(1234) };
        s.save(&path).unwrap();
        let back = UpdateState::load(&path);
        assert_eq!(back.skip_version, "0.5.0");
        assert_eq!(back.snooze_until, Some(1234));
    }
}
