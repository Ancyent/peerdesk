// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRoute } from './useRoute';

// react-dom's act() requires this flag when @testing-library isn't in play.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Exposes `navigate` as a couple of buttons so tests can drive it like a
 *  real caller (e.g. the sidebar's `go('machines')`) without reaching into
 *  the hook's internals. */
function Harness() {
  const navigate = useRoute(() => {});
  return (
    <>
      <button data-testid="go-machines" onClick={() => navigate('machines', null)}>machines</button>
      <button data-testid="go-downloads-windows" onClick={() => navigate('downloads', 'windows')}>windows</button>
    </>
  );
}

function renderHarness() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<Harness />); });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
  document.body.innerHTML = '';
});

describe('useRoute navigate guard', () => {
  it('drops a stale query string when navigating to the page already shown', () => {
    // Deep-linked to /machines?key=ka, then the user clicks the plain
    // "Machines" sidebar link (pathFor('machines', null) === '/machines').
    // The guard must treat this as a real navigation because the query
    // string differs, not early-return and leave ?key=ka in the address bar.
    window.history.replaceState({}, '', '/machines?key=ka');
    const pushSpy = vi.spyOn(window.history, 'pushState');
    renderHarness();

    act(() => {
      container!.querySelector<HTMLButtonElement>('[data-testid="go-machines"]')!.click();
    });

    expect(pushSpy).toHaveBeenCalled();
    expect(window.location.pathname).toBe('/machines');
    expect(window.location.search).toBe('');
  });

  it('still early-returns for a true no-op navigation (same path, no query string)', () => {
    window.history.replaceState({}, '', '/machines');
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    renderHarness();

    act(() => {
      container!.querySelector<HTMLButtonElement>('[data-testid="go-machines"]')!.click();
    });

    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('still uses replaceState (not pushState) for a /downloads sub-tab change', () => {
    window.history.replaceState({}, '', '/downloads/linux');
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    renderHarness();

    act(() => {
      container!.querySelector<HTMLButtonElement>('[data-testid="go-downloads-windows"]')!.click();
    });

    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/downloads/windows');
  });
});
