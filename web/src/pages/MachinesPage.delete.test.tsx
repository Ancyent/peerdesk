// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotifyProvider, ConfirmProvider } from '@pd/ui';

const remove = vi.fn();
const list = vi.fn();
const listByStatus = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    machines: {
      list: (...a: unknown[]) => list(...a),
      listByStatus: (...a: unknown[]) => listByStatus(...a),
      remove: (...a: unknown[]) => remove(...a),
      approve: vi.fn(),
      deny: vi.fn(),
      clearSavedPassword: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ accessToken: 'test-token' }),
}));

import { MachinesPage } from './MachinesPage';

const MACHINE = {
  id: 'm1',
  name: 'srv-01',
  peer_id: 'PD-000-111',
  approval_status: 'approved',
  is_online: false,
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
          <MachinesPage onConnect={() => {}} />
        </ConfirmProvider>
      </NotifyProvider>,
    );
  });
}

// Matches either the visible text of a button (e.g. the confirm dialog's
// "Delete" / "Cancel" actions, whose text is the translated label) or its
// accessible name via aria-label (the machine card's delete control is an
// icon-only button — "···" — labelled "Delete machine" for a11y, not "Delete").
const clickByLabel = async (label: string) => {
  const el = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  );
  if (!el) throw new Error(`no button labelled "${label}"`);
  await act(async () => { el.click(); });
};

beforeEach(() => {
  list.mockResolvedValue([MACHINE]);
  listByStatus.mockResolvedValue([]);
  remove.mockReset();
  remove.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('MachinesPage deletion', () => {
  it('opens a confirm dialog instead of a native window.confirm', async () => {
    // happy-dom does not implement window.confirm at all, so it must be
    // stubbed before it can be spied on. If MachinesPage still called it,
    // this stub (returning false) would make the test look like a "cancel"
    // rather than crash — the assertion below is what actually catches that.
    window.confirm = () => false;
    const native = vi.spyOn(window, 'confirm');
    await renderPage();

    await clickByLabel('Delete machine');

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(native).not.toHaveBeenCalled();
  });

  it('does not call the API when the confirm is cancelled', async () => {
    await renderPage();
    await clickByLabel('Delete machine');

    await clickByLabel('Cancel');

    expect(remove).not.toHaveBeenCalled();
  });

  it('calls the API and shows a success toast when confirmed', async () => {
    await renderPage();
    await clickByLabel('Delete machine');

    const accept = document.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]')!;
    await act(async () => { accept.click(); });

    expect(remove).toHaveBeenCalledWith('test-token', 'm1');
    expect(document.body.textContent).toContain('Machine deleted');
  });

  it('shows an error toast when the delete fails, instead of failing silently', async () => {
    remove.mockRejectedValue(new Error('boom'));
    await renderPage();
    await clickByLabel('Delete machine');

    const accept = document.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]')!;
    await act(async () => { accept.click(); });

    expect(document.body.textContent).toContain('Could not delete the machine');
  });
});
