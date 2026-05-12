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
}

impl H264Encoder {
    pub fn new(width: u32, height: u32, fps: u32) -> Result<Self> {
        let api = OpenH264API::from_source();
        let config = EncoderConfig::new()
            .max_frame_rate(fps as f32)
            .set_bitrate_bps(1_500_000)
            .debug(false);
        let encoder = Encoder::with_api_config(api, config)?;
        Ok(Self { encoder, width, height })
    }

    pub fn encode_bgra(&mut self, bgra: &[u8]) -> Result<Vec<u8>> {
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
        let mut encoder = H264Encoder::new(width, height, 30).expect("encoder init");
        let nals = encoder.encode_bgra(&bgra).expect("encode");
        assert!(!nals.is_empty(), "expected H.264 NAL units");
    }
}
