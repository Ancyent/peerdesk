import { describe, it, expect, vi, beforeEach } from 'vitest';

// config.ts accesses bare `location` at module-load time; stub it away.
vi.mock('../config', () => ({ getConfig: () => ({ apiUrl: '' }) }));

// minimal localStorage/sessionStorage + window for node env
class Mem { m = new Map<string,string>(); get length(){return this.m.size;} clear(){this.m.clear();}
  getItem(k:string){return this.m.get(k)??null;} key(i:number){return [...this.m.keys()][i]??null;}
  removeItem(k:string){this.m.delete(k);} setItem(k:string,v:string){this.m.set(k,v);} }

beforeEach(() => {
  (globalThis as any).window = { localStorage: new Mem(), sessionStorage: new Mem(),
    location: { origin: 'http://test' } };
  (globalThis as any).localStorage = (globalThis as any).window.localStorage;
});

describe('request 401 handling', () => {
  it('refreshes once then retries the original request', async () => {
    const { api, setTokens } = await import('./client');
    setTokens({ access: 'old', refresh: 'r1' }, true);
    const calls: string[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string, opts: any) => {
      calls.push(`${url}:${opts?.headers?.Authorization ?? ''}`);
      if (url.endsWith('/users/me') && opts.headers.Authorization === 'Bearer old')
        return new Response('x', { status: 401 });
      if (url.endsWith('/auth/refresh'))
        return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r1', token_type: 'bearer' }), { status: 200 });
      return new Response(JSON.stringify({ id: 'u', email: 'e', name: 'n', created_at: '2026-01-01' }), { status: 200 });
    });
    const me = await api.users.me('old');
    expect(me.id).toBe('u');
    expect(calls.some(c => c.includes('/auth/refresh'))).toBe(true);
    expect(calls.some(c => c.endsWith('/users/me:Bearer new'))).toBe(true);
  });

  it('invokes onAuthFailure when refresh fails', async () => {
    const { api, setTokens, setOnAuthFailure } = await import('./client');
    setTokens({ access: 'old', refresh: 'bad' }, true);
    const onFail = vi.fn();
    setOnAuthFailure(onFail);
    (globalThis as any).fetch = vi.fn(async (url: string) =>
      url.endsWith('/auth/refresh') ? new Response('no', { status: 401 }) : new Response('no', { status: 401 }));
    await expect(api.users.me('old')).rejects.toBeDefined();
    expect(onFail).toHaveBeenCalled();
  });
});
