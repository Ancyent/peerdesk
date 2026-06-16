use clap::Parser;
use peerdesk_agent::{config::Config, logging, run_agent, service, AgentConfig};

#[derive(Parser, Debug)]
#[command(
    name = "peerdesk-agent",
    about = "PeerDesk remote access agent",
    version
)]
struct Cli {
    /// Base URL of the PeerDesk server (e.g. https://api.example.com).
    /// Signaling WebSocket and REST API are derived from this.
    #[arg(long, env = "PEERDESK_SERVER")]
    server: Option<String>,

    /// Registration token from the PeerDesk web dashboard.
    #[arg(long, env = "API_KEY")]
    api_key: Option<String>,

    /// Password for incoming connections (auto-generated on first run if omitted).
    #[arg(long, env = "PEERDESK_PASSWORD")]
    password: Option<String>,

    /// Log to file instead of stdout. Required when running as a system service.
    #[arg(long)]
    silent: bool,

    /// Store config next to the executable (portable/USB mode).
    #[arg(long)]
    portable: bool,

    /// Print this machine's peer ID and exit.
    #[arg(long)]
    get_id: bool,

    /// Generate a new random password, save it, print it, and exit.
    #[arg(long)]
    reset_password: bool,

    /// Install as a system service (requires root/Administrator).
    #[arg(long)]
    install_service: bool,

    /// Remove the system service (requires root/Administrator).
    #[arg(long)]
    uninstall_service: bool,

    /// Path to a deployment config JSON file.
    /// Format: {"server":"URL","api_key":"pd_xxx","password":"pw"}
    /// Explicit CLI flags take priority over values in this file.
    #[arg(long)]
    config: Option<std::path::PathBuf>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Load deploy file; CLI flags override it
    let deploy = match &cli.config {
        Some(path) => peerdesk_agent::config::DeployConfig::load(path)
            .map_err(|e| anyhow::anyhow!("--config {}: {}", path.display(), e))?,
        None => peerdesk_agent::config::DeployConfig::default(),
    };

    let effective_server  = cli.server.as_deref().or(deploy.server.as_deref());
    let effective_api_key = cli.api_key.as_deref().or(deploy.api_key.as_deref());
    let generated_pw_storage;
    let effective_password: &str = match cli.password.as_deref()
        .or(deploy.password.as_deref()) {
        Some(pw) => pw,
        None => {
            use rand::distributions::Alphanumeric;
            use rand::Rng;
            generated_pw_storage = rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(12)
                .map(char::from)
                .collect::<String>();
            &generated_pw_storage
        }
    };

    // Service management
    if cli.install_service {
        // Persist server/key to config before installing so the service picks them up on start
        if effective_server.is_some() || effective_api_key.is_some() {
            let config_path = Config::config_path(cli.portable);
            Config::load_or_create(
                &config_path,
                effective_password,
                effective_server,
                effective_api_key,
            )?;
        }
        service::install_service()?;
        return Ok(());
    }
    if cli.uninstall_service {
        service::uninstall_service()?;
        return Ok(());
    }

    // Logging — _guard must stay alive until main returns to flush file logs
    let _guard = if cli.silent {
        Some(logging::init_file()?)
    } else {
        logging::init_stdout();
        None
    };

    // Config
    let config_path = Config::config_path(cli.portable);
    let cfg = Config::load_or_create(
        &config_path,
        effective_password,
        effective_server,
        effective_api_key,
    )?;

    // One-shot commands
    if cli.get_id {
        println!("{}", cfg.peer_id);
        return Ok(());
    }

    if cli.reset_password {
        use rand::distributions::Alphanumeric;
        use rand::Rng;
        let new_pw: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(12)
            .map(char::from)
            .collect();
        let hash = bcrypt::hash(&new_pw, bcrypt::DEFAULT_COST)?;
        let updated = Config {
            peer_id: cfg.peer_id.clone(),
            password_hash: hash,
            server_url: cfg.server_url.clone(),
            api_key: cfg.api_key.clone(),
            hmac_key: Some(peerdesk_agent::config::derive_hmac_key(&new_pw)),
        };
        updated.save(&config_path)?;
        println!("New password: {new_pw}");
        println!("Peer ID:      {}", cfg.peer_id);
        return Ok(());
    }

    // Print connection info — user needs these to connect from the viewer
    if !cli.silent {
        println!("┌─────────────────────────────────┐");
        println!("│  Peer ID : {:>21} │", cfg.peer_id);
        println!("│  Password: {:>21} │", effective_password);
        println!("└─────────────────────────────────┘");
    }
    tracing::info!("peer_id={} — ready for connections", cfg.peer_id);

    // Run agent
    run_agent(AgentConfig {
        password: effective_password.to_string(),
        server_url: effective_server.map(str::to_string).or(cfg.server_url),
        api_key: effective_api_key.map(str::to_string).or(cfg.api_key),
        display_index: 0,
        portable: cli.portable,
        cast_only: false,
        approval_tx: None, // CLI agent auto-approves (no UI)
    })
    .await
}
