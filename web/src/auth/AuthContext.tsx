import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, setOnAuthFailure, refreshAccessToken } from '../api/client';
import type { UserOut } from '../api/client';
import { getTokens, setTokens as storeSetTokens, clear as clearStore } from './tokenStore';
import { isIdleExpired, IDLE_THRESHOLD_MS } from './idle';
import { useActivityTracker } from '../hooks/useActivityTracker';

interface AuthState {
  accessToken: string | null;
  user: UserOut | null;
  loading: boolean;
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (email: string, name: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => void;
  setSessionActive: (active: boolean) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    accessToken: getTokens()?.access ?? null,
    user: null,
    loading: true,
  });
  const lastActivity = useRef<number>(Date.now());
  const sessionActive = useRef<boolean>(false);
  const pendingLogout = useRef<boolean>(false);

  const doLogout = useCallback(() => {
    const refresh = getTokens()?.refresh;
    if (refresh) api.auth.logout(refresh).catch(() => {});
    clearStore();
    setState({ accessToken: null, user: null, loading: false });
  }, []);

  // Forced logout from the API layer (refresh failed). Defer while a viewer session is active.
  useEffect(() => {
    setOnAuthFailure(() => {
      if (sessionActive.current) { pendingLogout.current = true; return; }
      clearStore();
      setState({ accessToken: null, user: null, loading: false });
    });
  }, []);

  const setSessionActive = useCallback((active: boolean) => {
    sessionActive.current = active;
    if (active) lastActivity.current = Date.now();
    if (!active && pendingLogout.current) {
      pendingLogout.current = false;
      clearStore();
      setState({ accessToken: null, user: null, loading: false });
    }
  }, []);

  useActivityTracker(useCallback(() => { lastActivity.current = Date.now(); }, []));

  // On mount: validate stored token and load user.
  useEffect(() => {
    const tokens = getTokens();
    if (!tokens) { setState(s => ({ ...s, loading: false })); return; }
    api.users.me(tokens.access)
      .then(user => setState(s => ({ ...s, user, accessToken: getTokens()?.access ?? null, loading: false })))
      .catch(() => { clearStore(); setState({ accessToken: null, user: null, loading: false }); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Session keeper + idle mirror: tick every 60s.
  useEffect(() => {
    if (!state.user) return;
    const id = setInterval(() => {
      const now = Date.now();
      const idle = isIdleExpired(lastActivity.current, now, IDLE_THRESHOLD_MS);
      if (idle && !sessionActive.current) { doLogout(); return; }
      // proactively refresh if there was recent activity (keeps active sessions seamless)
      const recentlyActive = now - lastActivity.current < IDLE_THRESHOLD_MS;
      if (recentlyActive) {
        refreshAccessToken()
          .then(() => setState(s => ({ ...s, accessToken: getTokens()?.access ?? s.accessToken })))
          .catch(() => {}); // a real failure surfaces via the next API call's interceptor
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [state.user, doLogout]);

  const finishAuth = async (access: string) => {
    const user = await api.users.me(access);
    setState(s => ({ ...s, user, accessToken: access }));
  };

  const login = useCallback(async (email: string, password: string, rememberMe = false) => {
    const tokens = await api.auth.login(email, password, rememberMe);
    storeSetTokens({ access: tokens.access_token, refresh: tokens.refresh_token }, rememberMe);
    lastActivity.current = Date.now();
    await finishAuth(tokens.access_token);
  }, []);

  const register = useCallback(async (email: string, name: string, password: string, rememberMe = false) => {
    const tokens = await api.auth.register(email, name, password, rememberMe);
    storeSetTokens({ access: tokens.access_token, refresh: tokens.refresh_token }, rememberMe);
    lastActivity.current = Date.now();
    await finishAuth(tokens.access_token);
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout: doLogout, setSessionActive }}>
      {children}
    </AuthContext.Provider>
  );
}
