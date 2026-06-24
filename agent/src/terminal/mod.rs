//! Runs the user's shell in a PTY and bridges it to a byte stream for the viewer.

use anyhow::Result;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use std::io::{Read, Write};

/// A message from the viewer's `terminal` data channel is either a resize control
/// (JSON `{"type":"resize","cols":..,"rows":..}`) or raw keystroke bytes.
#[derive(Debug, PartialEq)]
pub enum ClientMsg {
    Resize { cols: u16, rows: u16 },
    Bytes(Vec<u8>),
}

/// Classify an incoming message. JSON objects tagged `resize` are control; every
/// other payload is treated as raw keystrokes.
pub fn parse_client_msg(data: &[u8]) -> ClientMsg {
    if let Ok(text) = std::str::from_utf8(data) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
            if v.get("type").and_then(|t| t.as_str()) == Some("resize") {
                let cols = v.get("cols").and_then(|c| c.as_u64()).unwrap_or(80) as u16;
                let rows = v.get("rows").and_then(|r| r.as_u64()).unwrap_or(24) as u16;
                return ClientMsg::Resize { cols, rows };
            }
        }
    }
    ClientMsg::Bytes(data.to_vec())
}

/// Handle to a running PTY: the master's writer + resize live here so the WebRTC
/// layer can push keystrokes and resizes. Output is delivered on `output`.
pub struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    pub output: tokio::sync::broadcast::Sender<Vec<u8>>,
}

impl PtySession {
    /// Spawn `$SHELL` (fallback bash, then sh) in a PTY of the given size and
    /// start a blocking reader thread that broadcasts output bytes.
    pub fn spawn(cols: u16, rows: u16) -> Result<Self> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if std::path::Path::new("/bin/bash").exists() { "/bin/bash".into() } else { "/bin/sh".into() }
        });
        let cmd = CommandBuilder::new(shell);
        let _child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave); // close our copy so the shell owns the slave

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let (output, _) = tokio::sync::broadcast::channel::<Vec<u8>>(256);
        let out_tx = output.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break, // EOF or error -> shell gone
                    Ok(n) => {
                        if out_tx.send(buf[..n].to_vec()).is_err() {
                            // no subscribers right now; keep reading so the shell
                            // doesn't block on a full pipe
                            continue;
                        }
                    }
                }
            }
        });

        Ok(Self { writer, master: pair.master, output })
    }

    pub fn write_input(&mut self, bytes: &[u8]) {
        let _ = self.writer.write_all(bytes);
        let _ = self.writer.flush();
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = self.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classifies_resize_and_keystrokes() {
        assert_eq!(
            parse_client_msg(br#"{"type":"resize","cols":120,"rows":40}"#),
            ClientMsg::Resize { cols: 120, rows: 40 }
        );
        assert_eq!(parse_client_msg(b"ls -la\r"), ClientMsg::Bytes(b"ls -la\r".to_vec()));
        assert_eq!(parse_client_msg(br#"{"x":1}"#), ClientMsg::Bytes(br#"{"x":1}"#.to_vec()));
    }
}
