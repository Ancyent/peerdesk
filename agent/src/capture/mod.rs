pub mod scale;

use anyhow::Result;
use scrap::{Capturer, Display};
use std::io::ErrorKind;
use std::time::Duration;
use tokio::sync::mpsc::Sender;

pub struct FrameData {
    pub width: u32,
    pub height: u32,
    /// Raw BGRA bytes
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DisplayInfo {
    pub index: usize,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

pub fn list_displays() -> Vec<DisplayInfo> {
    match scrap::Display::all() {
        Ok(displays) => displays
            .into_iter()
            .enumerate()
            .map(|(i, d)| DisplayInfo {
                index: i,
                width: d.width() as u32,
                height: d.height() as u32,
                is_primary: i == 0,
            })
            .collect(),
        Err(e) => {
            tracing::warn!("Could not enumerate displays: {}", e);
            vec![]
        }
    }
}

pub fn capture_one_frame() -> Result<(u32, u32, Vec<u8>)> {
    let display = Display::primary()?;
    let (w, h) = (display.width(), display.height());
    let mut capturer = Capturer::new(display)?;
    loop {
        match capturer.frame() {
            Ok(frame) => return Ok((w as u32, h as u32, frame.to_vec())),
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(16));
            }
            Err(e) => return Err(e.into()),
        }
    }
}

pub async fn run(
    tx: Sender<FrameData>,
    initial_display_index: usize,
    mut switch_rx: tokio::sync::mpsc::Receiver<usize>,
    quality_rx: tokio::sync::watch::Receiver<crate::quality::QualitySettings>,
) -> Result<()> {
    let mut display_index = initial_display_index;

    loop {
        let display = {
            let mut all = scrap::Display::all()?;
            if display_index < all.len() {
                all.remove(display_index)
            } else {
                scrap::Display::primary()?
            }
        };
        let (w, h) = (display.width() as u32, display.height() as u32);
        let mut capturer = Capturer::new(display)?;

        'capture: loop {
            match switch_rx.try_recv() {
                Ok(new_index) => {
                    tracing::info!("Switching capture to display {}", new_index);
                    display_index = new_index;
                    break 'capture;
                }
                Err(tokio::sync::mpsc::error::TryRecvError::Empty) => {}
                Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => return Ok(()),
            }

            match capturer.frame() {
                Ok(frame) => {
                    let q = *quality_rx.borrow();
                    let (dw, dh) = scale::target_dims(w, h, q.max_height);
                    let (out_w, out_h, data) = if (dw, dh) != (w, h) {
                        (dw, dh, scale::downscale_bgra(&frame, w, h, dw, dh))
                    } else {
                        (w, h, frame.to_vec())
                    };
                    let fd = FrameData { width: out_w, height: out_h, data };
                    match tx.try_send(fd) {
                        Ok(_) => {}
                        Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {}
                        Err(_) => return Ok(()),
                    }
                    // Pace to the target fps so we don't send more frames than asked.
                    let frame_ms = (1000 / q.fps.max(1)) as u64;
                    tokio::time::sleep(Duration::from_millis(frame_ms)).await;
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => {
                    tokio::time::sleep(Duration::from_millis(16)).await;
                }
                Err(e) => return Err(e.into()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn frame_has_correct_dimensions() {
        if std::env::var("DISPLAY").is_err() {
            eprintln!("skip: no DISPLAY set");
            return;
        }
        let (width, height, frame) = super::capture_one_frame().expect("capture failed");
        assert!(width > 0 && height > 0);
        assert_eq!(frame.len(), (width * height * 4) as usize);
    }

    #[test]
    fn list_displays_returns_slice() {
        if std::env::var("DISPLAY").is_err() {
            eprintln!("skip: no DISPLAY");
            return;
        }
        let displays = super::list_displays();
        assert!(!displays.is_empty());
        assert!(displays[0].is_primary);
    }
}
