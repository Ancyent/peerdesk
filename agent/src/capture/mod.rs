pub mod scale;

use anyhow::Result;
use std::time::Duration;
use xcap::Monitor;

pub struct FrameData {
    pub width: u32,
    pub height: u32,
    /// Raw RGBA bytes
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DisplayInfo {
    pub index: usize,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

/// Enumerate monitors in `Monitor::all()` order. The index is the position in
/// that vector and is reused verbatim by `run()` (capture) and
/// `display::resolve()` (input bounds), so a viewer's selected index always maps
/// to the same physical monitor everywhere. Never panics.
pub fn list_displays() -> Vec<DisplayInfo> {
    match Monitor::all() {
        Ok(monitors) => {
            tracing::info!("xcap enumerated {} monitor(s)", monitors.len());
            monitors
                .into_iter()
                .enumerate()
                .map(|(i, m)| {
                    let info = DisplayInfo {
                        index: i,
                        width: m.width().unwrap_or(0),
                        height: m.height().unwrap_or(0),
                        is_primary: m.is_primary().unwrap_or(i == 0),
                    };
                    tracing::info!(
                        "  monitor[{}] {}x{} pos=({},{}) primary={} name={:?}",
                        i,
                        info.width,
                        info.height,
                        m.x().unwrap_or(0),
                        m.y().unwrap_or(0),
                        info.is_primary,
                        m.name().unwrap_or_default(),
                    );
                    info
                })
                .collect()
        }
        Err(e) => {
            tracing::warn!("Could not enumerate monitors: {}", e);
            vec![]
        }
    }
}

/// Pick the monitor at `index`, falling back to primary then the first.
fn pick_monitor(monitors: &[Monitor], index: usize) -> Result<Monitor> {
    if let Some(m) = monitors.get(index) {
        return Ok(m.clone());
    }
    monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("no monitors available to capture"))
}

pub fn capture_one_frame() -> Result<(u32, u32, Vec<u8>)> {
    let monitors = Monitor::all()?;
    // `monitors.len()` is always out of range -> pick_monitor falls back to primary.
    let monitor = pick_monitor(&monitors, monitors.len())?;
    let img = monitor.capture_image()?;
    let (w, h) = (img.width(), img.height());
    Ok((w, h, img.into_raw()))
}

pub async fn run(
    tx: tokio::sync::broadcast::Sender<std::sync::Arc<FrameData>>,
    initial_display_index: usize,
    mut switch_rx: tokio::sync::mpsc::Receiver<usize>,
    quality_rx: tokio::sync::watch::Receiver<crate::quality::QualitySettings>,
) -> Result<()> {
    use std::sync::mpsc::TryRecvError as StdTryRecv;
    use tokio::sync::mpsc::error::TryRecvError as TokTryRecv;

    let mut display_index = initial_display_index;

    loop {
        let monitors = match Monitor::all() {
            Ok(m) if !m.is_empty() => m,
            Ok(_) => {
                tracing::warn!("no monitors enumerated; retrying shortly");
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
            Err(e) => {
                tracing::warn!("Monitor::all failed ({}); retrying shortly", e);
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
        };
        let monitor = pick_monitor(&monitors, display_index)?;

        // Prefer the streaming recorder (WGC/ScreenCaptureKit/X11). Fall back to
        // paced screenshots if the recorder won't initialise on this platform.
        let (recorder, frame_rx) = match monitor.video_recorder() {
            Ok(pair) => pair,
            Err(e) => {
                tracing::warn!(
                    "video_recorder init failed ({}); using screenshot fallback",
                    e
                );
                match screenshot_capture(&monitor, &tx, &mut switch_rx, &quality_rx).await {
                    Some(new_index) => {
                        display_index = new_index;
                        continue;
                    }
                    None => return Ok(()), // switch channel closed -> shut down
                }
            }
        };
        if let Err(e) = recorder.start() {
            tracing::warn!("recorder.start failed ({}); using screenshot fallback", e);
            match screenshot_capture(&monitor, &tx, &mut switch_rx, &quality_rx).await {
                Some(new_index) => {
                    display_index = new_index;
                    continue;
                }
                None => return Ok(()),
            }
        }

        let mut next_index: Option<usize> = None;
        'capture: loop {
            // 1) Honour a display switch request.
            match switch_rx.try_recv() {
                Ok(idx) => {
                    tracing::info!("Switching capture to display {}", idx);
                    next_index = Some(idx);
                    break 'capture;
                }
                Err(TokTryRecv::Empty) => {}
                Err(TokTryRecv::Disconnected) => {
                    let _ = recorder.stop();
                    return Ok(());
                }
            }

            // 2) Drain to the freshest frame so latency never backs up.
            let mut latest = None;
            loop {
                match frame_rx.try_recv() {
                    Ok(f) => latest = Some(f),
                    Err(StdTryRecv::Empty) => break,
                    Err(StdTryRecv::Disconnected) => break 'capture, // rebuild recorder
                }
            }

            match latest {
                Some(frame) => {
                    let (w, h) = (frame.width, frame.height);
                    let q = *quality_rx.borrow();
                    let (dw, dh) = scale::target_dims(w, h, q.max_height);
                    let (out_w, out_h, data) = if (dw, dh) != (w, h) {
                        (dw, dh, scale::downscale_8888(&frame.raw, w, h, dw, dh))
                    } else {
                        (w, h, frame.raw)
                    };
                    let _ = tx.send(std::sync::Arc::new(FrameData {
                        width: out_w,
                        height: out_h,
                        data,
                    }));
                    let frame_ms = (1000 / q.fps.max(1)) as u64;
                    tokio::time::sleep(Duration::from_millis(frame_ms)).await;
                }
                None => tokio::time::sleep(Duration::from_millis(8)).await,
            }
        }

        let _ = recorder.stop();
        if let Some(idx) = next_index {
            display_index = idx;
        }
    }
}

/// Paced screenshot fallback for platforms where `video_recorder()` fails.
/// Returns `Some(new_index)` to switch displays, or `None` if the switch channel
/// closed (shut down).
async fn screenshot_capture(
    monitor: &Monitor,
    tx: &tokio::sync::broadcast::Sender<std::sync::Arc<FrameData>>,
    switch_rx: &mut tokio::sync::mpsc::Receiver<usize>,
    quality_rx: &tokio::sync::watch::Receiver<crate::quality::QualitySettings>,
) -> Option<usize> {
    use tokio::sync::mpsc::error::TryRecvError as TokTryRecv;
    loop {
        match switch_rx.try_recv() {
            Ok(idx) => return Some(idx),
            Err(TokTryRecv::Empty) => {}
            Err(TokTryRecv::Disconnected) => return None,
        }
        match monitor.capture_image() {
            Ok(img) => {
                let (w, h) = (img.width(), img.height());
                let q = *quality_rx.borrow();
                let raw = img.into_raw();
                let (dw, dh) = scale::target_dims(w, h, q.max_height);
                let (out_w, out_h, data) = if (dw, dh) != (w, h) {
                    (dw, dh, scale::downscale_8888(&raw, w, h, dw, dh))
                } else {
                    (w, h, raw)
                };
                let _ = tx.send(std::sync::Arc::new(FrameData {
                    width: out_w,
                    height: out_h,
                    data,
                }));
                let frame_ms = (1000 / q.fps.max(1)) as u64;
                tokio::time::sleep(Duration::from_millis(frame_ms)).await;
            }
            Err(e) => {
                tracing::warn!("capture_image failed: {}", e);
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn frame_has_correct_dimensions() {
        // Capture needs a real display; skip headless CI.
        if std::env::var("DISPLAY").is_err() {
            eprintln!("skip: no DISPLAY set");
            return;
        }
        let (width, height, frame) = match super::capture_one_frame() {
            Ok(f) => f,
            Err(e) => {
                eprintln!("skip: capture unavailable ({e})");
                return;
            }
        };
        assert!(width > 0 && height > 0);
        assert_eq!(frame.len(), (width * height * 4) as usize);
    }

    #[test]
    fn list_displays_does_not_panic() {
        // May be empty in headless CI; must never panic.
        let _ = super::list_displays();
    }
}
