import type { OsId } from './osData';

export function buildCommand(os: OsId, ctx: { origin: string; token: string | null }): string {
  if (!ctx.token) return '';
  const { origin, token } = ctx;
  switch (os) {
    case 'linux':
      return `curl -sSL ${origin}/install.sh | sudo bash -s -- --server=${origin} --token=${token}`;
    case 'windows':
      return `& ([scriptblock]::Create((irm ${origin}/install.ps1))) -Server "${origin}" -Token "${token}"`;
    default:
      return '';
  }
}
