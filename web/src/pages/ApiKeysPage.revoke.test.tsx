// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotifyProvider, ConfirmProvider } from '@pd/ui';

const list = vi.fn();
const revoke = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    apiKeys: {
      list: (...a: unknown[]) => list(...a),
      revoke: (...a: unknown[]) => revoke(...a),
      create: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ accessToken: 'tok' }) }));

import { ApiKeysPage } from './ApiKeysPage';

const KEY = {
  id: 'k1',
  key_preview: 'pd_abc123de••••',
  name: 'Busy Key',
  auto_approve: false,
  is_active: true,
  created_at: '2026-07-27T10:00:00Z',
  last_used_at: null,
  machine_count: 3,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <NotifyProvider><ConfirmProvider><ApiKeysPage /></ConfirmProvider></NotifyProvider>,
    );
  });
}

const clickText = async (text: string) => {
  const el = Array.from(document.querySelectorAll('button')).find(
    b => b.textContent?.trim() === text,
  );
  if (!el) throw new Error(`no button labelled "${text}"`);
  await act(async () => { el.click(); });
};

beforeEach(() => {
  list.mockResolvedValue([KEY]);
  revoke.mockReset();
  revoke.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('revoking an API key', () => {
  it('shows how many machines use the key', async () => {
    await renderPage();
    const count = document.querySelector('[data-testid="key-machine-count"]');
    expect(count?.textContent).toContain('3');
  });

  it('asks for confirmation and names the machine count', async () => {
    await renderPage();
    await clickText('Revoke');

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('3 machines');
    expect(revoke).not.toHaveBeenCalled();
  });

  it('does not revoke when cancelled', async () => {
    await renderPage();
    await clickText('Revoke');

    const cancel = document.querySelector<HTMLButtonElement>('[data-testid="confirm-cancel"]')!;
    await act(async () => { cancel.click(); });

    expect(revoke).not.toHaveBeenCalled();
  });

  it('revokes when confirmed', async () => {
    await renderPage();
    await clickText('Revoke');

    const accept = document.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]')!;
    await act(async () => { accept.click(); });

    expect(revoke).toHaveBeenCalledWith('tok', 'k1');
  });
});
