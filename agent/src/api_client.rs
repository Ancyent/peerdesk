use anyhow::Result;
use serde::{Deserialize, Serialize};

pub const REGISTER_PATH: &str = "/machines/register";
pub const STATUS_PATH: &str = "/machines/status";

#[derive(Debug, Serialize)]
struct MachineRegisterRequest {
    peer_id: String,
    name: String,
    os: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MachineOut {
    pub id: String,
    pub peer_id: String,
    pub name: String,
    pub approval_status: String,  // "pending" | "approved" | "denied"
}

#[derive(Debug, Deserialize)]
struct ApprovalStatusResponse {
    approval_status: String,
}

/// Register machine via API key. Returns machine record with initial approval_status.
pub async fn register_machine(api_url: &str, api_key: &str, peer_id: &str) -> Result<MachineOut> {
    let client = reqwest::Client::new();
    let os = std::env::consts::OS.to_string();
    let body = MachineRegisterRequest {
        peer_id: peer_id.to_string(),
        name: format!("{} ({})", get_hostname(), os),
        os: Some(os),
    };

    let res = client
        .post(format!("{}{}", api_url, REGISTER_PATH))
        .header("X-API-Key", api_key)
        .json(&body)
        .send()
        .await?;

    if res.status().as_u16() == 409 {
        tracing::info!("peer_id={} already registered, checking current status", peer_id);
        // If the re-check fails, default to "pending" (conservative) so a
        // denied machine can never bypass denial via a transient error.
        let status = check_approval_status(api_url, api_key, peer_id).await
            .unwrap_or_else(|e| {
                tracing::warn!("Approval re-check failed, treating as pending: {}", e);
                "pending".to_string()
            });
        return Ok(MachineOut {
            id: String::new(),
            peer_id: peer_id.to_string(),
            name: body.name,
            approval_status: status,
        });
    }

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("API register failed {}: {}", status, text));
    }

    Ok(res.json::<MachineOut>().await?)
}

/// Poll the server once for the current approval status of this machine.
pub async fn check_approval_status(api_url: &str, api_key: &str, peer_id: &str) -> Result<String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}{}/{}", api_url, STATUS_PATH, peer_id))
        .header("X-API-Key", api_key)
        .send()
        .await?;

    if !res.status().is_success() {
        return Err(anyhow::anyhow!("Status check failed: {}", res.status()));
    }

    Ok(res.json::<ApprovalStatusResponse>().await?.approval_status)
}

pub async fn send_heartbeat(api_url: &str, peer_id: &str, online: bool) -> Result<()> {
    let client = reqwest::Client::new();
    let res = client
        .patch(format!("{}/machines/{}/heartbeat?online={}", api_url, peer_id, online))
        .send()
        .await?;
    if !res.status().is_success() {
        tracing::warn!("Heartbeat failed for peer_id={}: {}", peer_id, res.status());
    }
    Ok(())
}

fn get_hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME")) // Windows
        .or_else(|_| std::fs::read_to_string("/etc/hostname").map(|s| s.trim().to_string()))
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostname_not_empty() {
        let h = get_hostname();
        assert!(!h.is_empty());
    }

    #[test]
    fn register_path_constant() {
        assert_eq!(REGISTER_PATH, "/machines/register");
    }

    #[test]
    fn status_path_constant() {
        assert_eq!(STATUS_PATH, "/machines/status");
    }
}
