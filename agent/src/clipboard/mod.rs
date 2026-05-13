use anyhow::Result;
use std::time::Duration;
use tokio::sync::mpsc::{Receiver, Sender};

pub struct ClipboardMessage {
    pub text: String,
}

/// Runs clipboard sync:
/// - Polls local clipboard every 500ms for changes → sends via `out_tx`
/// - Receives text via `in_rx` → writes to local clipboard
///
/// Runs clipboard I/O on a dedicated OS thread (arboard is blocking/!Send).
pub async fn run(
    out_tx: Sender<ClipboardMessage>,
    mut in_rx: Receiver<ClipboardMessage>,
) -> Result<()> {
    let (poll_tx, mut poll_rx) = tokio::sync::mpsc::channel::<String>(8);
    let (write_tx, write_rx) = std::sync::mpsc::sync_channel::<String>(8);

    std::thread::spawn(move || {
        let mut clipboard = match arboard::Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("Clipboard unavailable (no display?): {}", e);
                return;
            }
        };
        let mut last_text = clipboard.get_text().unwrap_or_default();

        loop {
            // Write incoming clipboard from viewer
            while let Ok(text) = write_rx.try_recv() {
                if let Err(e) = clipboard.set_text(&text) {
                    tracing::warn!("Failed to set clipboard: {}", e);
                } else {
                    last_text = text;
                }
            }

            // Poll for local clipboard changes
            if let Ok(current) = clipboard.get_text() {
                if !current.is_empty() && current != last_text {
                    last_text = current.clone();
                    let _ = poll_tx.blocking_send(current);
                }
            }

            std::thread::sleep(Duration::from_millis(500));
        }
    });

    loop {
        tokio::select! {
            Some(text) = poll_rx.recv() => {
                let _ = out_tx.send(ClipboardMessage { text }).await;
            }
            Some(msg) = in_rx.recv() => {
                let _ = write_tx.send(msg.text);
            }
            else => break,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_message_holds_text() {
        let msg = ClipboardMessage {
            text: "hello clipboard".into(),
        };
        assert_eq!(msg.text, "hello clipboard");
    }
}
