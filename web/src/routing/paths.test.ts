import { describe, it, expect } from 'vitest';
import { parsePath, pathFor } from './paths';

describe('parsePath', () => {
  it('root and /machines → machines', () => {
    expect(parsePath('/')).toEqual({ page: 'machines', sub: null });
    expect(parsePath('/machines')).toEqual({ page: 'machines', sub: null });
  });
  it('each sidebar section', () => {
    expect(parsePath('/organization')).toEqual({ page: 'organization', sub: null });
    expect(parsePath('/api-keys')).toEqual({ page: 'api-keys', sub: null });
    expect(parsePath('/branding')).toEqual({ page: 'branding', sub: null });
    expect(parsePath('/settings')).toEqual({ page: 'settings', sub: null });
  });
  it('downloads with and without OS sub', () => {
    expect(parsePath('/downloads')).toEqual({ page: 'downloads', sub: null });
    expect(parsePath('/downloads/windows')).toEqual({ page: 'downloads', sub: 'windows' });
    expect(parsePath('/downloads/')).toEqual({ page: 'downloads', sub: null });
  });
  it('auth paths', () => {
    expect(parsePath('/login')).toEqual({ page: 'login', sub: null });
    expect(parsePath('/register')).toEqual({ page: 'register', sub: null });
  });
  it('invite with token sub', () => {
    expect(parsePath('/invite/abc123')).toEqual({ page: 'invite', sub: 'abc123' });
  });
  it('unknown path → machines', () => {
    expect(parsePath('/nope/x')).toEqual({ page: 'machines', sub: null });
  });
});

describe('pathFor', () => {
  it('section paths', () => {
    expect(pathFor('machines')).toBe('/machines');
    expect(pathFor('api-keys')).toBe('/api-keys');
    expect(pathFor('downloads')).toBe('/downloads');
  });
  it('downloads with sub', () => {
    expect(pathFor('downloads', 'windows')).toBe('/downloads/windows');
  });
  it('invite with a token sub', () => {
    // The central trap of Task 7: pathFor once re-appended `sub` only for
    // `downloads`, so an invite link silently lost its token on navigation.
    expect(pathFor('invite', 'abc123')).toBe('/invite/abc123');
  });
  it('round-trips', () => {
    expect(parsePath(pathFor('downloads', 'windows'))).toEqual({ page: 'downloads', sub: 'windows' });
    expect(parsePath(pathFor('settings'))).toEqual({ page: 'settings', sub: null });
    expect(parsePath(pathFor('invite', 'abc123'))).toEqual({ page: 'invite', sub: 'abc123' });
  });
});
