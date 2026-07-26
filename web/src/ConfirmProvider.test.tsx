// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfirmProvider, useConfirm, type ConfirmOptions } from '@pd/ui';

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

const OPTS: ConfirmOptions = {
  title: 'Delete machine?',
  message: 'This cannot be undone.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
};

function Trigger({ onReady }: { onReady: (fn: (o: ConfirmOptions) => Promise<boolean>) => void }) {
  const fn = useConfirm();
  onReady(fn);
  return null;
}

const click = (testid: string) => {
  const el = document.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!;
  act(() => { el.click(); });
};

describe('useConfirm', () => {
  it('shows nothing until confirm() is called', () => {
    render(<ConfirmProvider><Trigger onReady={() => {}} /></ConfirmProvider>);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the title and message', async () => {
    let confirmFn!: (o: ConfirmOptions) => Promise<boolean>;
    render(<ConfirmProvider><Trigger onReady={(fn) => { confirmFn = fn; }} /></ConfirmProvider>);
    let p!: Promise<boolean>;
    act(() => { p = confirmFn(OPTS); });

    expect(document.body.textContent).toContain('Delete machine?');
    expect(document.body.textContent).toContain('This cannot be undone.');

    click('confirm-cancel');
    await p;
  });

  it('resolves true when confirmed', async () => {
    let confirmFn!: (o: ConfirmOptions) => Promise<boolean>;
    render(<ConfirmProvider><Trigger onReady={(fn) => { confirmFn = fn; }} /></ConfirmProvider>);
    let p!: Promise<boolean>;
    act(() => { p = confirmFn(OPTS); });

    click('confirm-accept');

    await expect(p).resolves.toBe(true);
  });

  it('resolves false when cancelled', async () => {
    let confirmFn!: (o: ConfirmOptions) => Promise<boolean>;
    render(<ConfirmProvider><Trigger onReady={(fn) => { confirmFn = fn; }} /></ConfirmProvider>);
    let p!: Promise<boolean>;
    act(() => { p = confirmFn(OPTS); });

    click('confirm-cancel');

    await expect(p).resolves.toBe(false);
  });

  it('resolves false on Escape', async () => {
    let confirmFn!: (o: ConfirmOptions) => Promise<boolean>;
    render(<ConfirmProvider><Trigger onReady={(fn) => { confirmFn = fn; }} /></ConfirmProvider>);
    let p!: Promise<boolean>;
    act(() => { p = confirmFn(OPTS); });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    await expect(p).resolves.toBe(false);
  });

  it('closes the dialog after settling', async () => {
    let confirmFn!: (o: ConfirmOptions) => Promise<boolean>;
    render(<ConfirmProvider><Trigger onReady={(fn) => { confirmFn = fn; }} /></ConfirmProvider>);
    let p!: Promise<boolean>;
    act(() => { p = confirmFn(OPTS); });
    click('confirm-accept');
    await p;

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('focuses Cancel first for a danger confirm so a stray Enter destroys nothing', () => {
    let confirmFn!: (o: ConfirmOptions) => Promise<boolean>;
    render(<ConfirmProvider><Trigger onReady={(fn) => { confirmFn = fn; }} /></ConfirmProvider>);
    act(() => { void confirmFn({ ...OPTS, tone: 'danger' }); });

    expect(document.activeElement?.getAttribute('data-testid')).toBe('confirm-cancel');
  });

  it('resolves a second concurrent confirm to false instead of stacking dialogs', async () => {
    let confirmFn!: (o: ConfirmOptions) => Promise<boolean>;
    render(<ConfirmProvider><Trigger onReady={(fn) => { confirmFn = fn; }} /></ConfirmProvider>);
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => { first = confirmFn(OPTS); });
    act(() => { second = confirmFn(OPTS); });

    await expect(second).resolves.toBe(false);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);

    click('confirm-cancel');
    await first;
  });

  it('throws a clear error when useConfirm is used outside the provider', () => {
    expect(() => render(<Trigger onReady={() => {}} />)).toThrow(/ConfirmProvider/);
  });
});
