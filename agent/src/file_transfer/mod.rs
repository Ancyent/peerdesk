use anyhow::Result;
use std::path::PathBuf;
use tokio::sync::mpsc::{Receiver, Sender};

#[derive(Debug)]
pub enum FtMessage {
    /// JSON control message from viewer
    Control(String),
    /// Binary chunk data
    Chunk(Vec<u8>),
}

pub async fn run(mut rx: Receiver<FtMessage>, control_tx: Sender<String>) -> Result<()> {
    let transfer_dir =
        dirs::download_dir().unwrap_or_else(|| PathBuf::from("/tmp/peerdesk-transfers"));
    std::fs::create_dir_all(&transfer_dir)?;

    // (id, name, expected_size, accumulated_bytes)
    let mut active: Option<(String, String, u64, Vec<u8>)> = None;

    while let Some(msg) = rx.recv().await {
        match msg {
            FtMessage::Control(json) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                    match v["type"].as_str().unwrap_or("") {
                        "ft_offer" => {
                            let id = v["id"].as_str().unwrap_or("").to_string();
                            let name = v["name"].as_str().unwrap_or("file").to_string();
                            let size = v["size"].as_u64().unwrap_or(0);

                            if size > 1_073_741_824 {
                                let _ = control_tx.send(
                                    serde_json::json!({"type":"ft_reject","id":id,"reason":"file too large (max 1 GB)"}).to_string()
                                ).await;
                            } else {
                                let cap = (size as usize).min(16 * 1024 * 1024);
                                active = Some((id.clone(), name, size, Vec::with_capacity(cap)));
                                let _ = control_tx
                                    .send(
                                        serde_json::json!({"type":"ft_accept","id":id}).to_string(),
                                    )
                                    .await;
                            }
                        }
                        "ft_cancel" => {
                            active = None;
                        }
                        _ => {}
                    }
                }
            }
            FtMessage::Chunk(data) => {
                if let Some((ref id, ref name, size, ref mut buf)) = active {
                    buf.extend_from_slice(&data);
                    let received = buf.len() as u64;

                    // Send progress every ~1 MB
                    if buf.len() % (1024 * 1024) < data.len() {
                        let _ = control_tx.send(
                            serde_json::json!({"type":"ft_progress","id":id,"received":received}).to_string()
                        ).await;
                    }

                    if received >= size {
                        // Sanitize the viewer-supplied name: strip to a bare
                        // basename and reject anything that escapes transfer_dir.
                        let safe_name = std::path::Path::new(name.as_str())
                            .file_name()
                            .map(std::path::PathBuf::from);
                        let path = safe_name.map(|n| transfer_dir.join(n));
                        match path {
                            Some(path) if path.starts_with(&transfer_dir) => {
                                if let Err(e) = tokio::fs::write(&path, buf).await {
                                    tracing::error!("Failed to write file {:?}: {}", path, e);
                                } else {
                                    tracing::info!(
                                        "File transfer complete: {:?} ({} bytes)",
                                        path,
                                        received
                                    );
                                }
                            }
                            _ => {
                                tracing::warn!("Rejected unsafe transfer filename: {:?}", name);
                            }
                        }
                        let _ = control_tx
                            .send(serde_json::json!({"type":"ft_done","id":id}).to_string())
                            .await;
                        active = None;
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_dir_is_valid_path() {
        let dir = dirs::download_dir().unwrap_or_else(|| PathBuf::from("/tmp/peerdesk-transfers"));
        assert!(!dir.as_os_str().is_empty());
    }
}
