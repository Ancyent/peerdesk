// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotifyProvider, useNotify, DEFAULT_DURATION_MS } from '@pd/ui';

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

  it('calls onExternal for each new toast', () => {
    const onExternal = vi.fn();
    let api!: ReturnType<typeof useNotify>;
    render(
      <NotifyProvider onExternal={onExternal}>
        <Trigger onReady={(a) => { api = a; }} />
      </NotifyProvider>,
    );

    act(() => { api.notify.info('Hello'); });

    expect(onExternal).toHaveBeenCalled();
    expect(onExternal.mock.calls[0][0].message).toBe('Hello');
  });

  it('throws a clear error when useNotify is used outside the provider', () => {
    expect(() => render(<Trigger onReady={() => {}} />)).toThrow(/NotifyProvider/);
  });
});
