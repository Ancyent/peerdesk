// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotifyProvider, ConfirmProvider } from '@pd/ui';

const list = vi.fn();
const listByStatus = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    machines: {
      list: (...a: unknown[]) => list(...a),
      listByStatus: (...a: unknown[]) => listByStatus(...a),
      remove: vi.fn(), approve: vi.fn(), deny: vi.fn(), clearSavedPassword: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ accessToken: 'tok' }) }));

import { MachinesPage } from './MachinesPage';

const base = {
  os: 'linux', is_online: false, last_seen_at: null, created_at: '2026-07-27T10:00:00Z',
  approval_status: 'approved', has_saved_password: false,
};
const MACHINES = [
  { ...base, id: 'm1', peer_id: '111111111', name: 'on-key-a', api_key_id: 'ka' },
  { ...base, id: 'm2', peer_id: '222222222', name: 'on-key-b', api_key_id: 'kb' },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderPage(filterKeyId?: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <NotifyProvider><ConfirmProvider>
        <MachinesPage onConnect={() => {}} filterKeyId={filterKeyId} />
      </ConfirmProvider></NotifyProvider>,
    );
  });
}

beforeEach(() => {
  list.mockResolvedValue(MACHINES);
  listByStatus.mockResolvedValue([]);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('MachinesPage key filter', () => {
  it('shows every machine when no filter is given', async () => {
    await renderPage();
    expect(document.body.textContent).toContain('on-key-a');
    expect(document.body.textContent).toContain('on-key-b');
  });

  it('shows only the machines of the filtered key', async () => {
    await renderPage('ka');
    expect(document.body.textContent).toContain('on-key-a');
    expect(document.body.textContent).not.toContain('on-key-b');
  });

  it('announces that the list is filtered', async () => {
    await renderPage('ka');
    const chip = document.querySelector('[data-testid="key-filter-chip"]');
    expect(chip, 'a filtered list must say so — otherwise it looks like the whole list').not.toBeNull();
  });

  it('shows everything again when the filter is cleared', async () => {
    await renderPage('ka');
    const clear = document.querySelector<HTMLButtonElement>('[data-testid="key-filter-clear"]')!;
    await act(async () => { clear.click(); });
    expect(document.body.textContent).toContain('on-key-b');
  });

  it('falls back to the full list when the key matches nothing', async () => {
    await renderPage('does-not-exist');
    expect(document.body.textContent).toContain('on-key-a');
    expect(document.body.textContent).toContain('on-key-b');
    expect(document.querySelector('[data-testid="toast"]')).not.toBeNull();
  });
});
