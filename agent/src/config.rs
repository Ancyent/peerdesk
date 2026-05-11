use anyhow::Result;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub peer_id: String,
    pub password_hash: String,
    pub signaling_url: String,
}

pub fn generate_peer_id() -> String {
    let mut rng = rand::thread_rng();
    (0..9).map(|_| rng.gen_range(0..10).to_string()).collect()
}

impl Config {
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
                .write(true).create(true).truncate(true).mode(0o600)
                .open(path)?
                .write_all(content.as_bytes())?;
        }
        #[cfg(not(unix))]
        std::fs::write(path, content)?;
        Ok(())
    }

    pub fn load_or_create(password: &str) -> Result<Self> {
        let path = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("peerdesk")
            .join("config.json");

        match Self::load(&path) {
            Ok(cfg) => return Ok(cfg),
            Err(ref e) => {
                let is_not_found = e.downcast_ref::<std::io::Error>()
                    .map_or(false, |io| io.kind() == std::io::ErrorKind::NotFound);
                if !is_not_found {
                    return Err(anyhow::anyhow!("{}", e));
                }
                // File not found — fall through to create
            }
        }
        let hash = bcrypt::hash(password, bcrypt::DEFAULT_COST)?;
        let cfg = Config {
            peer_id: generate_peer_id(),
            password_hash: hash,
            signaling_url: std::env::var("SIGNALING_URL")
                .unwrap_or_else(|_| "ws://localhost:8001/ws".into()),
        };
        cfg.save(&path)?;
        Ok(cfg)
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
            signaling_url: "ws://localhost:8001/ws".into(),
        };
        cfg.save(&path).unwrap();
        let loaded = Config::load(&path).unwrap();
        assert_eq!(loaded.peer_id, "123456789");
    }
}
