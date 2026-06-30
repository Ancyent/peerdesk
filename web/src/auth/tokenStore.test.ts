import { describe, it, expect } from 'vitest';
import { pickStorage, readTokens, writeTokens, clearTokens } from './tokenStore';

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

function stores() { return { local: new MemStorage(), session: new MemStorage() }; }

describe('tokenStore', () => {
  it('remember=true uses local, false uses session', () => {
    const s = stores();
    expect(pickStorage(true, s)).toBe(s.local);
    expect(pickStorage(false, s)).toBe(s.session);
  });

  it('write→read round-trips and clear wipes both', () => {
    const s = stores();
    writeTokens({ access: 'a', refresh: 'r' }, true, s);
    expect(readTokens(s)).toEqual({ access: 'a', refresh: 'r' });
    clearTokens(s);
    expect(readTokens(s)).toBeNull();
  });

  it('session write is not read from local', () => {
    const s = stores();
    writeTokens({ access: 'a', refresh: 'r' }, false, s);
    expect(s.local.getItem('access_token')).toBeNull();
    expect(readTokens(s)).toEqual({ access: 'a', refresh: 'r' });
  });
});
