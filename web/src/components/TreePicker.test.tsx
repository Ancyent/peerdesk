// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotifyProvider } from '@pd/ui';
import '../i18n';

// react-dom's act() requires this flag when @testing-library isn't in play.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const list = vi.fn();
const locationsList = vi.fn();
const groupsList = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    companies: { list: (...a: unknown[]) => list(...a) },
    locations: { list: (...a: unknown[]) => locationsList(...a) },
    groups: { list: (...a: unknown[]) => groupsList(...a) },
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ accessToken: 'test-token' }),
}));

import { TreePicker } from './TreePicker';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function flush() {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <NotifyProvider>
        <TreePicker value={null} onChange={() => {}} />
      </NotifyProvider>,
    );
  });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('TreePicker load failures', () => {
  it('shows an error toast when the company list fails to load, instead of silently rendering an empty tree', async () => {
    // Before the fix, this rejection was swallowed by `.catch(() => [])`:
    // the popover would just show "No organizations found", which reads to
    // the admin as "this account genuinely has no org tree" rather than
    // "the request failed".
    list.mockRejectedValue(new Error('network down'));

    mount();
    const trigger = document.querySelector('button')!;
    await act(async () => { trigger.click(); });
    await flush();

    expect(document.body.textContent).toContain('Could not load the list');
  });

  it('shows an error toast when a location list fails to load, even when the company list itself succeeds', async () => {
    list.mockResolvedValue([{ id: 'co1', name: 'Client A' }]);
    locationsList.mockRejectedValue(new Error('network down'));
    groupsList.mockResolvedValue([]);

    mount();
    const trigger = document.querySelector('button')!;
    await act(async () => { trigger.click(); });
    await flush();

    expect(document.body.textContent).toContain('Could not load the list');
  });
});
