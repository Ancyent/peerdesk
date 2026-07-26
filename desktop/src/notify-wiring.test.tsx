// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotifyProvider, useNotify } from '@pd/ui';
import i18n from './i18n';

// react-dom's act() requires this flag when @testing-library isn't in play.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
});

function Trigger() {
  const { notify } = useNotify();
  return <button onClick={() => notify.error(i18n.t('notify:logsFailed'))}>go</button>;
}

describe('desktop notifications', () => {
  it('renders a translated error toast', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root!.render(<NotifyProvider><Trigger /></NotifyProvider>); });

    act(() => { container!.querySelector('button')!.click(); });

    expect(document.body.textContent).toContain('Could not load the agent log');
  });
});
