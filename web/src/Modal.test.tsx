// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Modal } from '@pd/ui';

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

const Body = () => (
  <>
    <h2 id="t">Title</h2>
    <button>first</button>
    <button>last</button>
  </>
);

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} labelledBy="t"><Body /></Modal>);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders a labelled modal dialog when open', () => {
    render(<Modal open onClose={() => {}} labelledBy="t"><Body /></Modal>);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('t');
  });

  it('moves focus into the dialog on open', () => {
    render(<Modal open onClose={() => {}} labelledBy="t"><Body /></Modal>);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('restores focus to the previously focused element on close', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    render(<Modal open onClose={() => {}} labelledBy="t"><Body /></Modal>);
    act(() => { root!.render(<Modal open={false} onClose={() => {}} labelledBy="t"><Body /></Modal>); });

    expect(document.activeElement).toBe(outside);
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} labelledBy="t"><Body /></Modal>);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the overlay itself is clicked', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} labelledBy="t"><Body /></Modal>);
    const overlay = document.querySelector<HTMLDivElement>('[data-testid="modal-overlay"]')!;

    act(() => { overlay.click(); });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when the dialog body is clicked', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} labelledBy="t"><Body /></Modal>);
    const dialog = document.querySelector<HTMLDivElement>('[role="dialog"]')!;

    act(() => { dialog.click(); });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('wraps Tab from the last focusable back to the first', () => {
    render(<Modal open onClose={() => {}} labelledBy="t"><Body /></Modal>);
    const dialog = document.querySelector<HTMLDivElement>('[role="dialog"]')!;
    const buttons = dialog.querySelectorAll('button');
    const first = buttons[0] as HTMLButtonElement;
    const last = buttons[buttons.length - 1] as HTMLButtonElement;

    last.focus();
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });

    expect(document.activeElement).toBe(first);
  });

  it('locks and restores body scroll', () => {
    render(<Modal open onClose={() => {}} labelledBy="t"><Body /></Modal>);
    expect(document.body.style.overflow).toBe('hidden');

    act(() => { root!.render(<Modal open={false} onClose={() => {}} labelledBy="t"><Body /></Modal>); });
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('does not call .focus() on the previously-focused element when it was removed from the DOM before close', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    render(<Modal open onClose={() => {}} labelledBy="t"><Body /></Modal>);
    outside.remove();

    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      act(() => { root!.render(<Modal open={false} onClose={() => {}} labelledBy="t"><Body /></Modal>); });

      // Proves the isConnected guard's branch actually ran: .focus() must
      // never be invoked with `outside` as `this`, since it's detached.
      expect(focusSpy.mock.instances).not.toContain(outside);
    } finally {
      focusSpy.mockRestore();
    }
  });

  it('keeps focus on the dialog when Tab is pressed and there are no focusable descendants', () => {
    render(<Modal open onClose={() => {}} labelledBy="t"><h2 id="t">Title only</h2></Modal>);
    const dialog = document.querySelector<HTMLDivElement>('[role="dialog"]')!;
    expect(document.activeElement).toBe(dialog);

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { dialog.dispatchEvent(event); });

    // The browser's default Tab behavior must be suppressed, or focus would
    // escape the dialog (it's outside the tab order via tabIndex={-1}).
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);
  });

  it('wraps Shift+Tab from the first focusable back to the last', () => {
    render(<Modal open onClose={() => {}} labelledBy="t"><Body /></Modal>);
    const dialog = document.querySelector<HTMLDivElement>('[role="dialog"]')!;
    const buttons = dialog.querySelectorAll('button');
    const first = buttons[0] as HTMLButtonElement;
    const last = buttons[buttons.length - 1] as HTMLButtonElement;

    first.focus();
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    });

    expect(document.activeElement).toBe(last);
  });

  it('keeps body scroll locked while a second modal is still open after the first closes, and restores it once both are closed', () => {
    const containerA = document.createElement('div');
    document.body.appendChild(containerA);
    const rootA = createRoot(containerA);

    const containerB = document.createElement('div');
    document.body.appendChild(containerB);
    const rootB = createRoot(containerB);

    act(() => {
      rootA.render(<Modal open onClose={() => {}} labelledBy="tA"><h2 id="tA">A</h2><button>a</button></Modal>);
    });
    expect(document.body.style.overflow).toBe('hidden');

    act(() => {
      rootB.render(<Modal open onClose={() => {}} labelledBy="tB"><h2 id="tB">B</h2><button>b</button></Modal>);
    });
    expect(document.body.style.overflow).toBe('hidden');

    // Close A while B is still open — scroll must remain locked.
    act(() => {
      rootA.render(<Modal open={false} onClose={() => {}} labelledBy="tA"><h2 id="tA">A</h2><button>a</button></Modal>);
    });
    expect(document.body.style.overflow).toBe('hidden');

    // Now close B — the lock should finally release.
    act(() => {
      rootB.render(<Modal open={false} onClose={() => {}} labelledBy="tB"><h2 id="tB">B</h2><button>b</button></Modal>);
    });
    expect(document.body.style.overflow).not.toBe('hidden');

    act(() => { rootA.unmount(); });
    act(() => { rootB.unmount(); });
    containerA.remove();
    containerB.remove();
  });

  it('does not close when a drag starts inside the dialog and is released over the overlay', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} labelledBy="t"><Body /></Modal>);
    const dialog = document.querySelector<HTMLDivElement>('[role="dialog"]')!;
    const overlay = document.querySelector<HTMLDivElement>('[data-testid="modal-overlay"]')!;

    // Simulate: mousedown inside the dialog (e.g. starting a text
    // selection), then the click lands on the overlay because mouseup
    // happened outside — the browser resolves the click's target to the
    // nearest common ancestor of mousedown/mouseup targets.
    act(() => {
      dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    act(() => {
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('still calls onClose for a plain overlay click with no prior mousedown', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} labelledBy="t"><Body /></Modal>);
    const overlay = document.querySelector<HTMLDivElement>('[data-testid="modal-overlay"]')!;

    act(() => { overlay.click(); });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
