export type Tokens = { access: string; refresh: string };
export type Stores = { local: Storage; session: Storage };

const ACCESS = 'access_token';
const REFRESH = 'refresh_token';
const PERSIST = 'auth_persist';

export function pickStorage(remember: boolean, stores: Stores): Storage {
  return remember ? stores.local : stores.session;
}

export function writeTokens(t: Tokens, remember: boolean, stores: Stores): void {
  clearTokens(stores);
  const s = pickStorage(remember, stores);
  s.setItem(ACCESS, t.access);
  s.setItem(REFRESH, t.refresh);
  s.setItem(PERSIST, remember ? 'local' : 'session');
}

export function readTokens(stores: Stores): Tokens | null {
  for (const s of [stores.local, stores.session]) {
    const access = s.getItem(ACCESS);
    const refresh = s.getItem(REFRESH);
    if (access && refresh) return { access, refresh };
  }
  return null;
}

export function clearTokens(stores: Stores): void {
  for (const s of [stores.local, stores.session]) {
    s.removeItem(ACCESS); s.removeItem(REFRESH); s.removeItem(PERSIST);
  }
}

function browserStores(): Stores {
  return { local: window.localStorage, session: window.sessionStorage };
}

export function getTokens(): Tokens | null { return readTokens(browserStores()); }
export function setTokens(t: Tokens, remember: boolean): void { writeTokens(t, remember, browserStores()); }
export function clear(): void { clearTokens(browserStores()); }
