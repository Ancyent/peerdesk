use anyhow::Result;
use openh264::{
    encoder::{Encoder, EncoderConfig},
    formats::{BgraSliceU8, YUVBuffer},
    OpenH264API,
};

pub struct H264Encoder {
    encoder: Encoder,
    width: u32,
    height: u32,
    frame_count: u32,
}

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

    pub fn encode_bgra(&mut self, bgra: &[u8]) -> Result<Vec<u8>> {
        let expected = (self.width as usize)
            .checked_mul(self.height as usize)
            .and_then(|n| n.checked_mul(4))
            .ok_or_else(|| anyhow::anyhow!("frame dimensions overflow"))?;
        anyhow::ensure!(
            bgra.len() == expected,
            "bgra buffer length {} != expected {}",
            bgra.len(),
            expected
        );
        // Force IDR keyframe every 60 frames so browsers can start decoding quickly
        if self.frame_count.is_multiple_of(60) {
            self.encoder.force_intra_frame();
        }
        self.frame_count += 1;
        let src = BgraSliceU8::new(bgra, (self.width as usize, self.height as usize));
        let yuv = YUVBuffer::from_rgb_source(src);
        let bitstream = self.encoder.encode(&yuv)?;
        Ok(bitstream.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_frame_to_h264_bytes() {
        let width = 320u32;
        let height = 240u32;
        let bgra = vec![0u8; (width * height * 4) as usize];
        let mut encoder = H264Encoder::new(width, height, 30, 800_000).expect("encoder init");
        let nals = encoder.encode_bgra(&bgra).expect("encode");
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
        let err = encoder.encode_bgra(&wrong_buf);
        assert!(err.is_err(), "expected error for wrong buffer size");
    }
}
