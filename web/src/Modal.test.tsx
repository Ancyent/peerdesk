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

  it('does not throw when the previously focused element is removed before close', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    render(<Modal open onClose={() => {}} labelledBy="t"><Body /></Modal>);
    outside.remove();

    expect(() => {
      act(() => { root!.render(<Modal open={false} onClose={() => {}} labelledBy="t"><Body /></Modal>); });
    }).not.toThrow();

    expect(document.activeElement).not.toBe(outside);
    expect(document.body.contains(document.activeElement)).toBe(true);
  });
});
