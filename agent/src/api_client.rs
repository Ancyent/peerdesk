use anyhow::Result;
use serde::{Deserialize, Serialize};

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
}

pub async fn register_machine(api_url: &str, token: &str, peer_id: &str) -> Result<MachineOut> {
    let client = reqwest::Client::new();
    let os = std::env::consts::OS.to_string();
    let body = MachineRegisterRequest {
        peer_id: peer_id.to_string(),
        name: format!("{} ({})", get_hostname(), os),
        os: Some(os),
    };

    let res = client
        .post(format!("{}/machines", api_url))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await?;

    if res.status().as_u16() == 409 {
        tracing::info!("Machine peer_id={} already registered with API", peer_id);
        return Ok(MachineOut {
            id: String::new(),
            peer_id: peer_id.to_string(),
            name: body.name,
        });
    }

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("API register failed {}: {}", status, text));
    }

    Ok(res.json::<MachineOut>().await?)
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
        .or_else(|_| std::fs::read_to_string("/etc/hostname").map(|s| s.trim().to_string()))
        .unwrap_or_else(|_| "Unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostname_not_empty() {
        let h = get_hostname();
        assert!(!h.is_empty());
    }
}
