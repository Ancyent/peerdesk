// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { NotifyProvider } from '@pd/ui';
import '../i18n';
import { ViewerTab } from './ViewerTab';
import type { Session } from '../types';

// react-dom's act() requires this flag when @testing-library isn't in play.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The agent-driven clipboard callback is the second argument useWebRTC is
// constructed with (see ViewerTab.tsx). Capturing it here lets the test fire
// "remote clipboard changed" events directly, without simulating a real
// RTCDataChannel or RTCPeerConnection (unavailable in happy-dom anyway).
// A hoisted ref-object is required because vi.mock factories are hoisted
// above ordinary `let`/`const` declarations.
const capturedOnClipboard = vi.hoisted(() => ({ current: undefined as ((text: string) => void) | undefined }));
// Reaching the connected view needs a stream from useWebRTC and a
// `capabilities` message from signaling, so both ends are captured here too.
const fakeStream = vi.hoisted(() => ({ current: null as MediaStream | null }));
const sendInput = vi.hoisted(() => ({ current: vi.fn() }));
const capturedOnSignal = vi.hoisted(() => ({ current: undefined as ((m: unknown) => void) | undefined }));

vi.mock('../hooks/useWebRTC', () => ({
  useWebRTC: (_send: unknown, onClipboardFromAgent?: (text: string) => void) => {
    capturedOnClipboard.current = onClipboardFromAgent;
    return {
      startOffer: vi.fn(),
      stream: fakeStream.current,
      cursor: null,
      handleAnswer: vi.fn(),
      handleIceCandidate: vi.fn(),
      sendInput: sendInput.current,
      sendClipboard: vi.fn(),
      setQuality: vi.fn(),
      getPc: () => null,
      disconnect: vi.fn(),
      getFtChannel: () => null,
    };
  },
}));

// Avoid opening a real WebSocket to a fake signaling URL; these tests care
// about the clipboard-write guard and the capability gate, not negotiation.
vi.mock('../hooks/useSignaling', () => ({
  useSignaling: (_url: string, onMessage: (m: unknown) => void) => {
    capturedOnSignal.current = onMessage;
    return { send: vi.fn() };
  },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const session: Session = { id: '123456789', state: 'connecting' };

/** Flush both the pending microtask queue (so writeText's .then/.catch
 *  settle) and, when given a positive duration, real wall-clock time so
 *  ToastHost's dedup window (3s, see shared/ui/toastStore.ts) can be
 *  crossed for real. Wrapped in an async act() so NotifyProvider's
 *  interval-driven setState calls firing during the wait are not reported
 *  as updates outside of act(). */
function flush(ms = 0) {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <NotifyProvider>
        <ViewerTab session={session} signalingUrl="ws://example.invalid" onStateChange={() => {}} onClose={() => {}} />
      </NotifyProvider>,
    );
  });
}

function toasts() {
  return document.querySelectorAll('[data-testid="toast"]');
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
  capturedOnClipboard.current = undefined;
  capturedOnSignal.current = undefined;
  fakeStream.current = null;
  sendInput.current = vi.fn();
  vi.restoreAllMocks();
});

describe('ViewerTab reaching the connected view', () => {
  it('shows the remote screen once the stream arrives', async () => {
    // The <video> only renders when viewState is 'connected', and viewState
    // only became 'connected' from an effect that required the <video> to
    // already exist. The two waited on each other, so a session that had
    // negotiated fine still died on the 15s ICE timeout.
    mount();
    await act(async () => { await capturedOnSignal.current!({ type: 'joined' }); });
    expect(container!.querySelector('video'), 'still negotiating').toBeNull();

    fakeStream.current = new MediaStream();
    // Any signaling message re-renders with the new stream, the way a real
    // ontrack-driven setState would.
    await act(async () => {
      await capturedOnSignal.current!({ type: 'capabilities', input: true, file_transfer: true, terminal: true });
    });
    expect(container!.querySelector('video'), 'the stream arriving IS the connection succeeding').not.toBeNull();
  });
});

describe('ViewerTab input capability gate', () => {
  /** Drive the component into the connected view the way signaling does. */
  async function mountConnected(capabilities: { input: boolean; file_transfer: boolean; terminal: boolean }) {
    mount();
    await act(async () => { await capturedOnSignal.current!({ type: 'joined' }); });
    fakeStream.current = new MediaStream();
    await act(async () => { await capturedOnSignal.current!({ type: 'capabilities', ...capabilities }); });
    const video = container!.querySelector('video');
    expect(video, 'the connected view must be rendered').not.toBeNull();
    return video!;
  }

  it('sends no input when the host denied it', async () => {
    // The agent drops these events anyway; sending them makes the viewer look
    // interactive while nothing happens, with no message to the user.
    const video = await mountConnected({ input: false, file_transfer: true, terminal: true });
    act(() => {
      video.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      video.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', code: 'KeyA' }));
    });
    expect(sendInput.current).not.toHaveBeenCalled();
    // ...and the cursor stops promising that clicks land.
    expect(video.style.cursor).toBe('default');
  });

  it('sends input when the host permits it', async () => {
    // The other half: a gate that refused everything would pass the test above
    // while breaking every normal session.
    const video = await mountConnected({ input: true, file_transfer: true, terminal: true });
    act(() => {
      video.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      video.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', code: 'KeyA' }));
    });
    expect(sendInput.current).toHaveBeenCalled();
    expect(video.style.cursor).toBe('crosshair');
  });

  it('sends input when the host said nothing', async () => {
    // An agent older than this feature announces no capabilities at all.
    mount();
    await act(async () => { await capturedOnSignal.current!({ type: 'joined' }); });
    fakeStream.current = new MediaStream();
    await act(async () => { await capturedOnSignal.current!({ type: 'display_list', displays: [] }); });
    const video = container!.querySelector('video')!;
    act(() => { video.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(sendInput.current).toHaveBeenCalled();
  });
});

describe('ViewerTab remote clipboard-write failures', () => {
  it('reports only the first failure, not every repeated one', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.reject(new Error('document not focused'))) },
      configurable: true,
    });

    mount();
    expect(capturedOnClipboard.current).toBeTypeOf('function');

    // First remote clipboard push: the write fails, this should be reported.
    act(() => { capturedOnClipboard.current!('first'); });
    await flush();
    expect(toasts()).toHaveLength(1);
    expect(document.body.textContent).toContain('Could not copy to the clipboard');

    // The agent polls and pushes again well outside the 3s toast dedup
    // window (shared/ui/toastStore.ts DEDUP_WINDOW_MS), the way it does in
    // production every ~500ms driven entirely by the remote side. Without a
    // one-shot guard this creates a second, undeduped, permanent error toast.
    // (4500ms, not just over 3000ms, to leave headroom against real-timer
    // jitter in the interval that ages toasts — see NotifyProvider's 250ms
    // tick in shared/ui/NotifyProvider.tsx.)
    await flush(4500);
    act(() => { capturedOnClipboard.current!('second'); });
    await flush();

    expect(toasts()).toHaveLength(1);
  }, 20000);

  it('reports again after a success resets the guard', async () => {
    let shouldFail = true;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(() => (shouldFail ? Promise.reject(new Error('document not focused')) : Promise.resolve())),
      },
      configurable: true,
    });

    mount();

    act(() => { capturedOnClipboard.current!('first'); });
    await flush();
    expect(toasts()).toHaveLength(1);

    // Sync recovers: a successful write should clear the guard.
    shouldFail = false;
    act(() => { capturedOnClipboard.current!('recovered'); });
    await flush();
    expect(toasts()).toHaveLength(1); // success itself never toasts

    // Sync breaks again, well outside the dedup window: the user should be
    // told a second time, since this is a new outage, not a repeat of the
    // first one.
    shouldFail = true;
    await flush(4500);
    act(() => { capturedOnClipboard.current!('third'); });
    await flush();

    expect(toasts()).toHaveLength(2);
  }, 20000);
});
