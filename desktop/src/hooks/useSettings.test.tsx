// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotifyProvider } from '@pd/ui';
import '../i18n';
import { DEFAULT_SETTINGS } from '../types';

// react-dom's act() requires this flag when @testing-library isn't in play.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useSettings } from './useSettings';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useSettings>) => void }) {
  const api = useSettings();
  onReady(api);
  return null;
}

function mount(onReady: (api: ReturnType<typeof useSettings>) => void) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <NotifyProvider>
        <Harness onReady={onReady} />
      </NotifyProvider>,
    );
  });
}

/** Flushes pending microtasks (promise .then/.catch chains) inside act(). */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
  invokeMock.mockReset();
  vi.useRealTimers();
});

describe('useSettings failure surfacing', () => {
  it('shows an error toast when the initial load fails, instead of silently falling back to defaults', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_settings') return Promise.reject(new Error('io error'));
      return Promise.resolve();
    });

    let hookApi: ReturnType<typeof useSettings> | undefined;
    mount((a) => { hookApi = a; });

    await flushMicrotasks();

    // `loaded` still flips true (the UI must not hang), but silently
    // falling back to DEFAULT_SETTINGS with zero feedback is exactly what
    // reads to a user as "my settings were reset".
    expect(hookApi?.loaded).toBe(true);
    expect(document.body.textContent).toContain('Could not load your settings');
  });

  it('shows an error toast when a save fails, instead of only logging to the console', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_settings') return Promise.resolve(DEFAULT_SETTINGS);
      if (cmd === 'save_settings') return Promise.reject(new Error('disk full'));
      return Promise.resolve();
    });

    let hookApi: ReturnType<typeof useSettings> | undefined;
    mount((a) => { hookApi = a; });
    await flushMicrotasks();
    expect(hookApi?.loaded).toBe(true);
    expect(document.body.textContent).not.toContain('Could not save your settings');

    vi.useFakeTimers();
    act(() => { hookApi!.updateSetting('start_on_boot', true); });
    // updateSetting debounces the actual `save_settings` invoke by 500ms.
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(document.body.textContent).toContain('Could not save your settings');
  });
});
