// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotifyProvider } from '@pd/ui';

const list = vi.fn();
const create = vi.fn();
const revoke = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    apiKeys: {
      list: (...a: unknown[]) => list(...a),
      create: (...a: unknown[]) => create(...a),
      revoke: (...a: unknown[]) => revoke(...a),
    },
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ accessToken: 'test-token' }),
}));

import { ApiKeysPage } from './ApiKeysPage';

const KEY = {
  id: 'k1',
  key_preview: 'pd_abc•••',
  name: 'Production Deploy',
  auto_approve: false,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  last_used_at: null,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <NotifyProvider>
        <ApiKeysPage />
      </NotifyProvider>,
    );
  });
}

const clickByLabel = async (label: string) => {
  const el = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  );
  if (!el) throw new Error(`no button labelled "${label}"`);
  await act(async () => { el.click(); });
};

// happy-dom's `.value = x` assignment on a React-controlled input is not by
// itself enough to make React's change tracking see a "real" change — go
// through the native setter (bypassing React's instance-level value patch)
// so the subsequent 'input' event carries a value React will pick up.
const typeInto = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  list.mockReset();
  create.mockReset();
  revoke.mockReset();
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('ApiKeysPage list load', () => {
  it('shows an error toast when the list fails to load, instead of a silent empty list', async () => {
    list.mockRejectedValue(new Error('boom'));
    await renderPage();

    expect(document.body.textContent).toContain('Could not load the list');
  });

  it('renders the keys with no toast when the list loads successfully', async () => {
    list.mockResolvedValue([KEY]);
    await renderPage();

    expect(document.body.textContent).toContain('Production Deploy');
    expect(document.body.textContent).not.toContain('Could not load the list');
  });
});

describe('ApiKeysPage create', () => {
  it('shows a success toast and the new key when creation succeeds', async () => {
    list.mockResolvedValue([]);
    create.mockResolvedValue({ ...KEY, key: 'pd_supersecret' });
    await renderPage();

    const input = document.querySelector<HTMLInputElement>('input[placeholder]')!;
    await typeInto(input, 'New Key');
    await clickByLabel('Create Key');

    expect(create).toHaveBeenCalledWith('test-token', 'New Key', false);
    expect(document.body.textContent).toContain('API key created');
    expect(document.body.textContent).toContain('pd_supersecret');
  });

  it('shows an error toast when creation fails, instead of failing silently', async () => {
    list.mockResolvedValue([]);
    create.mockRejectedValue(new Error('boom'));
    await renderPage();

    const input = document.querySelector<HTMLInputElement>('input[placeholder]')!;
    await typeInto(input, 'New Key');
    await clickByLabel('Create Key');

    expect(document.body.textContent).toContain('Could not create the API key');
  });
});

describe('ApiKeysPage revoke', () => {
  it('shows an error toast when revoke fails, instead of an unhandled rejection', async () => {
    list.mockResolvedValue([KEY]);
    revoke.mockRejectedValue(new Error('boom'));
    await renderPage();

    await clickByLabel('Revoke');

    expect(document.body.textContent).toContain('Could not revoke the API key');
  });
});
