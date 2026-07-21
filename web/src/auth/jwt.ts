/**
 * Client-side JWT payload reader — no signature verification.
 * Used only to check token expiry so the keeper can proactively refresh.
 */
export function tokenExpiringSoon(
  token: string | null | undefined,
  nowMs: number,
  skewMs: number,
): boolean {
  if (!token) return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    // base64url → base64 → JSON
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64);
    const payload = JSON.parse(json) as { exp?: unknown };
    if (typeof payload.exp !== 'number') return true;
    return payload.exp * 1000 - nowMs <= skewMs;
  } catch {
    return true;
  }
}

/**
 * Reads the account_id claim from an access token (no signature verification).
 * Used to know which of the user's memberships is currently active.
 */
export function accountIdFromToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64);
    const payload = JSON.parse(json) as { account_id?: unknown };
    return typeof payload.account_id === 'string' ? payload.account_id : null;
  } catch {
    return null;
  }
}
