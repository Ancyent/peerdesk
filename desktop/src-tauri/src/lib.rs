mod update_state;

use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tokio::sync::Mutex;

#[cfg(not(target_os = "android"))]
use peerdesk_agent::{
    config::{generate_simple_password, AccessMode, AppSettings, Config},
    run_agent, AgentConfig, ApprovalRequest,
};

/// An incoming connection awaiting the host's decision, held server-side until
/// the UI polls for it and responds.
pub struct PendingApproval {
    pub remote_ip: String,
    pub reply: tokio::sync::oneshot::Sender<bool>,
}

#[derive(Default)]
pub struct AgentState {
    pub running: bool,
    pub peer_id: String,
    pub security_code: Option<String>,
    /// Handle to abort the spawned run_agent task on stop.
    pub task: Option<tokio::task::AbortHandle>,
    /// Incoming connections awaiting a host accept/reject, keyed by viewer_id.
    pub pending_approvals: HashMap<String, PendingApproval>,
    /// Order in which approvals arrived (FIFO for the UI to show).
    pub pending_order: Vec<String>,
}

/// Plaintext access password, stored 0600 next to config.json so the host can
/// display its own password. (config.json only keeps the bcrypt hash.)
#[cfg(not(target_os = "android"))]
fn password_file_path() -> std::path::PathBuf {
    Config::config_path(false)
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("password.txt")
}

#[cfg(not(target_os = "android"))]
fn read_visible_password() -> Option<String> {
    std::fs::read_to_string(password_file_path())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(not(target_os = "android"))]
fn write_visible_password(pw: &str) {
    let path = password_file_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
        {
            let _ = f.write_all(pw.as_bytes());
        }
    }
    #[cfg(not(unix))]
    {
        let _ = std::fs::write(&path, pw);
    }
}

type SharedAgentState = Arc<Mutex<AgentState>>;

// ── activity log ──────────────────────────────────────────────────────────────
// Capture the agent's tracing output into an in-memory ring buffer so the UI
// can show what's happening (connecting, registered, errors, reconnects).

static LOG_BUFFER: std::sync::Mutex<std::collections::VecDeque<String>> =
    std::sync::Mutex::new(std::collections::VecDeque::new());

struct LogWriter;
impl std::io::Write for LogWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if let Ok(s) = std::str::from_utf8(buf) {
            if let Ok(mut q) = LOG_BUFFER.lock() {
                for line in s.lines() {
                    let line = line.trim();
                    if !line.is_empty() {
                        q.push_back(line.to_string());
                        while q.len() > 300 {
                            q.pop_front();
                        }
                    }
                }
            }
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

struct MakeLogWriter;
impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for MakeLogWriter {
    type Writer = LogWriter;
    fn make_writer(&'a self) -> Self::Writer {
        LogWriter
    }
}

fn init_logging() {
    use tracing_subscriber::fmt;
    let _ = fmt()
        .with_writer(MakeLogWriter)
        .with_ansi(false)
        .with_target(false)
        .try_init();
}

/// ICE servers (STUN + TURN relay) for the desktop viewer, fetched from the
/// server using the agent's API key. Without the TURN relay, a viewer on a
/// different network than the host connects but sees a black screen.
#[derive(serde::Serialize)]
struct IceServer {
    urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential: Option<String>,
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn get_turn_credentials() -> Result<Vec<IceServer>, String> {
    let cfg = Config::load(&Config::config_path(false)).map_err(|e| e.to_string())?;
    let api_url = cfg.api_url().ok_or_else(|| "no server configured".to_string())?;
    let api_key = cfg
        .api_key
        .clone()
        .ok_or_else(|| "no API key configured".to_string())?;
    let t = peerdesk_agent::api_client::fetch_turn_credentials(&api_url, &api_key)
        .await
        .map_err(|e| e.to_string())?;
    let stun: Vec<String> = t.urls.iter().filter(|u| u.starts_with("stun:")).cloned().collect();
    let turn: Vec<String> = t.urls.iter().filter(|u| u.starts_with("turn:")).cloned().collect();
    let mut servers = Vec::new();
    if !stun.is_empty() {
        servers.push(IceServer { urls: stun, username: None, credential: None });
    }
    if !turn.is_empty() {
        servers.push(IceServer {
            urls: turn,
            username: Some(t.username),
            credential: Some(t.credential),
        });
    }
    Ok(servers)
}

/// Android builds don't link the agent crate (no host capability), so there's no
/// Config/API key to fetch TURN with — the viewer falls back to public STUN
/// (empty list → STUN-only in the frontend).
#[cfg(target_os = "android")]
#[tauri::command]
async fn get_turn_credentials() -> Result<Vec<IceServer>, String> {
    Ok(Vec::new())
}

#[tauri::command]
fn get_agent_log() -> Vec<String> {
    LOG_BUFFER
        .lock()
        .map(|q| q.iter().cloned().collect())
        .unwrap_or_default()
}

// ── get_agent_status ──────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct AgentStatusResponse {
    running: bool,
    peer_id: String,
    approval_status: String,
    server_url: Option<String>,
    access_mode: String,
    /// Plaintext access password if known (null for legacy configs — reset to set one).
    password: Option<String>,
}

#[tauri::command]
async fn get_agent_status(
    state: State<'_, SharedAgentState>,
) -> Result<AgentStatusResponse, String> {
    let s = state.lock().await;

    #[cfg(not(target_os = "android"))]
    {
        let cfg = Config::load(&Config::config_path(false)).ok();
        let settings = AppSettings::load(&AppSettings::settings_path(false)).unwrap_or_default();

        let approval_status = if cfg.as_ref().and_then(|c| c.api_key.as_deref()).is_some() {
            "approved".to_string()
        } else {
            "standalone".to_string()
        };

        let access_mode = match settings.access_mode {
            AccessMode::Full => "full",
            AccessMode::ViewOnly => "view_only",
            AccessMode::NoIncoming => "no_incoming",
        }
        .to_string();

        Ok(AgentStatusResponse {
            running: s.running,
            peer_id: cfg.as_ref().map(|c| c.peer_id.clone()).unwrap_or_default(),
            approval_status,
            server_url: cfg.and_then(|c| c.server_url),
            access_mode,
            password: read_visible_password(),
        })
    }

    #[cfg(target_os = "android")]
    Ok(AgentStatusResponse {
        running: s.running,
        peer_id: s.peer_id.clone(),
        approval_status: "standalone".to_string(),
        server_url: None,
        access_mode: "full".to_string(),
        password: None,
    })
}

// ── start_agent ───────────────────────────────────────────────────────────────

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn start_agent(
    app: tauri::AppHandle,
    state: State<'_, SharedAgentState>,
) -> Result<AgentStatusResponse, String> {
    {
        let mut s = state.lock().await;
        if s.running {
            return Err("Agent is already running".into());
        }
        s.running = true; // reserve the slot atomically
    }

    let settings = AppSettings::load(&AppSettings::settings_path(false)).unwrap_or_default();
    let config_path = Config::config_path(false);

    let was_new = !config_path.exists();
    let generated = generate_simple_password();
    let cfg = Config::load_or_create(
        &config_path,
        &generated,
        std::env::var("PEERDESK_SERVER").ok().as_deref(),
        std::env::var("API_KEY")
            .ok()
            .filter(|t| !t.is_empty())
            .as_deref(),
    )
    .map_err(|e| e.to_string())?;
    if was_new {
        // Brand-new config: the generated plaintext is the access password.
        write_visible_password(&generated);
    }

    let peer_id = cfg.peer_id.clone();
    let server_url = cfg.server_url.clone();
    {
        let mut s = state.lock().await;
        s.peer_id = peer_id.clone();
    }

    // Attended-approval bridge: agent → UI dialog → agent.
    let (approval_tx, mut approval_rx) = tokio::sync::mpsc::channel::<ApprovalRequest>(8);
    {
        let app = app.clone();
        let bridge_state = Arc::clone(state.inner());
        tokio::spawn(async move {
            while let Some(req) = approval_rx.recv().await {
                let ApprovalRequest {
                    viewer_id,
                    remote_ip,
                    reply,
                } = req;
                {
                    let mut s = bridge_state.lock().await;
                    s.pending_order.push(viewer_id.clone());
                    s.pending_approvals.insert(
                        viewer_id.clone(),
                        PendingApproval { remote_ip: remote_ip.clone(), reply },
                    );
                }
                // Emit as a fast path; the UI also polls get_pending_approval so
                // it works even if the event doesn't reach the webview.
                let _ = app.emit(
                    "approval-request",
                    serde_json::json!({ "viewer_id": viewer_id, "remote_ip": remote_ip }),
                );
            }
        });
    }

    let had_key = cfg.api_key.is_some();
    let cast_only = settings.access_mode == AccessMode::ViewOnly;
    let agent_cfg = AgentConfig {
        password: String::new(),
        server_url: cfg.server_url,
        api_key: cfg.api_key,
        display_index: 0,
        portable: false,
        cast_only,
        approval_tx: Some(approval_tx),
        show_remote_cursor: settings.show_remote_cursor,
    };

    let state_arc = Arc::clone(state.inner());
    let handle = tokio::spawn(async move {
        if let Err(e) = run_agent(agent_cfg).await {
            tracing::error!("Agent stopped: {}", e);
        }
        let mut s = state_arc.lock().await;
        s.running = false;
        s.task = None;
    });
    {
        let mut s = state.lock().await;
        s.task = Some(handle.abort_handle());
    }

    let access_mode = match settings.access_mode {
        AccessMode::Full => "full",
        AccessMode::ViewOnly => "view_only",
        AccessMode::NoIncoming => "no_incoming",
    }
    .to_string();

    Ok(AgentStatusResponse {
        running: true,
        peer_id,
        approval_status: if had_key { "approved" } else { "standalone" }.to_string(),
        server_url,
        access_mode,
        password: read_visible_password(),
    })
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn start_agent(_state: State<'_, SharedAgentState>) -> Result<AgentStatusResponse, String> {
    Err("Host mode is not supported on Android (viewer only)".into())
}

// ── stop_agent ────────────────────────────────────────────────────────────────

#[tauri::command]
async fn stop_agent(state: State<'_, SharedAgentState>) -> Result<(), String> {
    let mut s = state.lock().await;
    if let Some(handle) = s.task.take() {
        handle.abort();
    }
    s.running = false;
    Ok(())
}

// ── get_settings ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_settings() -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "android"))]
    {
        let s = AppSettings::load(&AppSettings::settings_path(false)).unwrap_or_default();
        serde_json::to_value(&s).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "android")]
    Ok(serde_json::json!({}))
}

// ── save_settings ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn save_settings(settings: serde_json::Value) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        let s: AppSettings = serde_json::from_value(settings).map_err(|e| e.to_string())?;
        s.save(&AppSettings::settings_path(false))
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "android")]
    {
        let _ = settings;
        Ok(())
    }
}

// ── update_state ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_update_state() -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "android"))]
    {
        let st = update_state::UpdateState::load(&update_state::state_path());
        serde_json::to_value(&st).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "android")]
    Ok(serde_json::json!({}))
}

#[tauri::command]
async fn save_update_state(state: serde_json::Value) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        let st: update_state::UpdateState =
            serde_json::from_value(state).map_err(|e| e.to_string())?;
        st.save(&update_state::state_path()).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "android")]
    {
        let _ = state;
        Ok(())
    }
}

// ── apply_config_link ─────────────────────────────────────────────────────────

#[tauri::command]
async fn apply_config_link(
    state: State<'_, SharedAgentState>,
    url: String,
) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        let stripped = url
            .strip_prefix("peerdesk://setup?")
            .ok_or_else(|| "Invalid config link — must start with peerdesk://setup?".to_string())?;

        let mut server: Option<String> = None;
        let mut api_key: Option<String> = None;
        let mut password: Option<String> = None;

        for pair in stripped.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                let decoded = v
                    .replace("%3A", ":")
                    .replace("%2F", "/")
                    .replace("%40", "@")
                    .replace("%3D", "=");
                match k {
                    "server" => server = Some(decoded),
                    "api_key" | "api_token" => api_key = Some(decoded),
                    "password" => password = Some(decoded),
                    _ => {}
                }
            }
        }

        let config_path = Config::config_path(false);
        // Empty password leaves an existing config's hash/hmac untouched.
        let pw = password.as_deref().unwrap_or("");
        Config::load_or_create(&config_path, pw, server.as_deref(), api_key.as_deref())
            .map_err(|e| e.to_string())?;

        // Stop the agent so the UI can restart it with the new server/key,
        // making "Apply & Reconnect" actually reconnect and register.
        {
            let mut s = state.lock().await;
            if let Some(h) = s.task.take() {
                h.abort();
            }
            s.running = false;
        }
        Ok(())
    }
    #[cfg(target_os = "android")]
    {
        let _ = (&state, url);
        Ok(())
    }
}

// ── reset_password ────────────────────────────────────────────────────────────

#[tauri::command]
async fn reset_password(state: State<'_, SharedAgentState>) -> Result<String, String> {
    #[cfg(not(target_os = "android"))]
    {
        let new_pw = generate_simple_password();
        let config_path = Config::config_path(false);
        let cfg = Config::load(&config_path).map_err(|e| e.to_string())?;
        let hash = bcrypt::hash(&new_pw, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
        Config {
            peer_id: cfg.peer_id,
            password_hash: hash,
            server_url: cfg.server_url,
            api_key: cfg.api_key,
            // Carry any unredeemed token across a password reset — dropping it
            // would silently cancel this machine's pending enrollment.
            pending_token: cfg.pending_token,
            hmac_key: Some(peerdesk_agent::config::derive_hmac_key(&new_pw)),
        }
        .save(&config_path)
        .map_err(|e| e.to_string())?;
        write_visible_password(&new_pw);

        // The signaling server holds the hmac_key the agent registered with at
        // startup. Stop the agent so it disconnects (server drops the stale
        // key); the UI restarts it, re-registering with the new password.
        {
            let mut s = state.lock().await;
            if let Some(h) = s.task.take() {
                h.abort();
            }
            s.running = false;
        }
        Ok(new_pw)
    }
    #[cfg(target_os = "android")]
    {
        let _ = &state;
        Err("Not supported on Android".into())
    }
}

// ── approval polling ──────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct PendingApprovalOut {
    viewer_id: String,
    remote_ip: String,
}

/// The UI polls this for the oldest pending connection request. Returning it via
/// a command (rather than relying only on an event) makes the prompt reliable.
#[tauri::command]
async fn get_pending_approval(
    state: State<'_, SharedAgentState>,
) -> Result<Option<PendingApprovalOut>, String> {
    let s = state.lock().await;
    for viewer_id in &s.pending_order {
        if let Some(p) = s.pending_approvals.get(viewer_id) {
            return Ok(Some(PendingApprovalOut {
                viewer_id: viewer_id.clone(),
                remote_ip: p.remote_ip.clone(),
            }));
        }
    }
    Ok(None)
}

/// Called by the UI when the host accepts/rejects an incoming connection.
#[tauri::command]
async fn respond_approval(
    state: State<'_, SharedAgentState>,
    viewer_id: String,
    approved: bool,
) -> Result<(), String> {
    let mut s = state.lock().await;
    s.pending_order.retain(|v| v != &viewer_id);
    if let Some(p) = s.pending_approvals.remove(&viewer_id) {
        let _ = p.reply.send(approved);
    }
    Ok(())
}

// ── get_security_code ─────────────────────────────────────────────────────────

#[tauri::command]
async fn get_security_code(
    state: State<'_, SharedAgentState>,
) -> Result<Option<String>, String> {
    let guard = state.lock().await;
    Ok(guard.security_code.clone())
}

// ── check_for_update / download_and_install_update ─────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
struct UpdateInfo {
    version: String,
    current_version: String,
    notes: String,
    pub_date: String,
}

/// Build the Tauri updater endpoint from the client's configured server URL,
/// so a client bound to server X updates from X. None if no server configured.
#[cfg(not(target_os = "android"))]
fn updater_endpoint() -> Option<String> {
    let cfg = Config::load(&Config::config_path(false)).ok()?;
    let api = cfg.api_url()?; // "<server>/api"
    // Doubled braces so format! emits Tauri's literal {{target}} placeholders.
    Some(format!(
        "{api}/releases/update/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}"
    ))
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_updater::UpdaterExt;
        let endpoint = updater_endpoint().ok_or("No server configured")?;
        let url = endpoint.parse().map_err(|_| "Invalid updater endpoint".to_string())?;
        let updater = app
            .updater_builder()
            .endpoints(vec![url])
            .map_err(|e| e.to_string())?
            .build()
            .map_err(|e| e.to_string())?;
        match updater.check().await {
            Ok(Some(u)) => Ok(Some(UpdateInfo {
                version: u.version.clone(),
                current_version: u.current_version.clone(),
                notes: u.body.clone().unwrap_or_default(),
                pub_date: u.date.map(|d| d.to_string()).unwrap_or_default(),
            })),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Err("in-app update is not available on Android".into())
    }
}

#[tauri::command]
async fn download_and_install_update(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_updater::UpdaterExt;
        let endpoint = updater_endpoint().ok_or("No server configured")?;
        let url = endpoint.parse().map_err(|_| "Invalid updater endpoint".to_string())?;
        let updater = app
            .updater_builder()
            .endpoints(vec![url])
            .map_err(|e| e.to_string())?
            .build()
            .map_err(|e| e.to_string())?;
        let update = updater
            .check()
            .await
            .map_err(|e| e.to_string())?
            .ok_or("No update available")?;

        let mut downloaded: u64 = 0;
        let app_for_progress = app.clone();
        let app_for_finish = app.clone();
        update
            .download_and_install(
                move |chunk, total| {
                    downloaded += chunk as u64;
                    let _ = app_for_progress.emit(
                        "update://progress",
                        serde_json::json!({ "downloaded": downloaded, "total": total }),
                    );
                },
                move || {
                    let _ = app_for_finish.emit("update://finished", ());
                },
            )
            .await
            .map_err(|e| e.to_string())?;

        app.restart();
    }
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Err("in-app update is not available on Android".into())
    }
}

// ── Tauri app ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();
    let shared_state: SharedAgentState = Arc::new(Mutex::new(AgentState::default()));

    let mut builder = tauri::Builder::default()
        .manage(shared_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            get_agent_status,
            start_agent,
            stop_agent,
            get_settings,
            save_settings,
            get_update_state,
            save_update_state,
            apply_config_link,
            reset_password,
            get_security_code,
            respond_approval,
            get_pending_approval,
            get_agent_log,
            get_turn_credentials,
            check_for_update,
            download_and_install_update,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                // Not a literal: this label is on screen at all times, and a
                // branded build that says "Show PeerDesk" in the tray of an
                // app called something else is the one place branding is
                // permanently visible. package_info().name is the productName
                // tauri-build compiled in, so it already carries the brand.
                let show_label = format!("Show {}", app.package_info().name);
                let show_item =
                    MenuItem::with_id(app, "show", &show_label, true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
                let _tray = TrayIconBuilder::new()
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PeerDesk");
}
