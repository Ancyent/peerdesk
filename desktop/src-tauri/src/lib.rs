use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};
use tokio::sync::Mutex;

#[cfg(not(target_os = "android"))]
use peerdesk_agent::{
    config::{AccessMode, AppSettings, Config},
    run_agent, AgentConfig,
};

#[derive(Default, Clone)]
pub struct AgentState {
    pub running: bool,
    pub peer_id: String,
    pub security_code: Option<String>,
}

type SharedAgentState = Arc<Mutex<AgentState>>;

// ── get_agent_status ──────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct AgentStatusResponse {
    running: bool,
    peer_id: String,
    approval_status: String,
    server_url: Option<String>,
    access_mode: String,
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
        })
    }

    #[cfg(target_os = "android")]
    Ok(AgentStatusResponse {
        running: s.running,
        peer_id: s.peer_id.clone(),
        approval_status: "standalone".to_string(),
        server_url: None,
        access_mode: "full".to_string(),
    })
}

// ── start_agent ───────────────────────────────────────────────────────────────

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn start_agent(state: State<'_, SharedAgentState>) -> Result<AgentStatusResponse, String> {
    {
        let mut s = state.lock().await;
        if s.running {
            return Err("Agent is already running".into());
        }
        s.running = true; // reserve the slot atomically
    }

    let settings = AppSettings::load(&AppSettings::settings_path(false)).unwrap_or_default();
    let config_path = Config::config_path(false);

    let cfg = {
        use rand::distributions::Alphanumeric;
        use rand::Rng;
        let generated: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(12)
            .map(char::from)
            .collect();
        Config::load_or_create(
            &config_path,
            &generated,
            std::env::var("PEERDESK_SERVER").ok().as_deref(),
            std::env::var("API_KEY")
                .ok()
                .filter(|t| !t.is_empty())
                .as_deref(),
        )
        .map_err(|e| e.to_string())?
    };

    let peer_id = cfg.peer_id.clone();
    let server_url = cfg.server_url.clone();
    {
        let mut s = state.lock().await;
        s.peer_id = peer_id.clone();
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
    };

    let state_arc = Arc::clone(state.inner());
    tokio::spawn(async move {
        if let Err(e) = run_agent(agent_cfg).await {
            tracing::error!("Agent stopped: {}", e);
        }
        let mut s = state_arc.lock().await;
        s.running = false;
    });

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

// ── apply_config_link ─────────────────────────────────────────────────────────

#[tauri::command]
async fn apply_config_link(url: String) -> Result<(), String> {
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
        let pw = password.as_deref().unwrap_or("changeme");
        Config::load_or_create(&config_path, pw, server.as_deref(), api_key.as_deref())
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "android")]
    {
        let _ = url;
        Ok(())
    }
}

// ── reset_password ────────────────────────────────────────────────────────────

#[tauri::command]
async fn reset_password() -> Result<String, String> {
    #[cfg(not(target_os = "android"))]
    {
        use rand::distributions::Alphanumeric;
        use rand::Rng;
        let new_pw: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(12)
            .map(char::from)
            .collect();
        let config_path = Config::config_path(false);
        let cfg = Config::load(&config_path).map_err(|e| e.to_string())?;
        let hash = bcrypt::hash(&new_pw, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
        Config {
            peer_id: cfg.peer_id,
            password_hash: hash,
            server_url: cfg.server_url,
            api_key: cfg.api_key,
            hmac_key: Some(peerdesk_agent::config::derive_hmac_key(&new_pw)),
        }
        .save(&config_path)
        .map_err(|e| e.to_string())?;
        Ok(new_pw)
    }
    #[cfg(target_os = "android")]
    Err("Not supported on Android".into())
}

// ── get_security_code ─────────────────────────────────────────────────────────

#[tauri::command]
async fn get_security_code(
    state: State<'_, SharedAgentState>,
) -> Result<Option<String>, String> {
    let guard = state.lock().await;
    Ok(guard.security_code.clone())
}

// ── Tauri app ─────────────────────────────────────────────────────────────────

pub fn run() {
    let shared_state: SharedAgentState = Arc::new(Mutex::new(AgentState::default()));

    tauri::Builder::default()
        .manage(shared_state)
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_agent_status,
            start_agent,
            stop_agent,
            get_settings,
            save_settings,
            apply_config_link,
            reset_password,
            get_security_code,
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Show PeerDesk", true, None::<&str>)?;
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PeerDesk");
}
