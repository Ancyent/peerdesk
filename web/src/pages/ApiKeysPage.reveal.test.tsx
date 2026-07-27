// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotifyProvider, ConfirmProvider } from '@pd/ui';

const list = vi.fn();
const reveal = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    apiKeys: {
      list: (...a: unknown[]) => list(...a),
      create: vi.fn(),
      revoke: vi.fn(),
      reveal: (...a: unknown[]) => reveal(...a),
    },
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ accessToken: 'test-token' }),
}));

import { ApiKeysPage } from './ApiKeysPage';
import { ApiError as MockApiError } from '../api/client';

const KEY = {
  id: 'k1',
  key_preview: 'pd_abc123de••••',
  name: 'Production Deploy',
  auto_approve: false,
  is_active: true,
  created_at: '2026-07-27T10:00:00Z',
  last_used_at: null,
  machine_count: 0,
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
        <ConfirmProvider>
          <ApiKeysPage />
        </ConfirmProvider>
      </NotifyProvider>,
    );
  });
}

const clickText = async (text: string) => {
  const el = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!el) throw new Error(`no button labelled "${text}"`);
  await act(async () => { el.click(); });
};

const typeInto = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  list.mockResolvedValue([KEY]);
  reveal.mockReset();
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('revealing an API key with a wrong password', () => {
  it('shows the error inline inside the modal, not as a toast', async () => {
    reveal.mockRejectedValue(new MockApiError(403, 'Invalid password'));
    await renderPage();

    await clickText('Reveal');

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    const passwordInput = dialog!.querySelector<HTMLInputElement>('input[type="password"]')!;
    await typeInto(passwordInput, 'not-my-password');
    await clickText('Show key');

    const inlineAlert = dialog!.querySelector('[role="alert"]');
    expect(inlineAlert).not.toBeNull();
    expect(inlineAlert!.textContent).toContain('Wrong password');

    expect(document.querySelector('[data-testid="toast"]')).toBeNull();
  });
});
