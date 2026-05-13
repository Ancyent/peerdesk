use anyhow::Result;
use tracing_appender::non_blocking::WorkerGuard;

/// Path to agent log file.
/// Linux: /var/log/peerdesk-agent.log if /var/log is writable, else ~/.local/share/peerdesk/agent.log
/// Windows: %APPDATA%\peerdesk\agent.log
pub fn log_file_path() -> std::path::PathBuf {
    #[cfg(unix)]
    {
        let system_log = std::path::Path::new("/var/log/peerdesk-agent.log");
        if system_log.parent().map(|p| p.exists()).unwrap_or(false) {
            return system_log.to_path_buf();
        }
    }
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("peerdesk")
        .join("agent.log")
}

/// Initialize logging to stdout (default mode).
pub fn init_stdout() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();
}

/// Initialize logging to file (silent mode).
/// Returns a WorkerGuard — must stay alive for the duration of the process to flush logs.
pub fn init_file() -> Result<WorkerGuard> {
    let path = log_file_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let dir = path.parent().unwrap();
    let filename = path.file_name().unwrap().to_str().unwrap();

    let file_appender = tracing_appender::rolling::never(dir, filename);
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::fmt()
        .with_writer(non_blocking)
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    Ok(guard)
}
