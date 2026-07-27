// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useViewerDeepLink } from './useViewerDeepLink';
import type { MachineOut } from '../api/client';

// react-dom's act() requires this flag when @testing-library isn't in play.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MACHINE = { id: 'm-1', peer_id: '933146422', name: 'server-prod' } as unknown as MachineOut;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

interface HostProps {
  enabled: boolean;
  machineId: string | null;
  fetchMachine: (id: string) => Promise<MachineOut>;
  onMachine: (m: MachineOut) => void;
  onNotFound: () => void;
}

function Host(props: HostProps) {
  useViewerDeepLink(props);
  return null;
}

async function render(props: HostProps) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Host {...props} />); });
}

async function rerender(props: HostProps) {
  await act(async () => { root!.render(<Host {...props} />); });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

const base = (over: Partial<HostProps> = {}): HostProps => ({
  enabled: true,
  machineId: 'm-1',
  fetchMachine: vi.fn().mockResolvedValue(MACHINE),
  onMachine: vi.fn(),
  onNotFound: vi.fn(),
  ...over,
});

describe('useViewerDeepLink', () => {
  it('fetches the machine and hands it over', async () => {
    const props = base();
    await render(props);

    expect(props.fetchMachine).toHaveBeenCalledWith('m-1');
    expect(props.onMachine).toHaveBeenCalledWith(MACHINE);
    expect(props.onNotFound).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', async () => {
    const props = base({ enabled: false });
    await render(props);

    expect(props.fetchMachine).not.toHaveBeenCalled();
  });

  it('does nothing without a machine id', async () => {
    const props = base({ machineId: null });
    await render(props);

    expect(props.fetchMachine).not.toHaveBeenCalled();
  });

  it('reports a machine it cannot fetch', async () => {
    const props = base({ fetchMachine: vi.fn().mockRejectedValue(new Error('404')) });
    await render(props);

    expect(props.onNotFound).toHaveBeenCalled();
    expect(props.onMachine).not.toHaveBeenCalled();
  });

  it('resolves a given link only once across re-renders', async () => {
    // App rebuilds its callbacks every render; a resolver that keyed on them
    // would join the same session repeatedly. Asserting only the fetch count
    // would also pass for an implementation that depended on the callbacks
    // directly (the resolvedRef guard stops the extra fetch either way) —
    // asserting the callback itself was invoked exactly once is what catches
    // a callback silently swallowed after the effect re-runs.
    const fetchMachine = vi.fn().mockResolvedValue(MACHINE);
    const onMachine = vi.fn();
    await render(base({ fetchMachine, onMachine }));
    await rerender(base({ fetchMachine, onMachine }));
    await rerender(base({ fetchMachine, onMachine }));

    expect(fetchMachine).toHaveBeenCalledTimes(1);
    expect(onMachine).toHaveBeenCalledTimes(1);
  });

  it('delivers the machine exactly once under StrictMode\'s dev double-invoke', async () => {
    // React 19 dev StrictMode mounts, cleans up, and mounts again to surface
    // effects that aren't safe to remount. A resolver that gated its
    // `.then`/`.catch` on a `cancelled` local captured by the first mount was
    // marked cancelled by that mount's synthetic cleanup, so the in-flight
    // fetch's callback was suppressed once it settled and the deep link never
    // resolved — the app was stuck on the spinner in `npm run dev` even
    // though production (no StrictMode) was fine. Gating on `resolvedRef`
    // instead survives the remount because the ref, unlike the local, is
    // shared across both mounts.
    const onMachine = vi.fn();
    const props = base({ onMachine });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <StrictMode>
          <Host {...props} />
        </StrictMode>,
      );
    });

    expect(onMachine).toHaveBeenCalledTimes(1);
    expect(onMachine).toHaveBeenCalledWith(MACHINE);
  });

  it('resolves again when the address points at a different machine', async () => {
    const fetchMachine = vi.fn().mockResolvedValue(MACHINE);
    await render(base({ fetchMachine }));
    await rerender(base({ fetchMachine, machineId: 'm-2' }));

    expect(fetchMachine).toHaveBeenCalledTimes(2);
    expect(fetchMachine).toHaveBeenLastCalledWith('m-2');
  });
});
