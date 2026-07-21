import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, setOnAuthFailure, refreshAccessToken } from '../api/client';
import type { UserOut, AccountMembershipOut } from '../api/client';
import { getTokens, setTokens as storeSetTokens, clear as clearStore, getStorageKind } from './tokenStore';
import { isIdleExpired, IDLE_THRESHOLD_MS } from './idle';
import { tokenExpiringSoon, accountIdFromToken } from './jwt';
import { useActivityTracker } from '../hooks/useActivityTracker';

interface AuthState {
  accessToken: string | null;
  user: UserOut | null;
  loading: boolean;
}

export interface AuthContextValue extends AuthState {
  accounts: AccountMembershipOut[];
  activeAccountId: string | null;
  role: string | null;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (email: string, name: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => void;
  setSessionActive: (active: boolean) => void;
  switchAccount: (accountId: string) => Promise<void>;
  // Persists a fresh token pair and loads the resulting user, the same way
  // login/register do. Shared with InvitePage, whose /auth/accept-invite
  // call also mints a token pair (for both the signed-out registration
  // branch and the signed-in "join with my existing account" branch).
  applyTokens: (access: string, refresh: string, rememberMe?: boolean) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    accessToken: getTokens()?.access ?? null,
    user: null,
    loading: true,
  });
  const [accounts, setAccounts] = useState<AccountMembershipOut[]>([]);
  const lastActivity = useRef<number>(Date.now());
  const sessionActive = useRef<boolean>(false);
  const pendingLogout = useRef<boolean>(false);

  useEffect(() => {
    if (!state.accessToken) { setAccounts([]); return; }
    api.auth.listAccounts(state.accessToken)
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [state.accessToken]);

  const activeAccountId = state.accessToken ? accountIdFromToken(state.accessToken) : null;
  const role = accounts.find(a => a.account_id === activeAccountId)?.role ?? null;

  const switchAccount = useCallback(async (accountId: string) => {
    const tokens = getTokens();
    if (!tokens) return;
    const { access_token } = await api.auth.switchAccount(tokens.access, accountId);
    // Keep storage in sync with context state (same pattern as login/register)
    // so a reload before the next token refresh doesn't revert to the old account.
    storeSetTokens({ access: access_token, refresh: tokens.refresh }, getStorageKind() === 'local');
    setState(s => ({ ...s, accessToken: access_token }));
  }, []);

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
      // proactively refresh only when recently active AND the access token is near expiry
      const recentlyActive = now - lastActivity.current < IDLE_THRESHOLD_MS;
      if (recentlyActive && tokenExpiringSoon(getTokens()?.access, now, 2 * 60 * 1000)) {
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

  const applyTokens = useCallback(async (access: string, refresh: string, rememberMe = false) => {
    storeSetTokens({ access, refresh }, rememberMe);
    lastActivity.current = Date.now();
    await finishAuth(access);
  }, []);

  const login = useCallback(async (email: string, password: string, rememberMe = false) => {
    const tokens = await api.auth.login(email, password, rememberMe);
    await applyTokens(tokens.access_token, tokens.refresh_token, rememberMe);
  }, [applyTokens]);

  const register = useCallback(async (email: string, name: string, password: string, rememberMe = false) => {
    const tokens = await api.auth.register(email, name, password, rememberMe);
    await applyTokens(tokens.access_token, tokens.refresh_token, rememberMe);
  }, [applyTokens]);

  return (
    <AuthContext.Provider value={{
      ...state, accounts, activeAccountId, role,
      login, register, logout: doLogout, setSessionActive, switchAccount, applyTokens,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
