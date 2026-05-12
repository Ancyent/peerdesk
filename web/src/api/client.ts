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
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? 'Request failed');
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
  id: string;
  peer_id: string;
  name: string;
  os: string | null;
  is_online: boolean;
  last_seen_at: string | null;
  created_at: string;
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
};
