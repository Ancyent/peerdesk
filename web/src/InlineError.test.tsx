// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { InlineError } from '@pd/ui';

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
});

describe('InlineError', () => {
  it('renders the message', () => {
    render(<InlineError>Invalid credentials</InlineError>);
    expect(container!.textContent).toBe('Invalid credentials');
  });

  it('renders nothing when there is no message', () => {
    render(<InlineError>{undefined}</InlineError>);
    expect(container!.innerHTML).toBe('');
  });

  it('renders nothing for an empty string', () => {
    render(<InlineError>{''}</InlineError>);
    expect(container!.innerHTML).toBe('');
  });

  it('exposes the message to assistive tech as an alert', () => {
    render(<InlineError>Boom</InlineError>);
    expect(container!.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('uses default font size of 14 when size prop is not provided', () => {
    render(<InlineError>Default size</InlineError>);
    const element = container!.querySelector('[role="alert"]') as HTMLElement;
    expect(element).not.toBeNull();
    const computedStyle = window.getComputedStyle(element);
    expect(computedStyle.fontSize).toBe('14px');
  });

  it('respects explicit size prop', () => {
    render(<InlineError size={12}>Custom size 12</InlineError>);
    const element = container!.querySelector('[role="alert"]') as HTMLElement;
    expect(element).not.toBeNull();
    const computedStyle = window.getComputedStyle(element);
    expect(computedStyle.fontSize).toBe('12px');
  });

  it('respects size prop when set to 13', () => {
    render(<InlineError size={13}>Custom size 13</InlineError>);
    const element = container!.querySelector('[role="alert"]') as HTMLElement;
    expect(element).not.toBeNull();
    const computedStyle = window.getComputedStyle(element);
    expect(computedStyle.fontSize).toBe('13px');
  });
});
