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
});
