//! Live video quality settings sent from the viewer over the `control` data
//! channel and applied to capture (fps + downscale) and encode (bitrate).

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QualitySettings {
    pub bitrate_kbps: u32,
    pub fps: u32,
    /// Max output height in px; 0 = no cap (native resolution).
    pub max_height: u32,
}

impl Default for QualitySettings {
    /// "Balanced" preset.
    fn default() -> Self {
        Self { bitrate_kbps: 2000, fps: 30, max_height: 1080 }
    }
}

impl QualitySettings {
    /// Clamp viewer-supplied values to safe bounds before applying.
    pub fn clamped(self) -> Self {
        Self {
            bitrate_kbps: self.bitrate_kbps.clamp(100, 8000),
            fps: self.fps.clamp(1, 60),
            max_height: if self.max_height == 0 { 0 } else { self.max_height.clamp(120, 4320) },
        }
    }
    pub fn bitrate_bps(self) -> u32 { self.bitrate_kbps.saturating_mul(1000) }
}

#[derive(Debug, serde::Deserialize)]
#[serde(tag = "type")]
pub enum ControlMessage {
    #[serde(rename = "set_quality")]
    SetQuality { bitrate_kbps: u32, fps: u32, max_height: u32 },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_out_of_range_values() {
        let q = QualitySettings { bitrate_kbps: 50, fps: 200, max_height: 10 }.clamped();
        assert_eq!(q.bitrate_kbps, 100);
        assert_eq!(q.fps, 60);
        assert_eq!(q.max_height, 120);
    }

    #[test]
    fn zero_max_height_means_no_cap() {
        let q = QualitySettings { bitrate_kbps: 2000, fps: 30, max_height: 0 }.clamped();
        assert_eq!(q.max_height, 0);
    }

    #[test]
    fn parses_set_quality_message() {
        let m: ControlMessage =
            serde_json::from_str(r#"{"type":"set_quality","bitrate_kbps":800,"fps":24,"max_height":720}"#).unwrap();
        let ControlMessage::SetQuality { bitrate_kbps, fps, max_height } = m;
        assert_eq!((bitrate_kbps, fps, max_height), (800, 24, 720));
    }
}
