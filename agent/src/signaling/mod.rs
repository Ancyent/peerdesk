use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::{Receiver, Sender};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SignalingMessage {
    Register {
        peer_id: String,
        password_hash: String,
        hmac_key: String,
    },
    Registered {
        peer_id: String,
    },
    ViewerJoined {
        viewer_id: String,
    },
    ViewerPending {
        viewer_id: String,
        remote_ip: String,
    },
    Approve {
        viewer_id: String,
    },
    Deny {
        viewer_id: String,
    },
    Denied {
        reason: String,
    },
    Offer {
        sdp: String,
    },
    Answer {
        sdp: String,
    },
    IceCandidate {
        candidate: serde_json::Value,
    },
    Error {
        code: String,
    },
    SwitchDisplay {
        index: usize,
    },
    DisplayList {
        displays: Vec<crate::capture::DisplayInfo>,
    },
    SessionMode {
        mode: String,
    },
    /// What this host permits for the session being set up. Sent on `Offer`,
    /// beside `SessionMode`, so the viewer can decide what to draw before the
    /// peer connection exists — a capability list delivered over a data
    /// channel would arrive after the toolbar is already on screen.
    ///
    /// Three booleans rather than a list of names: a viewer that does not
    /// recognise a name cannot tell "denied" from "this build is older than
    /// the name", and an unknown field is simply ignored.
    Capabilities {
        input: bool,
        file_transfer: bool,
        terminal: bool,
    },
}

pub async fn run(
    signaling_url: &str,
    peer_id: &str,
    password_hash: &str,
    hmac_key: &str,
    to_webrtc: Sender<SignalingMessage>,
    mut from_webrtc: Receiver<SignalingMessage>,
) -> Result<()> {
    if signaling_url.starts_with("ws://")
        && !signaling_url.contains("localhost")
        && !signaling_url.contains("127.0.0.1")
    {
        tracing::warn!(
            "⚠ Connecting to signaling server over unencrypted ws:// — \
             use wss:// in production. Passwords and metadata are visible to network observers."
        );
    }
    // Reconnect loop: keep the agent registered through transient drops
    // (network blips, server/nginx restarts). Without this a single disconnect
    // would silently de-register the agent until the app restarted.
    let mut backoff_secs = 1u64;
    let mut first = true;
    'reconnect: loop {
        if !first {
            tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)).await;
        }
        first = false;

        let (mut write, mut read) = match connect_async(signaling_url).await {
            Ok((stream, _)) => stream.split(),
            Err(e) => {
                tracing::warn!("Signaling connect failed: {} — retry in {}s", e, backoff_secs);
                backoff_secs = (backoff_secs * 2).min(15);
                continue 'reconnect;
            }
        };

        let register = SignalingMessage::Register {
            peer_id: peer_id.to_string(),
            password_hash: password_hash.to_string(),
            hmac_key: hmac_key.to_string(),
        };
        if let Err(e) = write
            .send(Message::Text(serde_json::to_string(&register)?))
            .await
        {
            tracing::warn!("Register send failed: {} — retry", e);
            backoff_secs = (backoff_secs * 2).min(15);
            continue 'reconnect;
        }
        // Registration only counts once the server acks it with `registered`.
        // Logging success here (before any ack) used to report a healthy agent
        // that the server had in fact rejected — see the Registered/Error arms.
        tracing::debug!("Sent registration for peer_id={} — awaiting ack", peer_id);

        // Keepalive: ping the server every 30s so an idle connection isn't dropped
        // by a NAT/firewall idle timeout. A dropped idle socket leaves the host
        // unable to receive connection requests until the agent reconnects.
        let mut keepalive = tokio::time::interval(std::time::Duration::from_secs(30));
        keepalive.tick().await; // consume the immediate first tick

        loop {
            tokio::select! {
                _ = keepalive.tick() => {
                    if let Err(e) = write.send(Message::Ping(Vec::new())).await {
                        tracing::warn!("Signaling keepalive ping failed: {} — reconnecting", e);
                        continue 'reconnect;
                    }
                }
                msg = read.next() => match msg {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<SignalingMessage>(&text) {
                            Ok(SignalingMessage::Registered { peer_id: acked }) => {
                                tracing::info!("Registered with signaling server, peer_id={}", acked);
                                backoff_secs = 1; // confirmed — reset after a good registration
                            }
                            Ok(SignalingMessage::Error { code }) if code == "peer_id_in_use" => {
                                // The server still holds a registration for this
                                // peer_id, so we are NOT registered: viewers can
                                // never reach us and are authenticated against the
                                // stale record instead. Idling here would look
                                // healthy while being permanently unreachable, so
                                // drop the socket and retry until the slot frees.
                                tracing::warn!(
                                    "Registration rejected — peer_id {} already in use on the server; retry in {}s",
                                    peer_id,
                                    backoff_secs
                                );
                                backoff_secs = (backoff_secs * 2).min(15);
                                continue 'reconnect;
                            }
                            Ok(parsed) => {
                                if to_webrtc.send(parsed).await.is_err() {
                                    return Ok(()); // WebRTC side dropped — shut down
                                }
                            }
                            Err(e) => {
                                tracing::warn!("Ignoring unrecognised signaling message: {}", e);
                            }
                        }
                    }
                    Some(Ok(_)) => {} // Ping/Pong/Binary/Close — ignore
                    Some(Err(e)) => {
                        tracing::warn!("Signaling read error: {} — reconnecting", e);
                        continue 'reconnect;
                    }
                    None => {
                        tracing::info!("Signaling server closed connection — reconnecting");
                        continue 'reconnect;
                    }
                },
                msg = from_webrtc.recv() => match msg {
                    Some(msg) => {
                        if let Err(e) = write
                            .send(Message::Text(serde_json::to_string(&msg)?))
                            .await
                        {
                            tracing::warn!("Signaling write error: {} — reconnecting", e);
                            continue 'reconnect;
                        }
                    }
                    None => return Ok(()), // All WebRTC senders dropped — shut down
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_register_message() {
        let msg = SignalingMessage::Register {
            peer_id: "123456789".into(),
            password_hash: "hash".into(),
            hmac_key: "deadbeef".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"register\""));
        assert!(json.contains("\"peer_id\":\"123456789\""));
    }

    #[test]
    fn deserializes_viewer_joined() {
        let json = r#"{"type":"viewer_joined","viewer_id":"abc-123"}"#;
        let msg: SignalingMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, SignalingMessage::ViewerJoined { .. }));
    }

    #[test]
    fn deserializes_viewer_pending() {
        let json = r#"{"type":"viewer_pending","viewer_id":"abc","remote_ip":"1.2.3.4"}"#;
        let msg: SignalingMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, SignalingMessage::ViewerPending { .. }));
    }

    #[test]
    fn serializes_approve_message() {
        let msg = SignalingMessage::Approve {
            viewer_id: "abc".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"approve\""));
    }

    #[test]
    fn serializes_display_list_message() {
        use crate::capture::DisplayInfo;
        let msg = SignalingMessage::DisplayList {
            displays: vec![DisplayInfo {
                index: 0,
                width: 1920,
                height: 1080,
                is_primary: true,
            }],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"display_list\""));
    }

    #[test]
    fn deserializes_switch_display() {
        let json = r#"{"type":"switch_display","index":1}"#;
        let msg: SignalingMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, SignalingMessage::SwitchDisplay { index: 1 }));
    }

    #[test]
    fn capabilities_serializes_to_the_shape_the_viewers_parse() {
        let msg = SignalingMessage::Capabilities {
            input: true,
            file_transfer: false,
            terminal: true,
        };
        let v: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(v["type"], "capabilities");
        assert_eq!(v["input"], true);
        assert_eq!(v["file_transfer"], false);
        assert_eq!(v["terminal"], true);
    }
}
