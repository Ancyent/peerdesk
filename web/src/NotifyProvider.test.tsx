// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotifyProvider, useNotify, DEFAULT_DURATION_MS, MAX_VISIBLE } from '@pd/ui';

// react-dom's act() requires this flag when @testing-library isn't in play.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  vi.useRealTimers();
});

function Trigger({ onReady }: { onReady: (api: ReturnType<typeof useNotify>) => void }) {
  const api = useNotify();
  onReady(api);
  return null;
}

describe('NotifyProvider', () => {
  it('renders a success toast with its message', () => {
    let api!: ReturnType<typeof useNotify>;
    render(<NotifyProvider><Trigger onReady={(a) => { api = a; }} /></NotifyProvider>);

    act(() => { api.notify.success('Machine deleted'); });

    expect(document.body.textContent).toContain('Machine deleted');
  });

  it('renders the detail line when given', () => {
    let api!: ReturnType<typeof useNotify>;
    render(<NotifyProvider><Trigger onReady={(a) => { api = a; }} /></NotifyProvider>);

    act(() => { api.notify.error('Delete failed', { detail: 'Machine not found' }); });

    expect(document.body.textContent).toContain('Machine not found');
  });

  it('auto-dismisses a success toast once its duration elapses', () => {
    vi.useFakeTimers();
    let api!: ReturnType<typeof useNotify>;
    render(<NotifyProvider><Trigger onReady={(a) => { api = a; }} /></NotifyProvider>);

    act(() => { api.notify.success('Saved'); });
    expect(document.body.textContent).toContain('Saved');

    act(() => { vi.advanceTimersByTime(DEFAULT_DURATION_MS.success + 500); });
    expect(document.body.textContent).not.toContain('Saved');
  });

  it('keeps an error toast on screen indefinitely', () => {
    vi.useFakeTimers();
    let api!: ReturnType<typeof useNotify>;
    render(<NotifyProvider><Trigger onReady={(a) => { api = a; }} /></NotifyProvider>);

    act(() => { api.notify.error('Boom'); });
    act(() => { vi.advanceTimersByTime(600_000); });

    expect(document.body.textContent).toContain('Boom');
  });

  it('dismisses a toast when its close button is clicked', () => {
    let api!: ReturnType<typeof useNotify>;
    render(<NotifyProvider><Trigger onReady={(a) => { api = a; }} /></NotifyProvider>);

    act(() => { api.notify.error('Boom'); });
    const close = document.querySelector<HTMLButtonElement>('[data-testid="toast-close"]')!;
    act(() => { close.click(); });

    expect(document.body.textContent).not.toContain('Boom');
  });

  it('marks the error region assertive for screen readers', () => {
    let api!: ReturnType<typeof useNotify>;
    render(<NotifyProvider><Trigger onReady={(a) => { api = a; }} /></NotifyProvider>);

    act(() => { api.notify.error('Boom'); });
    const toast = document.querySelector('[data-testid="toast"]')!;

    expect(toast.getAttribute('aria-live')).toBe('assertive');
  });

  it('calls onExternal exactly once for one new toast, even under StrictMode double-invocation', () => {
    const onExternal = vi.fn();
    let api!: ReturnType<typeof useNotify>;
    render(
      <StrictMode>
        <NotifyProvider onExternal={onExternal}>
          <Trigger onReady={(a) => { api = a; }} />
        </NotifyProvider>
      </StrictMode>,
    );

    act(() => { api.notify.info('Hello'); });

    expect(onExternal).toHaveBeenCalledTimes(1);
    expect(onExternal.mock.calls[0][0].message).toBe('Hello');
  });

  it('does not call onExternal again when a message dedups into an existing toast', () => {
    const onExternal = vi.fn();
    let api!: ReturnType<typeof useNotify>;
    render(
      <NotifyProvider onExternal={onExternal}>
        <Trigger onReady={(a) => { api = a; }} />
      </NotifyProvider>,
    );

    act(() => { api.notify.info('Hello'); });
    act(() => { api.notify.info('Hello'); });

    expect(onExternal).toHaveBeenCalledTimes(1);
  });

  it('pauses auto-dismiss while the toast stack is hovered, and resumes when the mouse leaves', () => {
    vi.useFakeTimers();
    let api!: ReturnType<typeof useNotify>;
    render(<NotifyProvider><Trigger onReady={(a) => { api = a; }} /></NotifyProvider>);

    act(() => { api.notify.success('Saved'); });
    const host = document.querySelector<HTMLDivElement>('[data-testid="toast-host"]')!;

    act(() => {
      host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    });
    act(() => { vi.advanceTimersByTime(DEFAULT_DURATION_MS.success + 500); });
    expect(document.body.textContent).toContain('Saved');

    act(() => {
      host.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true }));
    });
    act(() => { vi.advanceTimersByTime(DEFAULT_DURATION_MS.success + 500); });
    expect(document.body.textContent).not.toContain('Saved');
  });

  it('keeps auto-dismissing new toasts after the last toast is dismissed via its close button (regression: pause must not latch on)', () => {
    vi.useFakeTimers();
    let api!: ReturnType<typeof useNotify>;
    render(<NotifyProvider><Trigger onReady={(a) => { api = a; }} /></NotifyProvider>);

    act(() => { api.notify.error('Boom'); });
    const close = document.querySelector<HTMLButtonElement>('[data-testid="toast-close"]')!;
    // Clicking a close button focuses it first in a real browser — this is
    // the normal dismissal path, not an edge case.
    act(() => { close.focus(); });
    act(() => { close.click(); });
    expect(document.body.textContent).not.toContain('Boom');

    act(() => { api.notify.success('Saved'); });
    expect(document.body.textContent).toContain('Saved');

    act(() => { vi.advanceTimersByTime(DEFAULT_DURATION_MS.success + 500); });
    expect(document.body.textContent).not.toContain('Saved');
  });

  it('does not resume while focus remains inside the host, even after the mouse leaves (regression: hover and focus are independent pause channels)', () => {
    vi.useFakeTimers();
    let api!: ReturnType<typeof useNotify>;
    render(<NotifyProvider><Trigger onReady={(a) => { api = a; }} /></NotifyProvider>);

    act(() => { api.notify.success('Saved'); });
    const host = document.querySelector<HTMLDivElement>('[data-testid="toast-host"]')!;
    const close = document.querySelector<HTMLButtonElement>('[data-testid="toast-close"]')!;

    // Hover the stack, then tab focus onto the close button while still
    // hovering — mirrors a keyboard user reading a toast they moused onto.
    act(() => {
      host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    });
    act(() => { close.focus(); });

    // Move the mouse off the stack. Focus is still inside the host, so the
    // toast must stay paused — this is the bug: a single shared boolean
    // would let mouseleave resume the timer out from under the focused
    // close button.
    act(() => {
      host.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true }));
    });
    act(() => { vi.advanceTimersByTime(DEFAULT_DURATION_MS.success + 500); });
    expect(document.body.textContent).toContain('Saved');

    // Focus leaving too (and no hover) finally lets it resume and expire.
    act(() => { close.blur(); });
    act(() => { vi.advanceTimersByTime(DEFAULT_DURATION_MS.success + 500); });
    expect(document.body.textContent).not.toContain('Saved');
  });

  it('keeps auto-dismissing a new toast after the hover flag is left set by a close with no mouseleave (regression: hover must not latch)', () => {
    // Real browsers do not reliably fire mouseleave/mouseout when a toast
    // disappears out from under a stationary cursor (hit-testing is
    // pointer-movement-driven, not layout-change-driven) — the same
    // structural gap that blur/focusout has on removal. happy-dom has no
    // layout or hit-testing engine at all, so it can't reproduce that
    // failure organically; this test simulates it directly by firing
    // mouseenter on the host and dismissing the last toast via its close
    // button while deliberately never firing mouseleave/mouseout, which is
    // exactly the event sequence the real browser produces in the failing
    // case. A pass here is not proof the real-browser bug is fixed by
    // itself — it proves the app doesn't depend on mouseleave firing to
    // heal, which is the actual fix.
    vi.useFakeTimers();
    let api!: ReturnType<typeof useNotify>;
    render(<NotifyProvider><Trigger onReady={(a) => { api = a; }} /></NotifyProvider>);

    act(() => { api.notify.error('Boom'); });
    const host = document.querySelector<HTMLDivElement>('[data-testid="toast-host"]')!;
    const close = document.querySelector<HTMLButtonElement>('[data-testid="toast-close"]')!;

    act(() => {
      host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    });
    // Dismiss the only toast via its close button. No mouseleave/mouseout
    // is ever fired — mirrors the real browser's missing event.
    act(() => { close.click(); });
    expect(document.body.textContent).not.toContain('Boom');

    act(() => { api.notify.success('Saved'); });
    expect(document.body.textContent).toContain('Saved');

    act(() => { vi.advanceTimersByTime(DEFAULT_DURATION_MS.success + 500); });
    expect(document.body.textContent).not.toContain('Saved');
  });

  it('applies closeLabel to the close button\'s accessible name', () => {
    let api!: ReturnType<typeof useNotify>;
    render(<NotifyProvider closeLabel="Fermer"><Trigger onReady={(a) => { api = a; }} /></NotifyProvider>);

    act(() => { api.notify.info('Hello'); });
    const close = document.querySelector<HTMLButtonElement>('[data-testid="toast-close"]')!;

    expect(close.getAttribute('aria-label')).toBe('Fermer');
  });

  it('calls onExternal exactly once for a toast that lands in the overflow queue', () => {
    const onExternal = vi.fn();
    let api!: ReturnType<typeof useNotify>;
    render(
      <NotifyProvider onExternal={onExternal}>
        <Trigger onReady={(a) => { api = a; }} />
      </NotifyProvider>,
    );

    act(() => {
      for (let i = 0; i < MAX_VISIBLE + 1; i++) {
        api.notify.info(`Message ${i}`);
      }
    });

    const queuedCall = onExternal.mock.calls.find(([toast]) => toast.message === `Message ${MAX_VISIBLE}`);
    expect(queuedCall).toBeDefined();
    expect(onExternal.mock.calls.filter(([toast]) => toast.message === `Message ${MAX_VISIBLE}`)).toHaveLength(1);
    expect(onExternal).toHaveBeenCalledTimes(MAX_VISIBLE + 1);
  });

  it('always renders the toast host container, even with zero toasts', () => {
    render(<NotifyProvider><Trigger onReady={() => {}} /></NotifyProvider>);

    expect(document.querySelector('[data-testid="toast-host"]')).not.toBeNull();
  });

  it('throws a clear error when useNotify is used outside the provider', () => {
    expect(() => render(<Trigger onReady={() => {}} />)).toThrow(/NotifyProvider/);
  });
});
