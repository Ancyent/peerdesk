//! Runs the user's shell in a PTY and bridges it to a byte stream for the viewer.

use anyhow::Result;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};

/// Appended to the viewer's stream when the shell ends, so a finished session
/// reads as finished instead of frozen. The viewer renders these bytes verbatim.
pub const SESSION_ENDED_NOTICE: &str =
    "\r\n\x1b[33m[sesiunea s-a încheiat — reconectează-te pentru un shell nou]\x1b[0m\r\n";

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
                let cols = v
                    .get("cols")
                    .and_then(|c| c.as_u64())
                    .unwrap_or(80)
                    .min(u16::MAX as u64) as u16;
                let rows = v
                    .get("rows")
                    .and_then(|r| r.as_u64())
                    .unwrap_or(24)
                    .min(u16::MAX as u64) as u16;
                return ClientMsg::Resize { cols, rows };
            }
        }
    }
    ClientMsg::Bytes(data.to_vec())
}

/// Handle to a running PTY: the master's writer + resize live here so the WebRTC
/// layer can push keystrokes and resizes. Output is delivered on `output`.
pub struct PtySession {
    _child: Box<dyn portable_pty::Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    pub output: tokio::sync::broadcast::Sender<Vec<u8>>,
    exited: tokio::sync::watch::Receiver<bool>,
}

impl PtySession {
    /// Spawn `$SHELL` (fallback bash, then sh) in a PTY of the given size and
    /// start a blocking reader thread that broadcasts output bytes.
    pub fn spawn(cols: u16, rows: u16) -> Result<Self> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if std::path::Path::new("/bin/bash").exists() {
                "/bin/bash".into()
            } else {
                "/bin/sh".into()
            }
        });
        let cmd = CommandBuilder::new(shell);
        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave); // close our copy so the shell owns the slave

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let (output, _) = tokio::sync::broadcast::channel::<Vec<u8>>(256);
        let out_tx = output.clone();
        let (exit_tx, exited) = tokio::sync::watch::channel(false);
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
            // The shell is gone. Tell the viewer first — it renders this stream,
            // so without a notice the terminal just stops responding — then flag
            // the session so the connection layer can tear it down instead of
            // silently swallowing every later keystroke.
            let _ = out_tx.send(SESSION_ENDED_NOTICE.as_bytes().to_vec());
            let _ = exit_tx.send(true);
        });

        Ok(Self {
            _child: child,
            writer,
            master: pair.master,
            output,
            exited,
        })
    }

    /// Watches whether the shell has exited. Becomes `true` once and stays there;
    /// a session is never reusable after that.
    pub fn exited(&self) -> tokio::sync::watch::Receiver<bool> {
        self.exited.clone()
    }

    pub fn write_input(&mut self, bytes: &[u8]) {
        let _ = self.writer.write_all(bytes);
        let _ = self.writer.flush();
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
}

/// One viewer connection's shell: the channels the WebRTC layer talks to, plus a
/// watch that fires when the shell ends.
///
/// Dropping every clone of `input` ends the pump thread, which drops the
/// `PtySession` and takes the shell down with it — so a bridge dies with the
/// connection that owns it.
pub struct TerminalBridge {
    pub output: tokio::sync::broadcast::Sender<Vec<u8>>,
    pub input: tokio::sync::mpsc::Sender<ClientMsg>,
    pub exited: tokio::sync::watch::Receiver<bool>,
}

/// Start a shell for a single connection.
///
/// Deliberately per-connection: a process-wide PTY meant one `exit` left every
/// later viewer staring at a dead terminal, with keystrokes silently discarded.
pub fn start_bridge(cols: u16, rows: u16) -> Result<TerminalBridge> {
    let mut pty = PtySession::spawn(cols, rows)?;
    let output = pty.output.clone();
    let exited = pty.exited();
    let (input, mut input_rx) = tokio::sync::mpsc::channel::<ClientMsg>(256);

    std::thread::spawn(move || {
        while let Some(msg) = input_rx.blocking_recv() {
            match msg {
                ClientMsg::Bytes(b) => pty.write_input(&b),
                ClientMsg::Resize { cols, rows } => pty.resize(cols, rows),
            }
        }
        // Every sender is gone: the connection ended. Dropping `pty` closes the
        // master, which hangs up the shell.
        drop(pty);
    });

    Ok(TerminalBridge {
        output,
        input,
        exited,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classifies_resize_and_keystrokes() {
        assert_eq!(
            parse_client_msg(br#"{"type":"resize","cols":120,"rows":40}"#),
            ClientMsg::Resize {
                cols: 120,
                rows: 40
            }
        );
        assert_eq!(
            parse_client_msg(b"ls -la\r"),
            ClientMsg::Bytes(b"ls -la\r".to_vec())
        );
        assert_eq!(
            parse_client_msg(br#"{"x":1}"#),
            ClientMsg::Bytes(br#"{"x":1}"#.to_vec())
        );
    }

    /// Typing `exit` ends the shell. The session must say so, otherwise the
    /// connection layer keeps feeding keystrokes into a dead PTY and the viewer
    /// sees a terminal that silently ignores every key.
    #[test]
    fn reports_when_the_shell_exits() {
        let mut session = PtySession::spawn(80, 24).expect("spawn a shell");
        let exited = session.exited();
        assert!(!*exited.borrow(), "a fresh session must not report exited");

        session.write_input(b"exit\n");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline && !*exited.borrow() {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(
            *exited.borrow(),
            "session must report the shell exited after `exit`"
        );
    }

    /// The viewer renders this byte stream directly. When the shell ends, the
    /// last thing on it must say so — otherwise the terminal just stops
    /// responding and looks broken.
    #[test]
    fn last_bytes_tell_the_viewer_the_session_ended() {
        let mut session = PtySession::spawn(80, 24).expect("spawn a shell");
        let mut out = session.output.subscribe();
        let exited = session.exited();

        session.write_input(b"exit\n");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut seen = Vec::new();
        while std::time::Instant::now() < deadline {
            match out.try_recv() {
                Ok(chunk) => seen.extend_from_slice(&chunk),
                Err(_) if *exited.borrow() => break,
                Err(_) => std::thread::sleep(std::time::Duration::from_millis(25)),
            }
        }

        let text = String::from_utf8_lossy(&seen);
        assert!(
            text.contains(SESSION_ENDED_NOTICE.trim()),
            "viewer must be told the session ended; got: {text:?}"
        );
    }

    /// Each viewer connection gets its own shell, so a bridge must be startable
    /// again after a previous one ended. Before this, the PTY was tied to the
    /// agent process: one `exit` left every later connection with a dead shell.
    #[test]
    fn a_new_bridge_starts_after_the_previous_one_exited() {
        let first = start_bridge(80, 24).expect("start first bridge");
        first
            .input
            .try_send(ClientMsg::Bytes(b"exit\n".to_vec()))
            .expect("send exit");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline && !*first.exited.borrow() {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(*first.exited.borrow(), "first bridge must report it ended");

        let second = start_bridge(80, 24).expect("start a second bridge");
        assert!(
            !*second.exited.borrow(),
            "a freshly started bridge must have a live shell"
        );
    }
}
