use anyhow::Result;
use std::time::Duration;
use tokio::sync::mpsc::Sender;

pub struct AudioFrame {
    pub samples: Vec<i16>,
    pub sample_rate: u32,
    pub channels: u16,
}

/// Captures audio from the default input device and sends PCM frames.
/// Gracefully returns Ok(()) if no audio device is available.
pub async fn run(tx: Sender<AudioFrame>) -> Result<()> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(d) => d,
        None => {
            tracing::warn!("No audio input device — audio streaming disabled");
            return Ok(());
        }
    };

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("No audio config available: {} — audio streaming disabled", e);
            return Ok(());
        }
    };

    let sample_rate = config.sample_rate().0;
    let channels = config.channels();
    tracing::info!("Audio: {} Hz, {} channel(s)", sample_rate, channels);

    let tx_clone = tx.clone();
    let stream = device.build_input_stream(
        &config.into(),
        move |data: &[f32], _: &cpal::InputCallbackInfo| {
            let samples: Vec<i16> = data
                .iter()
                .map(|&s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
                .collect();
            let _ = tx_clone.blocking_send(AudioFrame {
                samples,
                sample_rate,
                channels,
            });
        },
        |err| tracing::error!("Audio stream error: {}", err),
        None,
    )?;

    stream.play()?;

    // Keep the stream alive
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_frame_stores_samples() {
        let frame = AudioFrame {
            samples: vec![0i16; 960],
            sample_rate: 48000,
            channels: 1,
        };
        assert_eq!(frame.samples.len(), 960);
        assert_eq!(frame.sample_rate, 48000);
        assert_eq!(frame.channels, 1);
    }
}
