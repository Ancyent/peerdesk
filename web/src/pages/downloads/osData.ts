export type OsId = 'linux' | 'windows' | 'android' | 'macos';

export interface OsTab {
  id: OsId;
  label: string;
  enabled: boolean;
  hasDeploy: boolean;
  note?: string;
  match: (assetName: string) => boolean;
}

export const OS_TABS: OsTab[] = [
  {
    id: 'linux', label: 'Linux', enabled: true, hasDeploy: true,
    note: 'Comanda de mai jos instalează agentul ca serviciu systemd. Pachetele desktop (.deb/.rpm/.AppImage) le instalezi normal — sunt viewer + host.',
    match: (n) => /linux|\.deb$|\.rpm$|\.appimage$/i.test(n),
  },
  {
    id: 'windows', label: 'Windows', enabled: true, hasDeploy: true,
    note: 'Rulează comanda în PowerShell ca Administrator. Pachetul desktop (.msi/.exe) e viewer + host.',
    match: (n) => /windows|\.msi$|\.exe$/i.test(n),
  },
  {
    id: 'android', label: 'Android', enabled: true, hasDeploy: false,
    note: 'Instalează APK-ul și deschide aplicația. Pe Android e doar viewer.',
    match: (n) => /android|\.apk$/i.test(n),
  },
  {
    id: 'macos', label: 'macOS (în curând)', enabled: false, hasDeploy: false,
    match: (n) => /\.dmg$|macos/i.test(n),
  },
];

export function assetLabel(name: string): string {
  if (/\.appimage$/i.test(name)) return '.AppImage';
  if (/\.deb$/i.test(name)) return '.deb';
  if (/\.rpm$/i.test(name)) return '.rpm';
  if (/\.msi$/i.test(name)) return '.msi';
  if (/portable\.exe$/i.test(name)) return 'portabil (.exe)';
  if (/setup\.exe$/i.test(name)) return 'installer (.exe)';
  if (/\.exe$/i.test(name)) return 'agent .exe';
  if (/\.dmg$/i.test(name)) return '.dmg';
  if (/\.apk$/i.test(name)) return '.apk';
  if (/headless/i.test(name) && /linux/i.test(name)) return 'agent headless (Linux, fără GUI)';
  if (/agent/i.test(name) && /linux/i.test(name)) return 'agent (Linux)';
  if (/linux/i.test(name)) return 'Linux x86_64';
  return name;
}

export type LinuxPkg = 'deb' | 'rpm' | 'appimage';

export interface LinuxDistro {
  id: string;
  label: string;
  pkg: LinuxPkg;
  /** Install command; `<file>` is replaced with the asset filename at render time. */
  installHint: string;
  /** Uninstall command for the viewer package (`<file>` replaced at render time). */
  uninstallHint: string;
  /** Selects the viewer asset for this distro by extension. */
  match: (assetName: string) => boolean;
}

// The .deb and .rpm both install the viewer under package name "peer-desk"
// (Tauri sanitizes productName "PeerDesk"). The AppImage isn't installed — you
// just delete the file.
export const LINUX_DISTROS: LinuxDistro[] = [
  { id: 'ubuntu',   label: 'Ubuntu / Debian', pkg: 'deb',      installHint: 'sudo apt install ./<file>',    uninstallHint: 'sudo apt remove peer-desk',    match: (n) => /\.deb$/i.test(n) },
  { id: 'fedora',   label: 'Fedora / RHEL',   pkg: 'rpm',      installHint: 'sudo dnf install ./<file>',    uninstallHint: 'sudo dnf remove peer-desk',    match: (n) => /\.rpm$/i.test(n) },
  { id: 'opensuse', label: 'openSUSE',        pkg: 'rpm',      installHint: 'sudo zypper install ./<file>', uninstallHint: 'sudo zypper remove peer-desk', match: (n) => /\.rpm$/i.test(n) },
  { id: 'arch',     label: 'Arch / altele',   pkg: 'appimage', installHint: 'chmod +x <file> && ./<file>',  uninstallHint: 'rm <file>',                    match: (n) => /\.appimage$/i.test(n) },
];

/** Uninstall the headless/CLI agent (systemd service + binary). Distro-independent. */
export const AGENT_UNINSTALL_LINUX =
  'sudo peerdesk-agent --uninstall-service && sudo rm -f /usr/local/bin/peerdesk-agent';

/** Uninstall the agent on Windows (run PowerShell as Administrator). */
export const AGENT_UNINSTALL_WINDOWS =
  '& "$env:ProgramFiles\\PeerDesk\\peerdesk-agent.exe" --uninstall-service; Remove-Item -Recurse -Force "$env:ProgramFiles\\PeerDesk"';

/** Human-readable file size. Empty string for non-positive/NaN input. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export interface AgentArg { flag: string; meaning: string }

export const AGENT_ARGS: AgentArg[] = [
  { flag: '--server=URL', meaning: 'URL-ul de bază al serverului PeerDesk (din el derivă API-ul și signaling-ul).' },
  { flag: '--api-key=TOKEN', meaning: 'Token de înregistrare generat din dashboard (folosit o singură dată). Flag-ul binarului este --api-key.' },
  { flag: '--password=PW', meaning: 'Setează manual parola de conectare (altfel se generează una).' },
  { flag: '--silent', meaning: 'Scrie în fișier de log, fără stdout (folosit de serviciu).' },
  { flag: '--portable', meaning: 'Stochează configul lângă binar (mod portabil).' },
  { flag: '--get-id', meaning: 'Afișează peer ID-ul și iese.' },
  { flag: '--reset-password', meaning: 'Generează o parolă nouă, o afișează și iese.' },
  { flag: '--install-service', meaning: 'Instalează ca serviciu systemd / Windows.' },
  { flag: '--uninstall-service', meaning: 'Dezinstalează serviciul.' },
];

export function coerceOs(sub: string | null): OsId {
  const tab = OS_TABS.find((t) => t.id === sub && t.enabled);
  return (tab?.id as OsId) ?? 'linux';
}
