import type { OsId } from './osData';

/** Linux install mode: auto-detect (default), or force headless / GUI. */
export type InstallMode = 'auto' | 'headless' | 'gui';

export interface CommandOpts {
  origin: string;
  token: string | null;
  /** Optional access password. Empty → the agent generates and prints one. */
  password?: string;
  /** Linux only. Ignored on Windows (the agent is always GUI there). */
  mode?: InstallMode;
}

/** Wrap a value in bash single quotes, escaping embedded single quotes. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Wrap a value in PowerShell double quotes, escaping embedded double quotes. */
function psQuote(s: string): string {
  return `"${s.replace(/"/g, '`"')}"`;
}

export function buildCommand(os: OsId, ctx: CommandOpts): string {
  if (!ctx.token) return '';
  const { origin, token, password, mode } = ctx;
  switch (os) {
    case 'linux': {
      let cmd = `curl -sSL ${origin}/install.sh | sudo bash -s -- --server=${origin} --api-key=${token}`;
      if (password) cmd += ` --password=${shQuote(password)}`;
      if (mode === 'headless') cmd += ' --headless';
      else if (mode === 'gui') cmd += ' --gui';
      return cmd;
    }
    case 'windows': {
      let cmd = `& ([scriptblock]::Create((irm ${origin}/install.ps1))) -Server "${origin}" -ApiKey "${token}"`;
      if (password) cmd += ` -Password ${psQuote(password)}`;
      return cmd;
    }
    default:
      return '';
  }
}
