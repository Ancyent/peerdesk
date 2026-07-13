use anyhow::{bail, Context, Result};

pub const SERVICE_NAME: &str = "peerdesk-agent";

/// Install peerdesk-agent as a system service.
/// Linux: creates systemd unit, enables and starts it (requires root).
/// Windows: registers via sc.exe and starts it (requires Administrator).
#[allow(unreachable_code)]
pub fn install_service() -> Result<()> {
    let exe = std::env::current_exe().context("cannot determine current executable path")?;
    let exe_str = exe.to_string_lossy().to_string();

    #[cfg(target_os = "linux")]
    return install_systemd(&exe_str);

    #[cfg(target_os = "windows")]
    return install_windows_service(&exe_str);

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    bail!("Service install is only supported on Linux and Windows.")
}

/// Remove the system service.
#[allow(unreachable_code)]
pub fn uninstall_service() -> Result<()> {
    #[cfg(target_os = "linux")]
    return uninstall_systemd();

    #[cfg(target_os = "windows")]
    return uninstall_windows_service();

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    bail!("Service uninstall is only supported on Linux and Windows.")
}

// ── Linux (systemd) ───────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
pub fn build_systemd_unit(exe_path: &str) -> String {
    format!(
        "[Unit]\n\
         Description=PeerDesk Remote Access Agent\n\
         After=network-online.target\n\
         Wants=network-online.target\n\
         \n\
         [Service]\n\
         Type=simple\n\
         # Pin HOME so the service reads the SAME config the interactive root\n\
         # commands (install, --reset-password) write. Without this the service\n\
         # inherits systemd's HOME (often unset) and dirs::config_dir() resolves\n\
         # to a different path, so a password reset never reaches the service.\n\
         Environment=HOME=/root\n\
         ExecStart={exe} --silent\n\
         Restart=on-failure\n\
         RestartSec=5\n\
         \n\
         [Install]\n\
         WantedBy=multi-user.target\n",
        exe = exe_path
    )
}

#[cfg(target_os = "linux")]
fn install_systemd(exe_path: &str) -> Result<()> {
    let unit = build_systemd_unit(exe_path);
    let unit_path = format!("/etc/systemd/system/{}.service", SERVICE_NAME);
    std::fs::write(&unit_path, &unit)
        .with_context(|| format!("Cannot write {unit_path} — run as root"))?;
    println!("Written: {unit_path}");
    run_cmd("systemctl", &["daemon-reload"])?;
    run_cmd("systemctl", &["enable", SERVICE_NAME])?;
    run_cmd("systemctl", &["start", SERVICE_NAME])?;
    println!("Service '{SERVICE_NAME}' installed and started.");
    println!("Logs: journalctl -u {SERVICE_NAME} -f");
    Ok(())
}

#[cfg(target_os = "linux")]
fn uninstall_systemd() -> Result<()> {
    run_cmd("systemctl", &["stop", SERVICE_NAME]).ok();
    run_cmd("systemctl", &["disable", SERVICE_NAME]).ok();
    let unit_path = format!("/etc/systemd/system/{}.service", SERVICE_NAME);
    if std::path::Path::new(&unit_path).exists() {
        std::fs::remove_file(&unit_path)
            .with_context(|| format!("Cannot remove {unit_path} — run as root"))?;
    }
    run_cmd("systemctl", &["daemon-reload"])?;
    println!("Service '{SERVICE_NAME}' removed.");
    Ok(())
}

// ── Windows (sc.exe) ──────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn install_windows_service(exe_path: &str) -> Result<()> {
    let binpath = format!("\"{}\" --silent", exe_path);
    run_cmd(
        "sc",
        &[
            "create",
            SERVICE_NAME,
            &format!("binpath={}", binpath),
            "start=auto",
        ],
    )?;
    run_cmd(
        "sc",
        &["description", SERVICE_NAME, "PeerDesk Remote Access Agent"],
    )?;
    run_cmd("sc", &["start", SERVICE_NAME])?;
    println!("Service '{}' installed and started.", SERVICE_NAME);
    Ok(())
}

#[cfg(target_os = "windows")]
fn uninstall_windows_service() -> Result<()> {
    run_cmd("sc", &["stop", SERVICE_NAME]).ok();
    run_cmd("sc", &["delete", SERVICE_NAME])?;
    println!("Service '{}' removed.", SERVICE_NAME);
    Ok(())
}

// ── Shared ────────────────────────────────────────────────────────────────────

fn run_cmd(program: &str, args: &[&str]) -> Result<()> {
    let status = std::process::Command::new(program)
        .args(args)
        .status()
        .with_context(|| format!("Failed to run: {program} {}", args.join(" ")))?;
    if !status.success() {
        bail!("{program} {} exited with {status}", args.join(" "));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_name_is_constant() {
        assert_eq!(SERVICE_NAME, "peerdesk-agent");
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn systemd_unit_contains_execstart() {
        let unit = build_systemd_unit("/usr/local/bin/peerdesk-agent");
        assert!(unit.contains("ExecStart=/usr/local/bin/peerdesk-agent --silent"));
        assert!(unit.contains("Restart=on-failure"));
        assert!(unit.contains("WantedBy=multi-user.target"));
        // HOME must be pinned so the service and interactive root share one config.
        assert!(unit.contains("Environment=HOME=/root"));
    }
}
