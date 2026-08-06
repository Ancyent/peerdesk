// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OverlayControls } from './OverlayControls';

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

// The file-transfer button has no `title` — it renders its label as text via
// `t('viewer:controls.files')`, which the mocked `t` above returns verbatim.
const filesButton = () =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('viewer:controls.files')) ?? null;

const byLabel = (key: string) =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(key)) ?? null;
const ctrlAltDelButton = () => byLabel('viewer:controls.ctrlAltDel');
const viewOnlyButton = () => byLabel('viewer:controls.viewOnly');
const inputDeniedBadge = () =>
  Array.from(document.querySelectorAll('div')).find(d => d.textContent?.trim() === '🔒 viewer:controls.inputDisabled') ?? null;

// OverlayControls starts collapsed (only the drag handle, open, fullscreen
// and disconnect icons render); the file-transfer button only exists in the
// expanded panel, so every test must open it first.
function openPanel() {
  const openBtn = document.querySelector<HTMLButtonElement>('button[title="viewer:controls.open"]');
  act(() => { openBtn!.click(); });
}

function props(overrides: Partial<React.ComponentProps<typeof OverlayControls>> = {}) {
  return {
    peerId: '123456789',
    latencyMs: 10,
    fps: 30,
    isViewOnly: false,
    videoRef: { current: null },
    fullscreenTargetRef: { current: null },
    onDisconnect: () => {},
    onCtrlAltDel: () => {},
    onToggleViewOnly: () => {},
    onFileTransfer: () => {},
    onQualityChange: () => {},
    showStats: false,
    onToggleStats: () => {},
    showCursor: true,
    onToggleCursor: () => {},
    displays: [],
    currentDisplay: 0,
    onDisplayChange: () => {},
    ...overrides,
  };
}

describe('OverlayControls capability gating', () => {
  it('offers file transfer when the host permits it', () => {
    render(<OverlayControls {...props({ canFileTransfer: true })} />);
    openPanel();
    expect(filesButton()).not.toBeNull();
  });

  it('does not offer file transfer when the host denies it', () => {
    render(<OverlayControls {...props({ canFileTransfer: false })} />);
    openPanel();
    expect(filesButton()).toBeNull();
  });

  it('offers file transfer when the host said nothing', () => {
    // An agent older than this feature sends no `capabilities` message. It
    // still permits everything, so the viewer must not hide a control merely
    // because it was never told about it.
    render(<OverlayControls {...props({ canFileTransfer: undefined })} />);
    openPanel();
    expect(filesButton()).not.toBeNull();
  });

  it('offers Ctrl+Alt+Del and the view-only toggle when input is permitted', () => {
    render(<OverlayControls {...props({ canInput: true })} />);
    openPanel();
    expect(ctrlAltDelButton()).not.toBeNull();
    expect(viewOnlyButton()).not.toBeNull();
    expect(inputDeniedBadge()).toBeNull();
  });

  it('hides the controls that need input, and says why, when the host denies it', () => {
    // Ctrl+Alt+Del sends six key events the agent throws away, and the
    // view-only toggle claims to control something the host has already
    // decided. Neither is honest with input denied.
    render(<OverlayControls {...props({ canInput: false })} />);
    openPanel();
    expect(ctrlAltDelButton()).toBeNull();
    expect(viewOnlyButton()).toBeNull();
    expect(inputDeniedBadge()).not.toBeNull();
  });

  it('offers them when the host said nothing', () => {
    // An agent older than this feature sends no `capabilities` message and
    // still injects input. Silence is not denial.
    render(<OverlayControls {...props({ canInput: undefined })} />);
    openPanel();
    expect(ctrlAltDelButton()).not.toBeNull();
    expect(viewOnlyButton()).not.toBeNull();
    expect(inputDeniedBadge()).toBeNull();
  });
});
