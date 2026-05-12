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

pub async fn run(tx: Sender<FrameData>) -> Result<()> {
    let display = Display::primary()?;
    let (w, h) = (display.width() as u32, display.height() as u32);
    let mut capturer = Capturer::new(display)?;

    loop {
        match capturer.frame() {
            Ok(frame) => {
                let fd = FrameData { width: w, height: h, data: frame.to_vec() };
                // try_send drops the frame if encoder is busy — prevents latency buildup
                match tx.try_send(fd) {
                    Ok(_) => {}
                    Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                        // encoder backpressure — skip frame to stay live
                    }
                    Err(_) => break,
                }
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                tokio::time::sleep(Duration::from_millis(16)).await;
            }
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
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
}
