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

#[derive(Debug, Clone)]
pub struct AgentConfig {
    pub password: String,
    /// Single server URL — signaling WS and API REST are derived from this.
    pub server_url: Option<String>,
    pub api_token: Option<String>,
    pub display_index: usize,
    /// Store config next to exe instead of user config dir.
    pub portable: bool,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            password: std::env::var("PEERDESK_PASSWORD").unwrap_or_else(|_| "changeme".into()),
            server_url: std::env::var("PEERDESK_SERVER").ok(),
            api_token: std::env::var("API_TOKEN").ok().filter(|s| !s.is_empty()),
            display_index: std::env::var("DISPLAY_INDEX")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
            portable: false,
        }
    }
}

pub async fn run_agent(agent_cfg: AgentConfig) -> Result<()> {
    let config_path = Config::config_path(agent_cfg.portable);
    let cfg = Config::load_or_create(
        &config_path,
        &agent_cfg.password,
        agent_cfg.server_url.as_deref(),
        agent_cfg.api_token.as_deref(),
    )?;
    info!("PeerDesk agent — peer_id={}", cfg.peer_id);

    let signaling_url = cfg.signaling_url();
    let api_url = cfg.api_url();
    let effective_token = cfg.api_token.clone().or(agent_cfg.api_token);

    if let (Some(url), Some(token)) = (&api_url, &effective_token) {
        match api_client::register_machine(url, token, &cfg.peer_id).await {
            Ok(m) => info!("Registered with API — machine_id={}", m.id),
            Err(e) => tracing::warn!("API registration failed (non-fatal): {}", e),
        }
    } else {
        info!("Running in standalone mode (no API token)");
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
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("capture runtime");
        if let Err(e) = rt.block_on(capture::run(frame_tx, capture_display_index)) {
            tracing::error!("Capture error: {}", e);
        }
    });

    // enigo (input injection) is !Send on macOS, so run on a dedicated OS thread.
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("input runtime");
        if let Err(e) = rt.block_on(input::run(input_rx)) {
            tracing::warn!("Input error: {}", e);
        }
    });

    // Audio streaming (non-fatal if no device)
    // cpal::Stream is !Send, so run on a dedicated OS thread with its own runtime.
    let (audio_tx, _audio_rx) = tokio::sync::mpsc::channel::<audio::AudioFrame>(8);
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("audio runtime");
        if let Err(e) = rt.block_on(audio::run(audio_tx)) {
            tracing::warn!("Audio capture ended: {}", e);
        }
    });

    let peer_id = cfg.peer_id.clone();
    let pw_hash = cfg.password_hash.clone();
    let sig_url = signaling_url;

    // Spawn signaling client
    tokio::spawn(async move {
        if let Err(e) = signaling::run(&sig_url, &peer_id, &pw_hash, from_sig_tx, to_sig_rx).await {
            tracing::error!("Signaling error: {}", e);
        }
    });

    // Forward outbound WebRTC messages (Answer + ICE) → signaling server
    // Use take() to extract without consuming `peer`, so it remains usable below.
    let mut webrtc_out_rx = peer
        .from_signaling_rx
        .take()
        .expect("from_signaling_rx must be Some");
    let to_sig_fwd = to_sig_tx.clone();
    tokio::spawn(async move {
        while let Some(msg) = webrtc_out_rx.recv().await {
            if to_sig_fwd.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Main event loop: handle messages from signaling server
    loop {
        match from_sig_rx.recv().await {
            Some(signaling::SignalingMessage::ViewerPending {
                viewer_id,
                remote_ip,
            }) => {
                info!(
                    "Viewer {} from {} requesting connection — auto-approving",
                    viewer_id, remote_ip
                );
                // Auto-approve: send Approve back to signaling via to_sig_tx
                let approve = signaling::SignalingMessage::Approve { viewer_id };
                if let Err(e) = to_sig_tx.send(approve).await {
                    tracing::warn!("Failed to send approve: {}", e);
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
                info!("Viewer requested display switch to index {}", index);
                // TODO: restart capture thread with new display_index
                // For now, log and acknowledge
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
