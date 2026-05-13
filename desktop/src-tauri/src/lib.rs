use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

#[derive(Default, Clone)]
pub struct AgentState {
    pub running: bool,
    pub peer_id: String,
    pub password: String,
}

type SharedAgentState = Arc<Mutex<AgentState>>;

#[derive(serde::Serialize, Clone)]
pub struct AgentStatusResponse {
    running: bool,
    peer_id: String,
    password: String,
}

#[tauri::command]
async fn get_agent_status(
    state: State<'_, SharedAgentState>,
) -> Result<AgentStatusResponse, String> {
    let s = state.lock().await;
    Ok(AgentStatusResponse {
        running: s.running,
        peer_id: s.peer_id.clone(),
        password: s.password.clone(),
    })
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn start_agent(
    password: String,
    signaling_url: String,
    state: State<'_, SharedAgentState>,
) -> Result<AgentStatusResponse, String> {
    {
        let s = state.lock().await;
        if s.running {
            return Err("Agent is already running".into());
        }
    }

    let cfg = peerdesk_agent::Config::load_or_create(&password)
        .map_err(|e| e.to_string())?;

    let peer_id = cfg.peer_id.clone();

    {
        let mut s = state.lock().await;
        s.running = true;
        s.peer_id = peer_id.clone();
        s.password = password.clone();
    }

    let agent_cfg = peerdesk_agent::AgentConfig {
        password,
        signaling_url,
        api_url: std::env::var("API_URL").ok(),
        api_token: std::env::var("API_TOKEN").ok().filter(|t| !t.is_empty()),
        display_index: 0,
    };

    let state_arc = Arc::clone(state.inner());
    tokio::spawn(async move {
        if let Err(e) = peerdesk_agent::run_agent(agent_cfg).await {
            tracing::error!("Agent stopped with error: {}", e);
        }
        let mut s = state_arc.lock().await;
        s.running = false;
        tracing::info!("Agent stopped");
    });

    Ok(AgentStatusResponse {
        running: true,
        peer_id,
        password: String::new(),
    })
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn start_agent(
    _password: String,
    _signaling_url: String,
    _state: State<'_, SharedAgentState>,
) -> Result<AgentStatusResponse, String> {
    Err("Host mode is not supported on Android (viewer only)".into())
}

#[tauri::command]
async fn stop_agent(state: State<'_, SharedAgentState>) -> Result<(), String> {
    let mut s = state.lock().await;
    s.running = false;
    // The agent task will exit on next signaling disconnect
    // A proper stop channel can be added later
    Ok(())
}

pub fn run() {
    let shared_state: SharedAgentState = Arc::new(Mutex::new(AgentState::default()));

    tauri::Builder::default()
        .manage(shared_state)
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_agent_status,
            start_agent,
            stop_agent,
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
