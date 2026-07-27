import { describe, it, expect } from 'vitest';
import { parsePath, pathFor } from './paths';

describe('parsePath', () => {
  it('root and /machines → machines', () => {
    expect(parsePath('/')).toEqual({ page: 'machines', sub: null, params: {} });
    expect(parsePath('/machines')).toEqual({ page: 'machines', sub: null, params: {} });
  });
  it('each sidebar section', () => {
    expect(parsePath('/organization')).toEqual({ page: 'organization', sub: null, params: {} });
    expect(parsePath('/api-keys')).toEqual({ page: 'api-keys', sub: null, params: {} });
    expect(parsePath('/branding')).toEqual({ page: 'branding', sub: null, params: {} });
    expect(parsePath('/settings')).toEqual({ page: 'settings', sub: null, params: {} });
  });
  it('downloads with and without OS sub', () => {
    expect(parsePath('/downloads')).toEqual({ page: 'downloads', sub: null, params: {} });
    expect(parsePath('/downloads/windows')).toEqual({ page: 'downloads', sub: 'windows', params: {} });
    expect(parsePath('/downloads/')).toEqual({ page: 'downloads', sub: null, params: {} });
  });
  it('auth paths', () => {
    expect(parsePath('/login')).toEqual({ page: 'login', sub: null, params: {} });
    expect(parsePath('/register')).toEqual({ page: 'register', sub: null, params: {} });
  });
  it('invite with token sub', () => {
    expect(parsePath('/invite/abc123')).toEqual({ page: 'invite', sub: 'abc123', params: {} });
  });
  it('parses a viewer deep link into its machine id', () => {
    expect(parsePath('/viewer/m-123')).toEqual({
      page: 'viewer', sub: 'm-123', params: {},
    });
  });
  it('parses a bare viewer path with no machine id', () => {
    // A hand-typed /viewer has nothing to connect to; App renders the connect
    // form rather than guessing a machine.
    expect(parsePath('/viewer')).toEqual({ page: 'viewer', sub: null, params: {} });
  });
  it('unknown path → machines', () => {
    expect(parsePath('/nope/x')).toEqual({ page: 'machines', sub: null, params: {} });
  });

  it('parses a query string into params', () => {
    expect(parsePath('/machines', '?key=abc123')).toEqual({
      page: 'machines', sub: null, params: { key: 'abc123' },
    });
  });

  it('returns empty params when there is no query string', () => {
    expect(parsePath('/machines')).toEqual({ page: 'machines', sub: null, params: {} });
  });

  it('keeps sub-segment parsing intact alongside params', () => {
    expect(parsePath('/downloads/windows', '?x=1')).toEqual({
      page: 'downloads', sub: 'windows', params: { x: '1' },
    });
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
    expect(parsePath(pathFor('downloads', 'windows'))).toEqual({ page: 'downloads', sub: 'windows', params: {} });
    expect(parsePath(pathFor('settings'))).toEqual({ page: 'settings', sub: null, params: {} });
    expect(parsePath(pathFor('invite', 'abc123'))).toEqual({ page: 'invite', sub: 'abc123', params: {} });
  });
  it('builds a viewer path from a machine id', () => {
    expect(pathFor('viewer', 'm-123')).toBe('/viewer/m-123');
  });
  it('round-trips a viewer deep link', () => {
    expect(parsePath(pathFor('viewer', 'm-123'))).toEqual({
      page: 'viewer', sub: 'm-123', params: {},
    });
  });
});
