import { getConfig } from '../config';
import { singleFlight } from '../lib/singleFlight';
import { getTokens, setTokens as storeSetTokens, clear as clearStore, getStorageKind } from '../auth/tokenStore';

export { storeSetTokens as setTokens };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onAuthFailure: (() => void) | null = null;
export function setOnAuthFailure(cb: () => void) { onAuthFailure = cb; }

export const refreshAccessToken = singleFlight(async (): Promise<void> => {
  const tokens = getTokens();
  if (!tokens) throw new ApiError(401, 'No session');
  const res = await fetch(`${getConfig().apiUrl}/auth/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh }),
  });
  if (!res.ok) throw new ApiError(res.status, 'Refresh failed');
  const data = await res.json();
  const persist = getStorageKind() === 'local';
  storeSetTokens({ access: data.access_token, refresh: data.refresh_token }, persist);
});

async function request<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  const res = await fetch(`${getConfig().apiUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    try {
      await refreshAccessToken();
    } catch {
      clearStore();
      onAuthFailure?.();
      throw new ApiError(401, 'Session expired');
    }
    const fresh = getTokens();
    const headers = { ...options.headers } as Record<string, string>;
    if (fresh && headers.Authorization) headers.Authorization = `Bearer ${fresh.access}`;
    return request<T>(path, { ...options, headers }, true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = body.detail;
    const message = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((e: { loc?: string[]; msg?: string }) => e.msg ?? JSON.stringify(e)).join('; ')
        : 'Request failed';
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface UserOut {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface MachineOut {
  id: string; peer_id: string; name: string; os: string | null;
  is_online: boolean; last_seen_at: string | null; created_at: string;
  company_id: string | null; location_id: string | null; group_id: string | null;
  approval_status: string;   // "pending" | "approved" | "denied"
  api_key_id: string | null;
  has_saved_password: boolean;
}

export interface ApiKeyOut {
  id: string;
  key: string;
  name: string;
  auto_approve: boolean;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeyListOut {
  id: string;
  key_preview: string;  // masked, e.g. "pd_abc123de••••••••••••••••"
  name: string;
  auto_approve: boolean;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface CompanyOut {
  id: string; name: string; created_at: string;
}
export interface LocationOut {
  id: string; name: string; company_id: string; created_at: string;
}
export interface GroupOut {
  id: string; name: string; location_id: string; created_at: string;
}
export interface RegistrationTokenOut {
  id: string; token: string; expires_at: string; used_at: string | null;
  company_id: string | null; location_id: string | null; group_id: string | null;
}

export interface BrandingConfig {
  brand_name: string;
  logo_data_url: string | null;
  accent_color: string;
}

export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  ttl: number;
}

export interface AccountMembershipOut {
  account_id: string;
  name: string;
  role: string;   // "admin" | "member"
}

export interface TeamMemberOut {
  membership_id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;   // "admin" | "member"
  created_at: string;
}

export interface InvitationOut {
  id: string;
  email: string | null;
  role: string;
  expires_at: string;
  created_at: string;
}

export interface InvitationCreatedOut extends InvitationOut {
  token: string;   // shown once, never returned again
}

export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export const api = {
  auth: {
    register: (email: string, name: string, password: string, remember_me = false) =>
      request<TokenResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, name, password, remember_me }),
      }),
    login: (email: string, password: string, remember_me = false) =>
      request<TokenResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, remember_me }),
      }),
    logout: (refresh_token: string) =>
      request<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token }) }),
    listAccounts: (token: string) =>
      request<AccountMembershipOut[]>('/auth/accounts', { headers: authHeaders(token) }),
    switchAccount: (token: string, accountId: string) =>
      request<{ access_token: string }>('/auth/switch-account', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ account_id: accountId }),
      }),
    // No required token argument -- the accepter may have no account yet.
    // `accessToken`, when passed, attaches the invitation to that signed-in
    // user server-side and the body's `email` is ignored there; omit it for
    // the signed-out (registration) path.
    acceptInvite: (
      body: { token: string; email: string; name?: string; password?: string },
      accessToken?: string,
    ) =>
      request<TokenResponse>('/auth/accept-invite', {
        method: 'POST',
        headers: accessToken ? authHeaders(accessToken) : undefined,
        body: JSON.stringify(body),
      }),
  },
  users: {
    me: (token: string) =>
      request<UserOut>('/users/me', { headers: authHeaders(token) }),
    update: (token: string, data: { name?: string; email?: string }) =>
      request<UserOut>('/users/me', { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(data) }),
    changePassword: (token: string, current_password: string, new_password: string) =>
      request<void>('/users/me/password', { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ current_password, new_password }) }),
  },
  machines: {
    list: (token: string) =>
      request<MachineOut[]>('/machines', { headers: authHeaders(token) }),
    register: (token: string, peer_id: string, name: string, os?: string) =>
      request<MachineOut>('/machines', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ peer_id, name, os }),
      }),
    approve: (token: string, machineId: string) =>
      request<MachineOut>(`/machines/${machineId}/approve`, {
        method: 'POST',
        headers: authHeaders(token),
      }),
    deny: (token: string, machineId: string) =>
      request<MachineOut>(`/machines/${machineId}/deny`, {
        method: 'POST',
        headers: authHeaders(token),
      }),
    listByStatus: (token: string, status: string) =>
      request<MachineOut[]>(`/machines?status=${encodeURIComponent(status)}`, {
        headers: authHeaders(token),
      }),
    remove: (token: string, machineId: string) =>
      request<void>(`/machines/${machineId}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      }),
    getSavedPassword: (token: string, machineId: string) =>
      request<{ password: string }>(`/machines/${machineId}/saved-password`, {
        headers: authHeaders(token),
      }),
    saveSavedPassword: (token: string, machineId: string, password: string) =>
      request<void>(`/machines/${machineId}/saved-password`, {
        method: 'PUT',
        headers: authHeaders(token),
        body: JSON.stringify({ password }),
      }),
    clearSavedPassword: (token: string, machineId: string) =>
      request<void>(`/machines/${machineId}/saved-password`, {
        method: 'DELETE',
        headers: authHeaders(token),
      }),
  },
  branding: {
    get: () => request<BrandingConfig>('/branding'),
    update: (token: string, data: Partial<Omit<BrandingConfig, 'updated_at'>>) =>
      request<BrandingConfig>('/branding', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify(data),
      }),
  },
  apiKeys: {
    list: (token: string) =>
      request<ApiKeyListOut[]>('/api-keys', { headers: authHeaders(token) }),
    create: (token: string, name: string, autoApprove = false) =>
      request<ApiKeyOut>('/api-keys', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ name, auto_approve: autoApprove }),
      }),
    revoke: (token: string, id: string) =>
      request<void>(`/api-keys/${id}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      }),
  },
  companies: {
    list: (token: string) =>
      request<CompanyOut[]>('/companies', { headers: authHeaders(token) }),
    create: (token: string, name: string) =>
      request<CompanyOut>('/companies', { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ name }) }),
    update: (token: string, id: string, name: string) =>
      request<CompanyOut>(`/companies/${id}`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ name }) }),
    delete: (token: string, id: string) =>
      request<void>(`/companies/${id}`, { method: 'DELETE', headers: authHeaders(token) }),
  },
  locations: {
    list: (token: string, companyId: string) =>
      request<LocationOut[]>(`/companies/${companyId}/locations`, { headers: authHeaders(token) }),
    create: (token: string, companyId: string, name: string) =>
      request<LocationOut>(`/companies/${companyId}/locations`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ name }) }),
    update: (token: string, id: string, name: string) =>
      request<LocationOut>(`/locations/${id}`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ name }) }),
    delete: (token: string, id: string) =>
      request<void>(`/locations/${id}`, { method: 'DELETE', headers: authHeaders(token) }),
  },
  groups: {
    list: (token: string, locationId: string) =>
      request<GroupOut[]>(`/locations/${locationId}/groups`, { headers: authHeaders(token) }),
    create: (token: string, locationId: string, name: string) =>
      request<GroupOut>(`/locations/${locationId}/groups`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ name }) }),
    update: (token: string, id: string, name: string) =>
      request<GroupOut>(`/groups/${id}`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ name }) }),
    delete: (token: string, id: string) =>
      request<void>(`/groups/${id}`, { method: 'DELETE', headers: authHeaders(token) }),
  },
  placement: {
    set: (token: string, machineId: string, data: { company_id?: string | null; location_id?: string | null; group_id?: string | null }) =>
      request<MachineOut>(`/machines/${machineId}/placement`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(data) }),
  },
  tokens: {
    create: (token: string, placement?: { company_id?: string; location_id?: string; group_id?: string; name?: string }) =>
      request<RegistrationTokenOut>('/tokens', { method: 'POST', headers: authHeaders(token), body: JSON.stringify(placement ?? {}) }),
  },
  turn: {
    credentials: (token: string) =>
      request<TurnCredentials>('/turn/credentials', { headers: authHeaders(token) }),
  },
  releases: {
    latest: () => request<Release>('/releases/latest'),
  },
  team: {
    members: (token: string) =>
      request<TeamMemberOut[]>('/team/members', { headers: authHeaders(token) }),
    setRole: (token: string, membershipId: string, role: string) =>
      request<TeamMemberOut>(`/team/members/${membershipId}`, {
        method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ role }),
      }),
    removeMember: (token: string, membershipId: string) =>
      request<void>(`/team/members/${membershipId}`, {
        method: 'DELETE', headers: authHeaders(token),
      }),
    invitations: (token: string) =>
      request<InvitationOut[]>('/team/invitations', { headers: authHeaders(token) }),
    invite: (token: string, email: string | null, role: string) =>
      request<InvitationCreatedOut>('/team/invitations', {
        method: 'POST', headers: authHeaders(token), body: JSON.stringify({ email, role }),
      }),
    revokeInvite: (token: string, invitationId: string) =>
      request<void>(`/team/invitations/${invitationId}`, {
        method: 'DELETE', headers: authHeaders(token),
      }),
  },
};
