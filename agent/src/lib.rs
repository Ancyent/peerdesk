pub mod api_client;
pub mod audio;
pub mod capture;
pub mod clipboard;
pub mod config;
pub mod encode;
pub mod file_transfer;
pub mod input;
pub mod logging;
pub mod service;
pub mod signaling;
pub mod webrtc_peer;

use anyhow::Result;
use tracing::info;

pub use config::Config;

/// An incoming connection awaiting the host's decision. The agent sends one of
/// these over `AgentConfig::approval_tx` and waits on `reply` for accept/reject.
#[derive(Debug)]
pub struct ApprovalRequest {
    pub viewer_id: String,
    pub remote_ip: String,
    pub reply: tokio::sync::oneshot::Sender<bool>,
}

#[derive(Debug, Clone)]
pub struct AgentConfig {
    pub password: String,
    /// Single server URL — signaling WS and API REST are derived from this.
    pub server_url: Option<String>,
    pub api_key: Option<String>,
    pub display_index: usize,
    /// Store config next to exe instead of user config dir.
    pub portable: bool,
    /// If true, input injection disabled (view-only/cast mode).
    pub cast_only: bool,
    /// When set, each incoming connection is sent here for an attended
    /// accept/reject decision instead of being auto-approved. None (CLI agent)
    /// keeps the legacy auto-approve behavior.
    pub approval_tx: Option<tokio::sync::mpsc::Sender<ApprovalRequest>>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            password: std::env::var("PEERDESK_PASSWORD").unwrap_or_else(|_| "changeme".into()),
            server_url: std::env::var("PEERDESK_SERVER").ok(),
            api_key: std::env::var("API_KEY").ok().filter(|s| !s.is_empty()),
            display_index: std::env::var("DISPLAY_INDEX")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
            portable: false,
            cast_only: false,
            approval_tx: None,
        }
    }
}

/// Aborts the agent's background tokio tasks (signaling, heartbeat, forwarding)
/// when run_agent's future is dropped — e.g. when the Tauri host aborts the
/// agent on restart. Without this the signaling reconnect loop would keep
/// running as an orphan and a second peer connection would corrupt DTLS.
struct AbortOnDrop(Vec<tokio::task::AbortHandle>);
impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        for h in &self.0 {
            h.abort();
        }
    }
}

pub async fn run_agent(agent_cfg: AgentConfig) -> Result<()> {
    let approval_tx = agent_cfg.approval_tx.clone();
    let mut task_handles: Vec<tokio::task::AbortHandle> = Vec::new();
    let config_path = Config::config_path(agent_cfg.portable);
    let cfg = Config::load_or_create(
        &config_path,
        &agent_cfg.password,
        agent_cfg.server_url.as_deref(),
        agent_cfg.api_key.as_deref(),
    )?;
    info!("PeerDesk agent — peer_id={}", cfg.peer_id);

    let signaling_url = cfg.signaling_url();
    let api_url = cfg.api_url();
    let effective_key = cfg.api_key.clone().or(agent_cfg.api_key);

    if let (Some(url), Some(key)) = (&api_url, &effective_key) {
        match api_client::register_machine(url, key, &cfg.peer_id).await {
            Ok(machine) => {
                info!("Registered — machine_id={} status={}", machine.id, machine.approval_status);

                if machine.approval_status == "pending" {
                    info!("Waiting for admin approval (polling every 30s)...");
                    println!("⏳ Pending approval — approve this machine in your dashboard.");
                    loop {
                        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                        match api_client::check_approval_status(url, key, &cfg.peer_id).await {
                            Ok(s) if s == "approved" => {
                                info!("Machine approved — starting agent");
                                println!("✓ Approved!");
                                break;
                            }
                            Ok(s) if s == "denied" => {
                                return Err(anyhow::anyhow!(
                                    "Machine denied by admin. Contact your administrator."
                                ));
                            }
                            Ok(_) => tracing::debug!("Still pending..."),
                            Err(e) => tracing::warn!("Status poll error (retrying): {}", e),
                        }
                    }
                } else if machine.approval_status == "denied" {
                    return Err(anyhow::anyhow!(
                        "Machine denied. Contact your administrator."
                    ));
                }
            }
            Err(e) => tracing::warn!("API registration failed (non-fatal): {}", e),
        }
    } else {
        info!("Running in standalone mode (no API key)");
    }

    // Heartbeat: keep this machine marked online in the dashboard while the
    // agent runs. Without this the machine registers but stays is_online=false
    // (shown offline even after approval). Sends immediately, then every 30s.
    if let (Some(url), Some(_)) = (api_url.clone(), effective_key.clone()) {
        let hb_peer = cfg.peer_id.clone();
        let hb = tokio::spawn(async move {
            loop {
                if let Err(e) = api_client::send_heartbeat(&url, &hb_peer, true).await {
                    tracing::debug!("heartbeat error: {}", e);
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            }
        });
        task_handles.push(hb.abort_handle());
    }

    info!("Waiting for connections...");

    let (frame_tx, frame_rx) = tokio::sync::mpsc::channel(2);
    let (input_tx, input_rx) = tokio::sync::mpsc::channel(100);

    let mut peer = webrtc_peer::PeerConnection::new(frame_rx, input_tx).await?;

    // Channel: signaling server → main (Offer, IceCandidate, ViewerJoined, Error)
    let (from_sig_tx, mut from_sig_rx) =
        tokio::sync::mpsc::channel::<signaling::SignalingMessage>(32);

    // Channel: main → signaling server (Answer, outbound ICE from webrtc)
    let (to_sig_tx, to_sig_rx) = tokio::sync::mpsc::channel::<signaling::SignalingMessage>(32);

    // capture::run uses scrap::Capturer which is !Send, so run it on a
    // dedicated OS thread with its own single-threaded tokio runtime.
    let capture_display_index = agent_cfg.display_index;
    let (display_switch_tx, display_switch_rx) = tokio::sync::mpsc::channel::<usize>(4);
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("capture runtime");
        if let Err(e) = rt.block_on(capture::run(frame_tx, capture_display_index, display_switch_rx)) {
            tracing::error!("Capture error: {}", e);
        }
    });

    // enigo (input injection) is !Send on macOS, so run on a dedicated OS thread.
    if agent_cfg.cast_only {
        drop(input_rx);
        tracing::info!("Cast-only mode: input injection disabled");
    } else {
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("input runtime");
            if let Err(e) = rt.block_on(input::run(input_rx)) {
                tracing::warn!("Input error: {}", e);
            }
        });
    }

    // Audio capture is not yet wired into the WebRTC pipeline. Previously an
    // audio thread was spawned with a receiver that was dropped immediately,
    // so every blocking_send failed silently. Don't spawn the broken path
    // until audio has a real consumer.

    let peer_id = cfg.peer_id.clone();
    let pw_hash = cfg.password_hash.clone();
    let hmac_key = cfg.hmac_key.clone().unwrap_or_default();
    let sig_url = signaling_url;

    // Spawn signaling client
    let sig_handle = tokio::spawn(async move {
        if let Err(e) = signaling::run(&sig_url, &peer_id, &pw_hash, &hmac_key, from_sig_tx, to_sig_rx).await {
            tracing::error!("Signaling error: {}", e);
        }
    });
    task_handles.push(sig_handle.abort_handle());

    // Forward outbound WebRTC messages (Answer + ICE) → signaling server
    // Use take() to extract without consuming `peer`, so it remains usable below.
    let mut webrtc_out_rx = peer
        .from_signaling_rx
        .take()
        .expect("from_signaling_rx must be Some");
    let to_sig_fwd = to_sig_tx.clone();
    let fwd_handle = tokio::spawn(async move {
        while let Some(msg) = webrtc_out_rx.recv().await {
            if to_sig_fwd.send(msg).await.is_err() {
                break;
            }
        }
    });
    task_handles.push(fwd_handle.abort_handle());

    // When run_agent's future is dropped (host aborts the agent on restart),
    // abort these background tasks so no orphan signaling/peer connection lingers.
    let _abort_guard = AbortOnDrop(task_handles);

    // Main event loop: handle messages from signaling server
    loop {
        match from_sig_rx.recv().await {
            Some(signaling::SignalingMessage::ViewerPending {
                viewer_id,
                remote_ip,
            }) => {
                // Attended approval: ask the host UI to accept/reject. With no
                // approval channel (CLI agent) fall back to auto-approve.
                let approved = if let Some(tx) = &approval_tx {
                    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
                    let req = ApprovalRequest {
                        viewer_id: viewer_id.clone(),
                        remote_ip: remote_ip.clone(),
                        reply: reply_tx,
                    };
                    tracing::info!(
                        event = "viewer_connection_request",
                        viewer_id = %viewer_id,
                        remote_ip = %remote_ip,
                        action = "ask_host",
                        "Incoming connection request — waiting for host decision"
                    );
                    if tx.send(req).await.is_ok() {
                        // Deny if the host does not decide within 60s.
                        match tokio::time::timeout(
                            std::time::Duration::from_secs(60),
                            reply_rx,
                        )
                        .await
                        {
                            Ok(Ok(decision)) => decision,
                            _ => {
                                tracing::info!("No host decision within 60s — rejecting");
                                false
                            }
                        }
                    } else {
                        false
                    }
                } else {
                    tracing::info!(viewer_id = %viewer_id, "Auto-approving (no host UI)");
                    true
                };

                let msg = if approved {
                    signaling::SignalingMessage::Approve { viewer_id }
                } else {
                    signaling::SignalingMessage::Deny { viewer_id }
                };
                if let Err(e) = to_sig_tx.send(msg).await {
                    tracing::warn!("Failed to send approval decision: {}", e);
                }
            }
            Some(signaling::SignalingMessage::ViewerJoined { viewer_id }) => {
                info!("Viewer {} joined — waiting for WebRTC offer", viewer_id);
                let displays = capture::list_displays();
                let msg = signaling::SignalingMessage::DisplayList { displays };
                let _ = to_sig_tx.send(msg).await;
            }
            Some(signaling::SignalingMessage::Offer { sdp }) => {
                info!("Got offer — creating answer");
                if let Err(e) = peer.handle_offer(sdp).await {
                    tracing::error!("handle_offer failed: {}", e);
                }
            }
            Some(signaling::SignalingMessage::IceCandidate { candidate }) => {
                if let Err(e) = peer.add_ice_candidate(candidate).await {
                    tracing::warn!("add_ice_candidate failed: {}", e);
                }
            }
            Some(signaling::SignalingMessage::Error { code }) => {
                tracing::warn!("Signaling error from server: {}", code);
            }
            Some(signaling::SignalingMessage::SwitchDisplay { index }) => {
                info!("Switching to display {}", index);
                let _ = display_switch_tx.send(index).await;
            }
            Some(_) => {} // Registered, Answer, etc. — ignore in main loop
            None => {
                info!("Signaling channel closed — shutting down");
                break;
            }
        }
    }

    Ok(())
}
