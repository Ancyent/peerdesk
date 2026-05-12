use peerdesk_agent::{run_agent, AgentConfig};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    run_agent(AgentConfig::default()).await
}
