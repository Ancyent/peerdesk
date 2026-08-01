// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  applyTheme, resolveTheme, getStoredTheme, setStoredTheme, watchSystemTheme,
  THEME_STORAGE_KEY,
} from '@pd/ui';

type Listener = () => void;

/** Stands in for matchMedia so the OS preference can be flipped mid-test. */
function mockMatchMedia(dark: boolean) {
  const listeners: Listener[] = [];
  const mql = {
    matches: dark,
    addEventListener: (_: string, fn: Listener) => { listeners.push(fn); },
    removeEventListener: (_: string, fn: Listener) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  vi.stubGlobal('matchMedia', () => mql);
  return {
    listenerCount: () => listeners.length,
    emit: (nowDark: boolean) => { mql.matches = nowDark; listeners.forEach(fn => fn()); },
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('theme', () => {
  it('defaults to system when nothing is stored', () => {
    expect(getStoredTheme()).toBe('system');
  });

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
    expect(getStoredTheme()).toBe('system');
  });

  it('round-trips an explicit choice', () => {
    setStoredTheme('light');
    expect(getStoredTheme()).toBe('light');
  });

  it('resolves system against the OS preference', () => {
    mockMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');
    mockMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('does not let the OS override an explicit choice', () => {
    mockMatchMedia(true);
    expect(resolveTheme('light')).toBe('light');
  });

  it('writes the resolved theme onto the root element', () => {
    mockMatchMedia(false);
    applyTheme('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('follows the OS while the stored choice is system', () => {
    const mm = mockMatchMedia(false);
    watchSystemTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    mm.emit(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('re-reads storage on each OS change, so switching back to system takes effect without a reload', () => {
    const mm = mockMatchMedia(false);
    watchSystemTheme();

    // What SettingsPage does: persist and apply. Storing alone deliberately
    // does not repaint, so the two are always called together.
    setStoredTheme('dark');
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // OS goes light while the user is pinned to dark: must not follow.
    mm.emit(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // Back to system, without re-subscribing.
    setStoredTheme('system');
    applyTheme('system');
    mm.emit(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('detaches its listener on unsubscribe', () => {
    const mm = mockMatchMedia(false);
    const stop = watchSystemTheme();
    expect(mm.listenerCount()).toBe(1);
    stop();
    expect(mm.listenerCount()).toBe(0);
  });
});
