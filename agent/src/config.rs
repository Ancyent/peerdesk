use anyhow::Result;
use hmac::{Hmac, Mac};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::path::{Path, PathBuf};

pub fn derive_hmac_key(password: &str) -> String {
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(b"peerdesk-v1")
        .expect("HMAC accepts any key size");
    mac.update(password.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Deployment config file — loaded via --config=path, overridden by CLI flags.
#[derive(Debug, serde::Deserialize, Default)]
pub struct DeployConfig {
    pub server: Option<String>,
    pub api_key: Option<String>,
    pub password: Option<String>,
}

impl DeployConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&raw)?)
    }
}

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
    pub api_key: Option<String>,
    /// HMAC key derived from the password; sent to signaling server at registration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hmac_key: Option<String>,
}

impl Config {
    /// Canonical server root: trailing slash and a trailing "/api" removed,
    /// so the user may enter either "https://host" or "https://host/api".
    fn server_base(&self) -> Option<String> {
        self.server_url.as_deref().map(|u| {
            let b = u.trim_end_matches('/');
            b.strip_suffix("/api")
                .unwrap_or(b)
                .trim_end_matches('/')
                .to_string()
        })
    }

    /// WebSocket URL for the signaling server, derived from server_url.
    /// The bundled deployment fronts signaling at `<server>/ws` (nginx).
    pub fn signaling_url(&self) -> String {
        match self.server_base() {
            Some(base) => {
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

    /// REST API base URL. The bundled deployment fronts the API at `<server>/api`
    /// (the same nginx that serves `/ws`), so derive `<server>/api`. Without the
    /// prefix the agent's POST /machines/register hits the web SPA and 405s.
    pub fn api_url(&self) -> Option<String> {
        self.server_base().map(|base| format!("{}/api", base))
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
    /// `server_url` and `api_key` override saved values when provided.
    pub fn load_or_create(
        path: &Path,
        password: &str,
        server_url: Option<&str>,
        api_key: Option<&str>,
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
                    api_key: None,
                    hmac_key: Some(derive_hmac_key(password)),
                }
            }
        };

        if let Some(url) = server_url {
            cfg.server_url = Some(url.to_string());
        }
        if let Some(tok) = api_key {
            cfg.api_key = Some(tok.to_string());
        }
        // Populate hmac_key if missing (upgrade path for existing configs).
        // Skip when password is empty (e.g. the Tauri desktop passes ""), so we
        // never overwrite an existing key with one derived from "".
        if cfg.hmac_key.is_none() && !password.is_empty() {
            cfg.hmac_key = Some(derive_hmac_key(password));
        }

        cfg.save(path)?;
        Ok(cfg)
    }
}

/// Generate a short, simple access password: 8 characters, lowercase letters
/// and digits only — no special characters and no ambiguous look-alikes
/// (0/o, 1/l/i removed) so it is easy to read out and type.
pub fn generate_simple_password() -> String {
    const CHARS: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..8)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
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
    #[serde(default = "default_true")]
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
            show_remote_cursor: true,
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
            api_key: Some("tok123".into()),
            hmac_key: None,
        };
        cfg.save(&path).unwrap();
        let loaded = Config::load(&path).unwrap();
        assert_eq!(loaded.peer_id, "123456789");
        assert_eq!(
            loaded.server_url.as_deref(),
            Some("https://api.example.com")
        );
        assert_eq!(loaded.api_key.as_deref(), Some("tok123"));
    }

    #[test]
    fn signaling_url_derives_from_https() {
        let cfg = Config {
            peer_id: "x".into(),
            password_hash: "x".into(),
            server_url: Some("https://api.example.com".into()),
            api_key: None,
            hmac_key: None,
        };
        assert_eq!(cfg.signaling_url(), "wss://api.example.com/ws");
    }

    #[test]
    fn signaling_url_derives_from_http() {
        let cfg = Config {
            peer_id: "x".into(),
            password_hash: "x".into(),
            server_url: Some("http://localhost:8001".into()),
            api_key: None,
            hmac_key: None,
        };
        assert_eq!(cfg.signaling_url(), "ws://localhost:8001/ws");
    }

    #[test]
    fn signaling_url_fallback_when_no_server() {
        let cfg = Config {
            peer_id: "x".into(),
            password_hash: "x".into(),
            server_url: None,
            api_key: None,
            hmac_key: None,
        };
        assert_eq!(cfg.signaling_url(), "ws://localhost:8001/ws");
    }

    #[test]
    fn api_url_appends_api_prefix() {
        let cfg = Config {
            peer_id: "x".into(),
            password_hash: "x".into(),
            server_url: Some("https://api.example.com/".into()),
            api_key: None,
            hmac_key: None,
        };
        // nginx fronts the REST API under /api (same host that serves /ws)
        assert_eq!(cfg.api_url(), Some("https://api.example.com/api".to_string()));
        assert_eq!(cfg.signaling_url(), "wss://api.example.com/ws");
    }

    #[test]
    fn urls_normalize_when_server_already_has_api_suffix() {
        let cfg = Config {
            peer_id: "x".into(),
            password_hash: "x".into(),
            server_url: Some("https://host.example.com/api".into()),
            api_key: None,
            hmac_key: None,
        };
        // entering ".../api" must not double the prefix or break signaling
        assert_eq!(cfg.api_url(), Some("https://host.example.com/api".to_string()));
        assert_eq!(cfg.signaling_url(), "wss://host.example.com/ws");
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

    #[test]
    fn hmac_key_derivation_is_deterministic() {
        let k1 = derive_hmac_key("MyPassword");
        let k2 = derive_hmac_key("MyPassword");
        assert_eq!(k1, k2);
        assert_eq!(k1.len(), 64); // 32 bytes hex
    }

    #[test]
    fn different_passwords_give_different_keys() {
        assert_ne!(derive_hmac_key("password1"), derive_hmac_key("password2"));
    }

    #[test]
    fn hmac_key_never_equals_password() {
        let pw = "MyPassword";
        assert_ne!(derive_hmac_key(pw), pw);
    }

    #[test]
    fn deploy_config_loads_from_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("deploy.json");
        std::fs::write(&path, r#"{"server":"https://api.example.com","api_key":"pd_abc123"}"#).unwrap();
        let dc = DeployConfig::load(&path).unwrap();
        assert_eq!(dc.server.as_deref(), Some("https://api.example.com"));
        assert_eq!(dc.api_key.as_deref(), Some("pd_abc123"));
        assert!(dc.password.is_none());
    }
}
