use crate::capture::FrameData;
use crate::encode::H264Encoder;
use crate::input::InputEvent;
use crate::signaling::SignalingMessage;
use anyhow::Result;
use std::sync::Arc;
use tokio::sync::mpsc::{Receiver, Sender};
use webrtc::{
    api::{interceptor_registry, media_engine::MediaEngine, APIBuilder},
    ice_transport::ice_server::RTCIceServer,
    media::Sample,
    peer_connection::{
        configuration::RTCConfiguration,
        sdp::session_description::RTCSessionDescription,
        RTCPeerConnection,
    },
    rtp_transceiver::rtp_codec::RTCRtpCodecCapability,
    track::track_local::track_local_static_sample::TrackLocalStaticSample,
};

pub struct PeerConnection {
    pc: Arc<RTCPeerConnection>,
    pub to_signaling_tx: Sender<SignalingMessage>,
    pub from_signaling_rx: Option<Receiver<SignalingMessage>>,
    pub clipboard_in_rx: Option<tokio::sync::mpsc::Receiver<String>>,  // from viewer → agent writes to clipboard
    pub clipboard_out_tx: tokio::sync::mpsc::Sender<String>,           // from agent clipboard → viewer
}

impl PeerConnection {
    pub async fn new(
        frame_rx: Receiver<FrameData>,
        input_tx: Sender<InputEvent>,
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
            ice_servers: vec![RTCIceServer {
                urls: vec!["stun:stun.l.google.com:19302".to_owned()],
                ..Default::default()
            }],
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

        pc.add_track(
            Arc::clone(&video_track)
                as Arc<dyn webrtc::track::track_local::TrackLocal + Send + Sync>,
        )
        .await?;

        // Handle incoming data channels from viewer (input events, clipboard)
        let input_tx_clone = input_tx.clone();
        let (clipboard_in_tx, clipboard_in_rx) = tokio::sync::mpsc::channel::<String>(16);
        let (clipboard_out_tx, clipboard_out_rx) = tokio::sync::mpsc::channel::<String>(16);
        let _ = clipboard_out_rx; // receiver wired in main.rs when needed
        let clipboard_in_tx_clone = clipboard_in_tx.clone();
        pc.on_data_channel(Box::new(move |dc| {
            let input_tx = input_tx_clone.clone();
            let clipboard_tx = clipboard_in_tx_clone.clone();
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
                    _ => {}
                }
            })
        }));

        // Spawn video frame sender
        let track = Arc::clone(&video_track);
        tokio::spawn(async move { send_video_frames(frame_rx, track).await });

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
            from_signaling_rx: Some(to_sig_rx),  // receiver for ICE+Answer outbound to signaling
            clipboard_in_rx: Some(clipboard_in_rx),
            clipboard_out_tx,
        })
    }

    pub async fn handle_offer(&self, sdp: String) -> Result<()> {
        let offer = RTCSessionDescription::offer(sdp)?;
        self.pc.set_remote_description(offer).await?;
        let answer = self.pc.create_answer(None).await?;
        self.pc.set_local_description(answer.clone()).await?;
        self.to_signaling_tx
            .send(SignalingMessage::Answer { sdp: answer.sdp })
            .await?;
        Ok(())
    }

    pub async fn add_ice_candidate(&self, candidate: serde_json::Value) -> Result<()> {
        use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
        let init: RTCIceCandidateInit = serde_json::from_value(candidate)?;
        self.pc.add_ice_candidate(init).await?;
        Ok(())
    }
}

async fn send_video_frames(
    mut frame_rx: Receiver<FrameData>,
    track: Arc<TrackLocalStaticSample>,
) {
    let mut encoder: Option<H264Encoder> = None;
    while let Some(frame) = frame_rx.recv().await {
        if encoder.is_none() {
            match H264Encoder::new(frame.width, frame.height, 30) {
                Ok(enc) => { encoder = Some(enc); }
                Err(e) => {
                    tracing::error!("H264Encoder init failed: {}", e);
                    continue;
                }
            }
        }
        let enc = encoder.as_mut().unwrap();
        if let Ok(h264) = enc.encode_bgra(&frame.data) {
            if !h264.is_empty() {
                let _ = track
                    .write_sample(&Sample {
                        data: h264.into(),
                        duration: std::time::Duration::from_millis(33),
                        ..Default::default()
                    })
                    .await;
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
        let result = PeerConnection::new(frame_rx, input_tx).await;
        assert!(
            result.is_ok(),
            "PeerConnection creation failed: {:?}",
            result.err()
        );
    }
}
