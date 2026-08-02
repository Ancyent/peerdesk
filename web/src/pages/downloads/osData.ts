export type OsId = 'linux' | 'windows' | 'android' | 'macos';

export interface OsTab {
  id: OsId;
  /** `downloads:osTabs.*` translation key, resolved at render time. */
  label: string;
  enabled: boolean;
  hasDeploy: boolean;
  /** `downloads:osTabs.*Note` translation key, resolved at render time. */
  note?: string;
  match: (assetName: string) => boolean;
}

export const OS_TABS: OsTab[] = [
  {
    id: 'linux', label: 'downloads:osTabs.linux', enabled: true, hasDeploy: true,
    note: 'downloads:osTabs.linuxNote',
    match: (n) => /linux|\.deb$|\.rpm$|\.appimage$/i.test(n),
  },
  {
    id: 'windows', label: 'downloads:osTabs.windows', enabled: true, hasDeploy: true,
    note: 'downloads:osTabs.windowsNote',
    match: (n) => /windows|\.msi$|\.exe$/i.test(n),
  },
  {
    id: 'android', label: 'downloads:osTabs.android', enabled: true, hasDeploy: false,
    note: 'downloads:osTabs.androidNote',
    match: (n) => /android|\.apk$/i.test(n),
  },
  {
    id: 'macos', label: 'downloads:osTabs.macos', enabled: false, hasDeploy: false,
    match: (n) => /\.dmg$|macos/i.test(n),
  },
];

/**
 * Label for a release asset filename. Returns a `downloads:assetLabel.*`
 * translation key for descriptive labels, a plain technical string for
 * extension-only labels (identical in every locale), or the filename itself
 * as a last-resort fallback — never route the fallback through t().
 */
export function assetLabel(name: string): string {
  if (/\.appimage$/i.test(name)) return '.AppImage';
  if (/\.deb$/i.test(name)) return '.deb';
  if (/\.rpm$/i.test(name)) return '.rpm';
  if (/\.msi$/i.test(name)) return '.msi';
  if (/portable\.exe$/i.test(name)) return 'downloads:assetLabel.portableExe';
  if (/setup\.exe$/i.test(name)) return 'downloads:assetLabel.installerExe';
  if (/\.exe$/i.test(name)) return 'downloads:assetLabel.agentExe';
  if (/\.dmg$/i.test(name)) return '.dmg';
  if (/\.apk$/i.test(name)) return '.apk';
  if (/headless/i.test(name) && /linux/i.test(name)) return 'downloads:assetLabel.headlessLinuxAgent';
  if (/agent/i.test(name) && /linux/i.test(name)) return 'downloads:assetLabel.linuxAgent';
  if (/linux/i.test(name)) return 'Linux x86_64';
  return name;
}

export type LinuxPkg = 'deb' | 'rpm' | 'appimage';

export interface LinuxDistro {
  id: string;
  /** `downloads:linuxDistros.*` translation key, resolved at render time. */
  label: string;
  pkg: LinuxPkg;
  /** Install command; `<file>` is replaced with the asset filename at render time. */
  installHint: string;
  /** Uninstall command template for the viewer package; `{pkg}` is filled in by `uninstallHint()`. */
  uninstallTemplate: string;
  /** Selects the viewer asset for this distro by extension. */
  match: (assetName: string) => boolean;
}

// The .deb and .rpm install the viewer under a package name Tauri derives
// from productName -- the project's own builds use "PeerDesk", which Tauri
// sanitizes to "peer-desk". A white-label build produces a different name, so
// the real one comes from the release manifest (see uninstallHint() below).
// The AppImage isn't installed — you just delete the file.
export const LINUX_DISTROS: LinuxDistro[] = [
  { id: 'ubuntu',   label: 'downloads:linuxDistros.ubuntu',   pkg: 'deb',      installHint: 'sudo apt install ./<file>',    uninstallTemplate: 'sudo apt remove {pkg}',    match: (n) => /\.deb$/i.test(n) },
  { id: 'fedora',   label: 'downloads:linuxDistros.fedora',   pkg: 'rpm',      installHint: 'sudo dnf install ./<file>',    uninstallTemplate: 'sudo dnf remove {pkg}',    match: (n) => /\.rpm$/i.test(n) },
  { id: 'opensuse', label: 'downloads:linuxDistros.opensuse', pkg: 'rpm',      installHint: 'sudo zypper install ./<file>', uninstallTemplate: 'sudo zypper remove {pkg}', match: (n) => /\.rpm$/i.test(n) },
  { id: 'arch',     label: 'downloads:linuxDistros.arch',     pkg: 'appimage', installHint: 'chmod +x <file> && ./<file>',  uninstallTemplate: 'rm <file>',                match: (n) => /\.appimage$/i.test(n) },
];

// The .deb and .rpm install under a package name Tauri derives from
// productName -- "PeerDesk" becomes "peer-desk". A white-label build produces
// a different one, so the hint is filled in from the manifest when the build
// recorded it, and falls back to the project's own name when it did not, which
// is every GitHub-mirrored release.
export const DEFAULT_LINUX_PACKAGE = 'peer-desk';

export function uninstallHint(distro: LinuxDistro, linuxPackage?: string): string {
  return distro.uninstallTemplate.replace('{pkg}', linuxPackage || DEFAULT_LINUX_PACKAGE);
}

/**
 * Uninstall the headless/CLI agent: systemd service + binary + config (the
 * config holds the peer ID and password, so removing it forces a clean fresh
 * install next time). Distro-independent.
 */
export const AGENT_UNINSTALL_LINUX =
  'sudo peerdesk-agent --uninstall-service && sudo rm -f /usr/local/bin/peerdesk-agent && sudo rm -rf /root/.config/peerdesk';

/** Uninstall the agent on Windows (service + binary + config). Run PowerShell as Administrator. */
export const AGENT_UNINSTALL_WINDOWS =
  '& "$env:ProgramFiles\\PeerDesk\\peerdesk-agent.exe" --uninstall-service; Remove-Item -Recurse -Force "$env:ProgramFiles\\PeerDesk", "$env:APPDATA\\peerdesk" -ErrorAction SilentlyContinue';

/** Human-readable file size. Empty string for non-positive/NaN input. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** `meaning` is a `downloads:agentArgs.*` translation key, resolved at render time. */
export interface AgentArg { flag: string; meaning: string }

export const AGENT_ARGS: AgentArg[] = [
  { flag: '--server=URL', meaning: 'downloads:agentArgs.server' },
  { flag: '--api-key=TOKEN', meaning: 'downloads:agentArgs.apiKey' },
  { flag: '--password=PW', meaning: 'downloads:agentArgs.password' },
  { flag: '--silent', meaning: 'downloads:agentArgs.silent' },
  { flag: '--portable', meaning: 'downloads:agentArgs.portable' },
  { flag: '--get-id', meaning: 'downloads:agentArgs.getId' },
  { flag: '--reset-password', meaning: 'downloads:agentArgs.resetPassword' },
  { flag: '--install-service', meaning: 'downloads:agentArgs.installService' },
  { flag: '--uninstall-service', meaning: 'downloads:agentArgs.uninstallService' },
];

export function coerceOs(sub: string | null): OsId {
  const tab = OS_TABS.find((t) => t.id === sub && t.enabled);
  return (tab?.id as OsId) ?? 'linux';
}
