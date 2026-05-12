import { createContext, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api/client';
import type { UserOut } from '../api/client';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserOut | null;
  loading: boolean;
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    accessToken: localStorage.getItem('access_token'),
    refreshToken: localStorage.getItem('refresh_token'),
    user: null,
    loading: true,
  });

  const setTokens = (access: string, refresh: string) => {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    setState(s => ({ ...s, accessToken: access, refreshToken: refresh }));
  };

  // On mount: validate stored token and load user
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setState(s => ({ ...s, loading: false }));
      return;
    }
    api.users.me(token)
      .then(user => setState(s => ({ ...s, user, loading: false })))
      .catch(() => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setState({ accessToken: null, refreshToken: null, user: null, loading: false });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await api.auth.login(email, password);
    setTokens(tokens.access_token, tokens.refresh_token);
    const user = await api.users.me(tokens.access_token);
    setState(s => ({ ...s, user }));
  }, []);

  const register = useCallback(async (email: string, name: string, password: string) => {
    const tokens = await api.auth.register(email, name, password);
    setTokens(tokens.access_token, tokens.refresh_token);
    const user = await api.users.me(tokens.access_token);
    setState(s => ({ ...s, user }));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setState({ accessToken: null, refreshToken: null, user: null, loading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
