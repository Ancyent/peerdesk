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
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Service management
    if cli.install_service {
        // Persist server/key to config before installing so the service picks them up on start
        if cli.server.is_some() || cli.api_key.is_some() {
            use rand::distributions::Alphanumeric;
            use rand::Rng;
            let generated_pw: String = rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(12)
                .map(char::from)
                .collect();
            let password = cli.password.as_deref().unwrap_or(&generated_pw);
            let config_path = Config::config_path(cli.portable);
            Config::load_or_create(
                &config_path,
                password,
                cli.server.as_deref(),
                cli.api_key.as_deref(),
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
    let generated_pw;
    let password: &str = match cli.password.as_deref() {
        Some(pw) => pw,
        None => {
            use rand::distributions::Alphanumeric;
            use rand::Rng;
            generated_pw = rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(12)
                .map(char::from)
                .collect::<String>();
            &generated_pw
        }
    };
    let config_path = Config::config_path(cli.portable);
    let cfg = Config::load_or_create(
        &config_path,
        password,
        cli.server.as_deref(),
        cli.api_key.as_deref(),
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
        println!("│  Password: {:>21} │", password);
        println!("└─────────────────────────────────┘");
    }
    tracing::info!("peer_id={} — ready for connections", cfg.peer_id);

    // Run agent
    run_agent(AgentConfig {
        password: password.to_string(),
        server_url: cli.server.or(cfg.server_url),
        api_key: cli.api_key.or(cfg.api_key),
        display_index: 0,
        portable: cli.portable,
        cast_only: false,
    })
    .await
}
