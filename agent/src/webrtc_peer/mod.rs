use crate::capture::FrameData;
use crate::encode::H264Encoder;
use crate::input::InputEvent;
use crate::signaling::SignalingMessage;
use anyhow::Result;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio::sync::mpsc::{Receiver, Sender};
use webrtc::{
    api::{interceptor_registry, media_engine::MediaEngine, APIBuilder},
    ice_transport::ice_server::RTCIceServer,
    media::Sample,
    peer_connection::{
        configuration::RTCConfiguration, sdp::session_description::RTCSessionDescription,
        RTCPeerConnection,
    },
    rtp_transceiver::rtp_codec::RTCRtpCodecCapability,
    track::track_local::track_local_static_sample::TrackLocalStaticSample,
};

pub struct PeerConnection {
    pc: Arc<RTCPeerConnection>,
    pub to_signaling_tx: Sender<SignalingMessage>,
    pub from_signaling_rx: Option<Receiver<SignalingMessage>>,
    pub clipboard_in_rx: Option<tokio::sync::mpsc::Receiver<String>>, // from viewer → agent writes to clipboard
    pub clipboard_out_tx: tokio::sync::mpsc::Sender<String>, // from agent clipboard → viewer
    pub ft_in_tx: tokio::sync::mpsc::Sender<crate::file_transfer::FtMessage>,
    pub ft_control_rx: Option<tokio::sync::mpsc::Receiver<String>>,
    pub security_code: Arc<std::sync::Mutex<Option<String>>>,
}

impl PeerConnection {
    pub async fn new(
        frame_rx: Receiver<FrameData>,
        input_tx: Sender<InputEvent>,
        ice_servers: Vec<RTCIceServer>,
        quality_tx: tokio::sync::watch::Sender<crate::quality::QualitySettings>,
        cursor_tx: tokio::sync::watch::Sender<(f32, f32)>,
    ) -> Result<Self> {
        let mut media_engine = MediaEngine::default();
        media_engine.register_default_codecs()?;

        let registry = interceptor_registry::register_default_interceptors(
            webrtc::interceptor::registry::Registry::new(),
            &mut media_engine,
        )?;

        let api = APIBuilder::new()
            .with_media_engine(media_engine)
            .with_interceptor_registry(registry)
            .build();

        let config = RTCConfiguration {
            ice_servers,
            ..Default::default()
        };

        let pc = Arc::new(api.new_peer_connection(config).await?);

        let video_track = Arc::new(TrackLocalStaticSample::new(
            RTCRtpCodecCapability {
                mime_type: "video/H264".to_owned(),
                ..Default::default()
            },
            "video".to_owned(),
            "peerdesk".to_owned(),
        ));

        pc.add_track(Arc::clone(&video_track)
            as Arc<dyn webrtc::track::track_local::TrackLocal + Send + Sync>)
            .await?;

        // Handle incoming data channels from viewer (input events, clipboard, file transfer)
        let input_tx_clone = input_tx.clone();
        let (clipboard_in_tx, clipboard_in_rx) = tokio::sync::mpsc::channel::<String>(16);
        let (clipboard_out_tx, clipboard_out_rx) = tokio::sync::mpsc::channel::<String>(16);
        let _ = clipboard_out_rx; // receiver wired in main.rs when needed
        let (ft_in_tx, ft_in_rx) =
            tokio::sync::mpsc::channel::<crate::file_transfer::FtMessage>(32);
        let (ft_control_tx, ft_control_rx) = tokio::sync::mpsc::channel::<String>(32);
        let clipboard_in_tx_clone = clipboard_in_tx.clone();
        let ft_in_tx_clone = ft_in_tx.clone();
        let quality_tx_dc = quality_tx.clone();
        let cursor_tx_dc = cursor_tx.clone();
        pc.on_data_channel(Box::new(move |dc| {
            let input_tx = input_tx_clone.clone();
            let clipboard_tx = clipboard_in_tx_clone.clone();
            let ft_tx = ft_in_tx_clone.clone();
            let quality_tx = quality_tx_dc.clone();
            let cursor_tx = cursor_tx_dc.clone();
            Box::pin(async move {
                match dc.label() {
                    "input" => {
                        dc.on_message(Box::new(move |msg| {
                            let tx = input_tx.clone();
                            let data = msg.data.to_vec();
                            Box::pin(async move {
                                if let Ok(text) = std::str::from_utf8(&data) {
                                    if let Ok(event) = serde_json::from_str::<InputEvent>(text) {
                                        let _ = tx.send(event).await;
                                    }
                                }
                            })
                        }));
                    }
                    "clipboard" => {
                        dc.on_message(Box::new(move |msg| {
                            let tx = clipboard_tx.clone();
                            let data = msg.data.to_vec();
                            Box::pin(async move {
                                if let Ok(text) = std::str::from_utf8(&data) {
                                    let _ = tx.send(text.to_string()).await;
                                }
                            })
                        }));
                    }
                    "filetransfer" => {
                        dc.on_message(Box::new(move |msg| {
                            let tx = ft_tx.clone();
                            let data = msg.data.to_vec();
                            let is_binary = !msg.is_string;
                            Box::pin(async move {
                                if is_binary {
                                    let _ =
                                        tx.send(crate::file_transfer::FtMessage::Chunk(data)).await;
                                } else if let Ok(text) = std::str::from_utf8(&data) {
                                    let _ = tx
                                        .send(crate::file_transfer::FtMessage::Control(
                                            text.to_string(),
                                        ))
                                        .await;
                                }
                            })
                        }));
                    }
                    "control" => {
                        let qtx = quality_tx.clone();
                        dc.on_message(Box::new(move |msg| {
                            let qtx = qtx.clone();
                            let data = msg.data.to_vec();
                            Box::pin(async move {
                                if let Ok(text) = std::str::from_utf8(&data) {
                                    if let Ok(crate::quality::ControlMessage::SetQuality {
                                        bitrate_kbps, fps, max_height,
                                    }) = serde_json::from_str(text) {
                                        let q = crate::quality::QualitySettings {
                                            bitrate_kbps, fps, max_height,
                                        }.clamped();
                                        let _ = qtx.send(q);
                                    }
                                }
                            })
                        }));
                    }
                    "cursor" => {
                        let mut rx = cursor_tx.subscribe();
                        let dc2 = dc.clone();
                        tokio::spawn(async move {
                            while rx.changed().await.is_ok() {
                                let (x, y) = *rx.borrow();
                                if dc2
                                    .send_text(format!("{{\"x\":{:.4},\"y\":{:.4}}}", x, y))
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                            }
                        });
                    }
                    _ => {}
                }
            })
        }));

        tokio::spawn(crate::file_transfer::run(ft_in_rx, ft_control_tx));

        // Spawn video frame sender
        let track = Arc::clone(&video_track);
        let video_quality_rx = quality_tx.subscribe();
        tokio::spawn(async move { send_video_frames(frame_rx, track, video_quality_rx).await });

        let (to_sig_tx, to_sig_rx) = tokio::sync::mpsc::channel::<SignalingMessage>(32);

        // Forward ICE candidates to signaling
        let to_sig = to_sig_tx.clone();
        pc.on_ice_candidate(Box::new(move |c| {
            let tx = to_sig.clone();
            Box::pin(async move {
                if let Some(candidate) = c {
                    if let Ok(json) = candidate.to_json() {
                        let val = serde_json::to_value(json).unwrap_or_default();
                        let _ = tx
                            .send(SignalingMessage::IceCandidate { candidate: val })
                            .await;
                    }
                }
            })
        }));

        Ok(Self {
            pc,
            to_signaling_tx: to_sig_tx,
            from_signaling_rx: Some(to_sig_rx), // receiver for ICE+Answer outbound to signaling
            clipboard_in_rx: Some(clipboard_in_rx),
            clipboard_out_tx,
            ft_in_tx,
            ft_control_rx: Some(ft_control_rx),
            security_code: Arc::new(std::sync::Mutex::new(None)),
        })
    }

    pub async fn handle_offer(&self, sdp: String) -> Result<()> {
        let offer = RTCSessionDescription::offer(sdp.clone())?;
        self.pc.set_remote_description(offer).await?;
        let answer = self.pc.create_answer(None).await?;
        self.pc.set_local_description(answer.clone()).await?;
        self.to_signaling_tx
            .send(SignalingMessage::Answer { sdp: answer.sdp.clone() })
            .await?;
        // Derive security code from DTLS fingerprints in SDP
        let local_fp = extract_fingerprint(&answer.sdp).unwrap_or_default();
        let remote_fp = extract_fingerprint(&sdp).unwrap_or_default();
        if !local_fp.is_empty() && !remote_fp.is_empty() {
            let code = derive_security_code(&local_fp, &remote_fp);
            tracing::info!("Security code: {}", code);
            if let Ok(mut guard) = self.security_code.lock() {
                *guard = Some(code);
            }
        }
        Ok(())
    }

    pub async fn add_ice_candidate(&self, candidate: serde_json::Value) -> Result<()> {
        use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
        let init: RTCIceCandidateInit = serde_json::from_value(candidate)?;
        self.pc.add_ice_candidate(init).await?;
        Ok(())
    }
}

pub fn derive_security_code(local_fp: &str, remote_fp: &str) -> String {
    let mut fps = [local_fp, remote_fp];
    fps.sort();
    let combined = format!("{}|{}", fps[0], fps[1]);
    let hash = Sha256::digest(combined.as_bytes());
    let num = u32::from_be_bytes([hash[0], hash[1], hash[2], hash[3]]);
    format!("{:06}", num % 1_000_000)
}

fn extract_fingerprint(sdp: &str) -> Option<String> {
    sdp.lines()
        .find(|l| l.starts_with("a=fingerprint:"))
        .map(|l| l.trim_start_matches("a=fingerprint:").to_string())
}

async fn send_video_frames(
    mut frame_rx: Receiver<FrameData>,
    track: Arc<TrackLocalStaticSample>,
    quality_rx: tokio::sync::watch::Receiver<crate::quality::QualitySettings>,
) {
    let mut encoder: Option<H264Encoder> = None;
    let mut enc_key: (u32, u32, u32, u32) = (0, 0, 0, 0); // w,h,fps,bitrate_bps
    while let Some(frame) = frame_rx.recv().await {
        let q = *quality_rx.borrow();
        let key = (frame.width, frame.height, q.fps, q.bitrate_bps());
        if enc_key != key {
            encoder = None;
        }
        if encoder.is_none() {
            match H264Encoder::new(frame.width, frame.height, q.fps, q.bitrate_bps()) {
                Ok(enc) => {
                    encoder = Some(enc);
                    enc_key = key;
                }
                Err(e) => {
                    tracing::error!("H264Encoder init failed: {}", e);
                    continue;
                }
            }
        }
        let enc = encoder.as_mut().unwrap();
        match enc.encode_bgra(&frame.data) {
            Ok(h264) => {
                if !h264.is_empty() {
                    let _ = track
                        .write_sample(&Sample {
                            data: h264.into(),
                            duration: std::time::Duration::from_millis((1000 / q.fps.max(1)) as u64),
                            ..Default::default()
                        })
                        .await;
                }
            }
            Err(e) => {
                // Drop the encoder so it re-inits on the next frame.
                tracing::warn!("encode_bgra failed, resetting encoder: {}", e);
                encoder = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn creates_peer_connection() {
        let (_frame_tx, frame_rx) = tokio::sync::mpsc::channel(1);
        let (input_tx, _input_rx) = tokio::sync::mpsc::channel(10);
        let (qtx, _qrx) = tokio::sync::watch::channel(crate::quality::QualitySettings::default());
        let (ctx, _crx) = tokio::sync::watch::channel((0.5_f32, 0.5_f32));
        let result = PeerConnection::new(frame_rx, input_tx, vec![], qtx, ctx).await;
        assert!(
            result.is_ok(),
            "PeerConnection creation failed: {:?}",
            result.err()
        );
    }

    #[test]
    fn security_code_is_6_digits() {
        let code = derive_security_code("sha-256 AA:BB:CC", "sha-256 DD:EE:FF");
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn security_code_is_symmetric() {
        let code_ab = derive_security_code("fp_a", "fp_b");
        let code_ba = derive_security_code("fp_b", "fp_a");
        assert_eq!(code_ab, code_ba);
    }
}
