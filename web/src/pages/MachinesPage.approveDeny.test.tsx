// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotifyProvider, ConfirmProvider } from '@pd/ui';

const list = vi.fn();
const listByStatus = vi.fn();
const approve = vi.fn();
const deny = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    machines: {
      list: (...a: unknown[]) => list(...a),
      listByStatus: (...a: unknown[]) => listByStatus(...a),
      approve: (...a: unknown[]) => approve(...a),
      deny: (...a: unknown[]) => deny(...a),
      remove: vi.fn(),
      clearSavedPassword: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ accessToken: 'test-token' }),
}));

import { MachinesPage } from './MachinesPage';

const PENDING_MACHINE = {
  id: 'm1',
  name: 'srv-pending',
  peer_id: 'PD-000-222',
  approval_status: 'pending',
  is_online: false,
  os: 'Linux',
  created_at: '2026-01-01T00:00:00Z',
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderPendingTab() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <NotifyProvider>
        <ConfirmProvider>
          <MachinesPage onConnect={() => {}} />
        </ConfirmProvider>
      </NotifyProvider>,
    );
  });
  const pendingTab = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim().startsWith('Pending'),
  )!;
  await act(async () => { pendingTab.click(); });
}

const clickByText = async (label: string) => {
  const el = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!el) throw new Error(`no button with text "${label}"`);
  await act(async () => { el.click(); });
};

beforeEach(() => {
  list.mockResolvedValue([]);
  listByStatus.mockResolvedValue([PENDING_MACHINE]);
  approve.mockReset();
  deny.mockReset();
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('MachinesPage approve/deny', () => {
  it('shows an error toast when approve fails, instead of failing with no feedback', async () => {
    approve.mockRejectedValue(new Error('boom'));
    await renderPendingTab();

    await clickByText('Approve');

    expect(approve).toHaveBeenCalledWith('test-token', 'm1');
    expect(document.body.textContent).toContain('Could not approve the machine');
  });

  it('shows an error toast when deny fails, instead of failing with no feedback', async () => {
    deny.mockRejectedValue(new Error('boom'));
    await renderPendingTab();

    await clickByText('Deny');

    expect(deny).toHaveBeenCalledWith('test-token', 'm1');
    expect(document.body.textContent).toContain('Could not deny the machine');
  });

  it('does not show an error toast when approve succeeds', async () => {
    approve.mockResolvedValue(undefined);
    await renderPendingTab();

    await clickByText('Approve');

    expect(document.body.textContent).not.toContain('Could not approve the machine');
  });
});
