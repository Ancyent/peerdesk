// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppShell } from './AppShell';

vi.mock('../auth/useAuth', () => ({
  // AccountSwitcher (rendered inside AppShell) also calls useAuth() and
  // destructures `accounts` — it must be present or that render throws
  // before the nav assertions ever run.
  useAuth: () => ({
    user: { email: 'a@b.com', name: 'A' }, logout: vi.fn(), role: 'admin',
    accounts: [], activeAccountId: null, switchAccount: vi.fn(),
  }),
}));
vi.mock('../branding/BrandingContext', () => ({
  useBrandingContext: () => ({ brand_name: 'PeerDesk', logo_data_url: null }),
}));

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

const shell = (onNavigate = vi.fn()) => (
  <AppShell page="machines" onNavigate={onNavigate}><div /></AppShell>
);

describe('AppShell navigation', () => {
  it('renders nav items as anchors with real hrefs', () => {
    render(shell());
    const link = document.querySelector<HTMLAnchorElement>('a[href="/api-keys"]');
    expect(link, 'nav items must be anchors so the browser can open them in a new tab').not.toBeNull();
  });

  it('routes in-app on a plain left click', () => {
    const onNavigate = vi.fn();
    render(shell(onNavigate));
    const link = document.querySelector<HTMLAnchorElement>('a[href="/api-keys"]')!;

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => { link.dispatchEvent(ev); });

    expect(onNavigate).toHaveBeenCalledWith('api-keys');
    expect(ev.defaultPrevented).toBe(true);
  });

  it('leaves a ctrl-click to the browser', () => {
    const onNavigate = vi.fn();
    render(shell(onNavigate));
    const link = document.querySelector<HTMLAnchorElement>('a[href="/api-keys"]')!;

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    act(() => { link.dispatchEvent(ev); });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('leaves a meta-click to the browser', () => {
    const onNavigate = vi.fn();
    render(shell(onNavigate));
    const link = document.querySelector<HTMLAnchorElement>('a[href="/api-keys"]')!;

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
    act(() => { link.dispatchEvent(ev); });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('leaves a shift-click to the browser', () => {
    const onNavigate = vi.fn();
    render(shell(onNavigate));
    const link = document.querySelector<HTMLAnchorElement>('a[href="/api-keys"]')!;

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, shiftKey: true });
    act(() => { link.dispatchEvent(ev); });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('leaves an alt-click to the browser', () => {
    const onNavigate = vi.fn();
    render(shell(onNavigate));
    const link = document.querySelector<HTMLAnchorElement>('a[href="/api-keys"]')!;

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, altKey: true });
    act(() => { link.dispatchEvent(ev); });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('leaves a non-left-button click to the browser', () => {
    const onNavigate = vi.fn();
    render(shell(onNavigate));
    const link = document.querySelector<HTMLAnchorElement>('a[href="/api-keys"]')!;

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 });
    act(() => { link.dispatchEvent(ev); });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('does not re-route an already-prevented click', () => {
    const onNavigate = vi.fn();
    render(shell(onNavigate));
    const link = document.querySelector<HTMLAnchorElement>('a[href="/api-keys"]')!;

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    ev.preventDefault();
    act(() => { link.dispatchEvent(ev); });

    expect(onNavigate).not.toHaveBeenCalled();
  });
});
