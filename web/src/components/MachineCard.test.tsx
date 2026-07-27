// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MachineCard } from './MachineCard';
import type { MachineOut } from '../api/client';

const MACHINE = {
  id: 'm-1',
  peer_id: '933146422',
  name: 'server-prod',
  os: 'linux',
  is_online: true,
  last_seen_at: null,
  created_at: '2026-07-27T10:00:00Z',
  approval_status: 'approved',
  has_saved_password: false,
} as unknown as MachineOut;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(ui: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(ui); });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
});

const nameLink = () => document.querySelector<HTMLAnchorElement>('a[href="/viewer/m-1"]');

describe('MachineCard name link', () => {
  it('renders the machine name as an anchor to its session', () => {
    render(<MachineCard machine={MACHINE} onConnect={vi.fn()} />);
    const link = nameLink();
    expect(link, 'the name must be an anchor so the browser can offer "Open in new window"').not.toBeNull();
    expect(link!.textContent).toBe('server-prod');
  });

  it('connects in-app on a plain left click', () => {
    const onConnect = vi.fn();
    render(<MachineCard machine={MACHINE} onConnect={onConnect} />);

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => { nameLink()!.dispatchEvent(ev); });

    expect(onConnect).toHaveBeenCalledWith(MACHINE);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('leaves a ctrl-click to the browser', () => {
    const onConnect = vi.fn();
    render(<MachineCard machine={MACHINE} onConnect={onConnect} />);

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    act(() => { nameLink()!.dispatchEvent(ev); });

    expect(onConnect).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('leaves a meta-click to the browser', () => {
    const onConnect = vi.fn();
    render(<MachineCard machine={MACHINE} onConnect={onConnect} />);

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
    act(() => { nameLink()!.dispatchEvent(ev); });

    expect(onConnect).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('still offers the address for an offline machine but does not connect', () => {
    // The link must exist so the URL is openable; connecting is what is blocked,
    // matching the disabled Connect button.
    const onConnect = vi.fn();
    render(<MachineCard machine={{ ...MACHINE, is_online: false }} onConnect={onConnect} />);

    expect(nameLink()).not.toBeNull();
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => { nameLink()!.dispatchEvent(ev); });

    expect(onConnect).not.toHaveBeenCalled();
  });
});
