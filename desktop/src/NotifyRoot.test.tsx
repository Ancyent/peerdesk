// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNotify } from '@pd/ui';
import i18n from './i18n';
import { NotifyRoot } from './NotifyRoot';

// react-dom's act() requires this flag when @testing-library isn't in play.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(ui: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(ui); });
}

function Trigger({ onReady }: { onReady: (api: ReturnType<typeof useNotify>) => void }) {
  const api = useNotify();
  onReady(api);
  return null;
}

afterEach(async () => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
  await i18n.changeLanguage('en');
});

describe('NotifyRoot', () => {
  it("keeps the toast close button's aria-label in sync with the active language", async () => {
    await i18n.changeLanguage('en');
    let api!: ReturnType<typeof useNotify>;
    render(<NotifyRoot><Trigger onReady={(a) => { api = a; }} /></NotifyRoot>);

    act(() => { api.notify.info('Hello'); });
    const close = () => document.querySelector<HTMLButtonElement>('[data-testid="toast-close"]')!;

    expect(close().getAttribute('aria-label')).toBe(i18n.getFixedT('en')('notify:close'));

    await act(async () => { await i18n.changeLanguage('ro'); });

    expect(close().getAttribute('aria-label')).toBe(i18n.getFixedT('ro')('notify:close'));
    expect(close().getAttribute('aria-label')).not.toBe(i18n.getFixedT('en')('notify:close'));
  });
});
