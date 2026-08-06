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
});
