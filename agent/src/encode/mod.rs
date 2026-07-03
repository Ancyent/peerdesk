#[cfg(feature = "gui-capture")]
use anyhow::Result;
#[cfg(feature = "gui-capture")]
use openh264::{
    encoder::{Encoder, EncoderConfig},
    formats::{RgbaSliceU8, YUVBuffer},
    OpenH264API,
};

#[cfg(feature = "gui-capture")]
pub struct H264Encoder {
    encoder: Encoder,
    width: u32,
    height: u32,
    frame_count: u32,
}

#[cfg(feature = "gui-capture")]
impl H264Encoder {
    pub fn new(width: u32, height: u32, fps: u32, bitrate_bps: u32) -> Result<Self> {
        anyhow::ensure!(
            width.is_multiple_of(2) && height.is_multiple_of(2),
            "H.264 requires even dimensions, got {}x{}",
            width,
            height
        );
        let api = OpenH264API::from_source();
        let config = EncoderConfig::new()
            .max_frame_rate(fps as f32)
            .set_bitrate_bps(bitrate_bps)
            .enable_skip_frame(true)
            .debug(false);
        let encoder = Encoder::with_api_config(api, config)?;
        Ok(Self { encoder, width, height, frame_count: 0 })
    }

    pub fn encode_rgba(&mut self, rgba: &[u8]) -> Result<Vec<u8>> {
        let expected = (self.width as usize)
            .checked_mul(self.height as usize)
            .and_then(|n| n.checked_mul(4))
            .ok_or_else(|| anyhow::anyhow!("frame dimensions overflow"))?;
        anyhow::ensure!(
            rgba.len() == expected,
            "rgba buffer length {} != expected {}",
            rgba.len(),
            expected
        );
        // Force IDR keyframe every 60 frames so browsers can start decoding quickly
        if self.frame_count.is_multiple_of(60) {
            self.encoder.force_intra_frame();
        }
        self.frame_count += 1;
        let src = RgbaSliceU8::new(rgba, (self.width as usize, self.height as usize));
        let yuv = YUVBuffer::from_rgb_source(src);
        let bitstream = self.encoder.encode(&yuv)?;
        Ok(bitstream.to_vec())
    }
}

/// Headless build: no openh264. The type exists so the GUI-only video path in
/// `webrtc_peer` compiles, but any attempt to actually encode errors out — it is
/// never reached because the headless agent adds no video track.
#[cfg(not(feature = "gui-capture"))]
pub struct H264Encoder;

#[cfg(not(feature = "gui-capture"))]
impl H264Encoder {
    pub fn new(_width: u32, _height: u32, _fps: u32, _bitrate_bps: u32) -> anyhow::Result<Self> {
        anyhow::bail!("H.264 encoder unavailable in headless build")
    }

    pub fn encode_rgba(&mut self, _rgba: &[u8]) -> anyhow::Result<Vec<u8>> {
        anyhow::bail!("H.264 encoder unavailable in headless build")
    }
}

#[cfg(all(test, feature = "gui-capture"))]
mod tests {
    use super::*;

    #[test]
    fn encodes_frame_to_h264_bytes() {
        let width = 320u32;
        let height = 240u32;
        let rgba = vec![0u8; (width * height * 4) as usize];
        let mut encoder = H264Encoder::new(width, height, 30, 800_000).expect("encoder init");
        let nals = encoder.encode_rgba(&rgba).expect("encode");
        assert!(!nals.is_empty(), "expected H.264 NAL units");
    }

    #[test]
    fn rejects_odd_dimensions() {
        let err = H264Encoder::new(321, 240, 30, 800_000);
        assert!(err.is_err(), "expected error for odd width");
    }

    #[test]
    fn rejects_wrong_buffer_size() {
        let mut encoder = H264Encoder::new(320, 240, 30, 800_000).unwrap();
        let wrong_buf = vec![0u8; 100]; // way too small
        let err = encoder.encode_rgba(&wrong_buf);
        assert!(err.is_err(), "expected error for wrong buffer size");
    }
}
