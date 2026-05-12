use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::{Receiver, Sender};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SignalingMessage {
    Register { peer_id: String, password_hash: String },
    Registered { peer_id: String },
    ViewerJoined { viewer_id: String },
    ViewerPending { viewer_id: String, remote_ip: String },
    Approve { viewer_id: String },
    Deny { viewer_id: String },
    Denied { reason: String },
    Offer { sdp: String },
    Answer { sdp: String },
    IceCandidate { candidate: serde_json::Value },
    Error { code: String },
    SwitchDisplay { index: usize },
    DisplayList { displays: Vec<crate::capture::DisplayInfo> },
}

pub async fn run(
    signaling_url: &str,
    peer_id: &str,
    password_hash: &str,
    to_webrtc: Sender<SignalingMessage>,
    mut from_webrtc: Receiver<SignalingMessage>,
) -> Result<()> {
    let (ws_stream, _) = connect_async(signaling_url).await?;
    let (mut write, mut read) = ws_stream.split();

    let register = SignalingMessage::Register {
        peer_id: peer_id.to_string(),
        password_hash: password_hash.to_string(),
    };
    write.send(Message::Text(serde_json::to_string(&register)?)).await?;
    tracing::info!("Registered with signaling server, peer_id={}", peer_id);

    loop {
        tokio::select! {
            msg = read.next() => match msg {
                Some(Ok(Message::Text(text))) => {
                    match serde_json::from_str::<SignalingMessage>(&text) {
                        Ok(parsed) => {
                            if to_webrtc.send(parsed).await.is_err() {
                                // WebRTC side dropped — clean shutdown
                                break;
                            }
                        }
                        Err(e) => {
                            tracing::warn!("Ignoring unrecognised signaling message: {}", e);
                        }
                    }
                }
                Some(Ok(_)) => {
                    // Ping/Pong/Binary/Close frames — ignore
                }
                Some(Err(e)) => return Err(e.into()),
                None => {
                    tracing::info!("Signaling server closed connection");
                    break;
                }
            },
            msg = from_webrtc.recv() => match msg {
                Some(msg) => {
                    write.send(Message::Text(serde_json::to_string(&msg)?)).await?;
                }
                None => {
                    // All WebRTC senders dropped — nothing more to forward
                    break;
                }
            },
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_register_message() {
        let msg = SignalingMessage::Register {
            peer_id: "123456789".into(),
            password_hash: "hash".into(),
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
        let msg = SignalingMessage::Approve { viewer_id: "abc".into() };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"approve\""));
    }

    #[test]
    fn serializes_display_list_message() {
        use crate::capture::DisplayInfo;
        let msg = SignalingMessage::DisplayList {
            displays: vec![DisplayInfo { index: 0, width: 1920, height: 1080, is_primary: true }],
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
}
