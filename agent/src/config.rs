use anyhow::Result;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub peer_id: String,
    pub password_hash: String,
    /// Base URL of the PeerDesk server, e.g. "https://api.example.com".
    /// Signaling WebSocket and REST API URLs are derived from this.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_url: Option<String>,
    /// Registration token for associating this machine with an account.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_token: Option<String>,
}

impl Config {
    /// WebSocket URL for the signaling server, derived from server_url.
    pub fn signaling_url(&self) -> String {
        match &self.server_url {
            Some(url) => {
                let base = url.trim_end_matches('/');
                let ws_base = base
                    .replace("https://", "wss://")
                    .replace("http://", "ws://");
                format!("{}/ws", ws_base)
            }
            None => {
                std::env::var("SIGNALING_URL").unwrap_or_else(|_| "ws://localhost:8001/ws".into())
            }
        }
    }

    /// REST API base URL, derived from server_url.
    pub fn api_url(&self) -> Option<String> {
        self.server_url
            .as_deref()
            .map(|u| u.trim_end_matches('/').to_string())
    }

    pub fn load(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)?;
        #[cfg(unix)]
        {
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(path)?
                .write_all(content.as_bytes())?;
        }
        #[cfg(not(unix))]
        std::fs::write(path, content)?;
        Ok(())
    }

    /// Returns the config file path.
    /// portable=true  → same directory as the executable (USB/portable mode).
    /// portable=false → user config dir ($XDG_CONFIG_HOME/peerdesk/ on Linux,
    ///                  %APPDATA%\peerdesk\ on Windows).
    pub fn config_path(portable: bool) -> PathBuf {
        if portable {
            std::env::current_exe()
                .unwrap_or_else(|_| PathBuf::from("."))
                .parent()
                .unwrap_or(Path::new("."))
                .join("peerdesk.json")
        } else {
            dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("peerdesk")
                .join("config.json")
        }
    }

    /// Load existing config or create a new one.
    /// `server_url` and `api_token` override saved values when provided.
    pub fn load_or_create(
        path: &Path,
        password: &str,
        server_url: Option<&str>,
        api_token: Option<&str>,
    ) -> Result<Self> {
        let mut cfg = match Self::load(path) {
            Ok(existing) => existing,
            Err(e) => {
                let is_not_found = e
                    .chain()
                    .find_map(|cause| cause.downcast_ref::<std::io::Error>())
                    .is_some_and(|io| io.kind() == std::io::ErrorKind::NotFound);
                if !is_not_found {
                    return Err(e);
                }
                Config {
                    peer_id: generate_peer_id(),
                    password_hash: bcrypt::hash(password, bcrypt::DEFAULT_COST)?,
                    server_url: None,
                    api_token: None,
                }
            }
        };

        if let Some(url) = server_url {
            cfg.server_url = Some(url.to_string());
        }
        if let Some(tok) = api_token {
            cfg.api_token = Some(tok.to_string());
        }

        cfg.save(path)?;
        Ok(cfg)
    }
}

pub fn generate_peer_id() -> String {
    let mut rng = rand::thread_rng();
    (0..9).map(|_| rng.gen_range(0..10).to_string()).collect()
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AccessMode {
    #[default]
    Full,
    ViewOnly,
    NoIncoming,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    #[serde(default)]
    pub access_mode: AccessMode,
    #[serde(default = "default_true")]
    pub show_approval_dialog: bool,
    #[serde(default)]
    pub auto_disconnect_minutes: Option<u32>,
    #[serde(default)]
    pub lock_screen_after_session: bool,
    #[serde(default = "default_true")]
    pub allow_keyboard_mouse: bool,
    #[serde(default = "default_true")]
    pub allow_clipboard: bool,
    #[serde(default)]
    pub allow_file_transfer: bool,
    #[serde(default)]
    pub allow_audio: bool,
    #[serde(default)]
    pub allow_terminal: bool,
    #[serde(default)]
    pub allow_remote_restart: bool,
    #[serde(default)]
    pub block_user_input: bool,
    #[serde(default = "default_quality")]
    pub image_quality: String,
    #[serde(default = "default_codec")]
    pub codec: String,
    #[serde(default = "default_view")]
    pub view_mode: String,
    #[serde(default)]
    pub show_remote_cursor: bool,
    #[serde(default = "default_true")]
    pub hardware_acceleration: bool,
    #[serde(default)]
    pub start_on_boot: bool,
    #[serde(default = "default_true")]
    pub minimize_to_tray: bool,
}

fn default_true() -> bool {
    true
}
fn default_quality() -> String {
    "balanced".into()
}
fn default_codec() -> String {
    "auto".into()
}
fn default_view() -> String {
    "fit".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            access_mode: AccessMode::Full,
            show_approval_dialog: true,
            auto_disconnect_minutes: None,
            lock_screen_after_session: false,
            allow_keyboard_mouse: true,
            allow_clipboard: true,
            allow_file_transfer: false,
            allow_audio: false,
            allow_terminal: false,
            allow_remote_restart: false,
            block_user_input: false,
            image_quality: default_quality(),
            codec: default_codec(),
            view_mode: default_view(),
            show_remote_cursor: false,
            hardware_acceleration: true,
            start_on_boot: false,
            minimize_to_tray: true,
        }
    }
}

impl AppSettings {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    /// Path to settings file — same directory as config.json.
    pub fn settings_path(portable: bool) -> PathBuf {
        Config::config_path(portable)
            .parent()
            .unwrap_or(Path::new("."))
            .join("peerdesk-settings.json")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_9_digit_peer_id() {
        let id = generate_peer_id();
        assert_eq!(id.len(), 9);
        assert!(id.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn config_roundtrips_from_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let cfg = Config {
            peer_id: "123456789".into(),
            password_hash: "$2b$12$abc".into(),
            server_url: Some("https://api.example.com".into()),
            api_token: Some("tok123".into()),
        };
        cfg.save(&path).unwrap();
        let loaded = Config::load(&path).unwrap();
        assert_eq!(loaded.peer_id, "123456789");
        assert_eq!(
            loaded.server_url.as_deref(),
            Some("https://api.example.com")
        );
        assert_eq!(loaded.api_token.as_deref(), Some("tok123"));
    }

    #[test]
    fn signaling_url_derives_from_https() {
        let cfg = Config {
            peer_id: "x".into(),
            password_hash: "x".into(),
            server_url: Some("https://api.example.com".into()),
            api_token: None,
        };
        assert_eq!(cfg.signaling_url(), "wss://api.example.com/ws");
    }

    #[test]
    fn signaling_url_derives_from_http() {
        let cfg = Config {
            peer_id: "x".into(),
            password_hash: "x".into(),
            server_url: Some("http://localhost:8001".into()),
            api_token: None,
        };
        assert_eq!(cfg.signaling_url(), "ws://localhost:8001/ws");
    }

    #[test]
    fn signaling_url_fallback_when_no_server() {
        let cfg = Config {
            peer_id: "x".into(),
            password_hash: "x".into(),
            server_url: None,
            api_token: None,
        };
        assert_eq!(cfg.signaling_url(), "ws://localhost:8001/ws");
    }

    #[test]
    fn api_url_strips_trailing_slash() {
        let cfg = Config {
            peer_id: "x".into(),
            password_hash: "x".into(),
            server_url: Some("https://api.example.com/".into()),
            api_token: None,
        };
        assert_eq!(cfg.api_url(), Some("https://api.example.com".to_string()));
    }

    #[test]
    fn app_settings_defaults_are_sane() {
        let s = AppSettings::default();
        assert_eq!(s.access_mode, AccessMode::Full);
        assert!(s.show_approval_dialog);
        assert!(s.allow_keyboard_mouse);
        assert!(s.allow_clipboard);
        assert!(!s.allow_file_transfer);
        assert!(s.minimize_to_tray);
    }

    #[test]
    fn app_settings_roundtrips_to_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("peerdesk-settings.json");
        let s = AppSettings {
            allow_file_transfer: true,
            ..AppSettings::default()
        };
        s.save(&path).unwrap();
        let loaded = AppSettings::load(&path).unwrap();
        assert!(loaded.allow_file_transfer);
    }

    #[test]
    fn access_mode_serializes_as_snake_case() {
        let s = AppSettings {
            access_mode: AccessMode::ViewOnly,
            ..AppSettings::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("view_only"));
    }
}
