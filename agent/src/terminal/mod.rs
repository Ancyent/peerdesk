//! Runs the user's shell in a PTY and bridges it to a byte stream for the viewer.

use anyhow::Result;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};

/// Appended to the viewer's stream when the shell ends, so a finished session
/// reads as finished instead of frozen. The viewer renders these bytes verbatim.
pub const SESSION_ENDED_NOTICE: &str =
    "\r\n\x1b[33m[session ended — reconnect for a new shell]\x1b[0m\r\n";

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

/// Shells whose first argument accepts `-l` (login shell). This is deliberately
/// an allowlist, unlike some security checks elsewhere in this repo where an
/// unlisted case must be rejected: here the unlisted direction is "spawn
/// without `-l`", which still works, just with a poorer (agent-inherited)
/// environment instead of the machine's configured one. An unrecognized shell
/// that does NOT support `-l` would otherwise print an error and exit
/// immediately, leaving the user with a terminal that opens and instantly
/// dies — worse than the degraded-but-working fallback, so the safe default
/// here is "no flag" rather than "reject".
const LOGIN_CAPABLE_SHELLS: &[&str] = &["bash", "sh", "dash", "zsh", "fish", "ksh", "tcsh", "csh"];

/// Build the command used to spawn the user's shell: `$SHELL` (fallback bash,
/// then sh), as a login shell when we can affirm it supports `-l`, with
/// `TERM`/`LANG`/`PATH` set as defaults.
///
/// The agent runs as a systemd service (see `service.rs`), which has no
/// controlling terminal and therefore no `TERM`, `LANG`, or a real `PATH` —
/// unlike an SSH session. `-l` makes the shell source `/etc/profile` and the
/// user's own profile, which is how it picks up whatever the administrator
/// actually configured on that machine; we can't know that in advance, so
/// that beats hardcoding values. `CommandBuilder` sets these three env vars
/// on the process *before* the shell runs, so if the login shell's profile
/// scripts also set them, the profile's values win — ours are only a floor
/// for a machine that configures nothing.
fn shell_command() -> CommandBuilder {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if std::path::Path::new("/bin/bash").exists() {
            "/bin/bash".into()
        } else {
            "/bin/sh".into()
        }
    });

    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    let mut cmd = CommandBuilder::new(&shell);
    if LOGIN_CAPABLE_SHELLS.contains(&shell_name) {
        cmd.arg("-l");
    }

    // TERM: the viewer renders with @xterm/xterm (web/src/components/TerminalView.tsx),
    // which implements the xterm-256color terminfo, so that's the value that
    // matches what the client actually understands.
    cmd.env("TERM", "xterm-256color");
    cmd.env("LANG", "C.UTF-8");
    cmd.env(
        "PATH",
        "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );

    cmd
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
        let cmd = shell_command();
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
    use std::sync::Mutex;

    // Tests that read/set $SHELL must not run concurrently — std::env is
    // process-global, so a parallel test could see another test's value.
    static SHELL_ENV_LOCK: Mutex<()> = Mutex::new(());

    /// The remote terminal is unusable without `TERM`: `clear`, `top`, `vim`
    /// and everything else that reads terminfo either errors out or
    /// degrades. The viewer's @xterm/xterm implements xterm-256color, so
    /// that's the value that must be set as a default on the spawned command.
    #[test]
    fn shell_command_sets_term_for_the_viewer() {
        let _guard = SHELL_ENV_LOCK.lock().unwrap();
        let cmd = shell_command();
        assert_eq!(cmd.get_env("TERM"), Some(std::ffi::OsStr::new("xterm-256color")));
    }

    /// LANG and PATH are floors for a systemd service environment that has
    /// almost nothing; a login shell's profile overrides them where the
    /// machine configures its own.
    #[test]
    fn shell_command_sets_lang_and_path_defaults() {
        let _guard = SHELL_ENV_LOCK.lock().unwrap();
        let cmd = shell_command();
        assert!(cmd.get_env("LANG").is_some());
        let path = cmd
            .get_env("PATH")
            .expect("PATH must have a default")
            .to_str()
            .expect("PATH must be valid utf8");
        assert!(
            path.contains("/usr/bin"),
            "PATH default must contain /usr/bin, got {path:?}"
        );
    }

    /// bash accepts `-l`, so a login shell must be requested: that's what
    /// sources /etc/profile and the user's profile, picking up PATH, LANG
    /// etc. the way an SSH session would.
    #[test]
    fn shell_command_passes_login_flag_for_bash() {
        let _guard = SHELL_ENV_LOCK.lock().unwrap();
        std::env::set_var("SHELL", "/bin/bash");
        let cmd = shell_command();
        std::env::remove_var("SHELL");
        assert_eq!(&cmd.get_argv()[1..], &["-l"]);
    }

    /// zsh also accepts `-l`.
    #[test]
    fn shell_command_passes_login_flag_for_zsh() {
        let _guard = SHELL_ENV_LOCK.lock().unwrap();
        std::env::set_var("SHELL", "/bin/zsh");
        let cmd = shell_command();
        std::env::remove_var("SHELL");
        assert_eq!(&cmd.get_argv()[1..], &["-l"]);
    }

    /// An unrecognized shell must get no arguments at all. Passing `-l` to a
    /// shell that doesn't understand it prints an error and exits
    /// immediately — a terminal that opens and instantly dies, worse than
    /// the degraded-but-working fallback of no flag.
    #[test]
    fn shell_command_passes_no_args_for_an_unknown_shell() {
        let _guard = SHELL_ENV_LOCK.lock().unwrap();
        std::env::set_var("SHELL", "/opt/weird/myshell");
        let cmd = shell_command();
        std::env::remove_var("SHELL");
        assert_eq!(cmd.get_argv().len(), 1, "expected no args beyond argv[0]");
    }

    /// With $SHELL unset, the existing bash-then-sh fallback must still
    /// produce a runnable command (bash is present in the test environment).
    #[test]
    fn shell_command_falls_back_when_shell_is_unset() {
        let _guard = SHELL_ENV_LOCK.lock().unwrap();
        std::env::remove_var("SHELL");
        let cmd = shell_command();
        let program = cmd.get_argv()[0]
            .to_str()
            .expect("program must be valid utf8");
        assert!(
            program == "/bin/bash" || program == "/bin/sh",
            "expected bash-then-sh fallback, got {program:?}"
        );
    }

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
