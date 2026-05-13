import { getConfig } from '../config';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getConfig().apiUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
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

export interface CompanyOut {
  id: string; name: string; owner_id: string; created_at: string;
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

export const api = {
  auth: {
    register: (email: string, name: string, password: string) =>
      request<TokenResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, name, password }),
      }),
    login: (email: string, password: string) =>
      request<TokenResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    refresh: (refresh_token: string) =>
      request<TokenResponse>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token }),
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
      request<ApiKeyOut[]>('/api-keys', { headers: authHeaders(token) }),
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
    create: (token: string, placement?: { company_id?: string; location_id?: string; group_id?: string }) =>
      request<RegistrationTokenOut>('/tokens', { method: 'POST', headers: authHeaders(token), body: JSON.stringify(placement ?? {}) }),
  },
};
