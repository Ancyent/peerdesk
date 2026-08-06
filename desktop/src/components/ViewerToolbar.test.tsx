// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ViewerToolbar } from './ViewerToolbar';

// react-dom's act() requires this flag when @testing-library isn't in play.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
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

function props(overrides: Partial<React.ComponentProps<typeof ViewerToolbar>> = {}) {
  return {
    peerId: '123456789',
    onFullscreen: () => {},
    onClipboardSync: () => {},
    onFiles: () => {},
    onQualityChange: () => {},
    onToggleStats: () => {},
    showCursor: true,
    onToggleCursor: () => {},
    onDisconnect: () => {},
    ...overrides,
  };
}

const filesButton = () => document.querySelector<HTMLButtonElement>('button[title="viewer:toolbar.filesTitle"]');
const inputDeniedBadge = () => document.querySelector('[title="viewer:toolbar.inputDisabledTitle"]');

describe('ViewerToolbar capability gating', () => {
  it('offers files when the host permits it', () => {
    render(<ViewerToolbar {...props({ canFileTransfer: true })} />);
    expect(filesButton()).not.toBeNull();
  });

  it('does not offer files when the host denies it', () => {
    render(<ViewerToolbar {...props({ canFileTransfer: false })} />);
    expect(filesButton()).toBeNull();
  });

  it('offers files when the host said nothing', () => {
    // An agent older than this feature sends no `capabilities` message. It
    // still permits everything, so the viewer must not hide a control merely
    // because it was never told about it.
    render(<ViewerToolbar {...props({ canFileTransfer: undefined })} />);
    expect(filesButton()).not.toBeNull();
  });

  it('says so when the host has input disabled', () => {
    // Without this the viewer looks fully interactive and every keystroke
    // vanishes at the agent with no explanation.
    render(<ViewerToolbar {...props({ canInput: false })} />);
    expect(inputDeniedBadge()).not.toBeNull();
  });

  it('says nothing when the host permits input', () => {
    render(<ViewerToolbar {...props({ canInput: true })} />);
    expect(inputDeniedBadge()).toBeNull();
  });

  it('says nothing when the host said nothing', () => {
    // An agent older than this feature sends no `capabilities` message and
    // still injects input. Silence is not denial.
    render(<ViewerToolbar {...props({ canInput: undefined })} />);
    expect(inputDeniedBadge()).toBeNull();
  });
});
