// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PermissionsSettings } from './PermissionsSettings';
import { DEFAULT_SETTINGS } from '../types';

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

// Plain DOM text lookup, matching the repo's testing-library-free pattern.
function findByText(text: string): Element | null {
  const all = document.body.querySelectorAll('*');
  for (const el of Array.from(all)) {
    if (el.children.length === 0 && el.textContent === text) return el;
  }
  return null;
}

function findAllByText(text: string): Element[] {
  const all = document.body.querySelectorAll('*');
  return Array.from(all).filter(el => el.children.length === 0 && el.textContent === text);
}

describe('PermissionsSettings', () => {
  it('drops the two toggles nothing implements', () => {
    render(<PermissionsSettings settings={DEFAULT_SETTINGS} updateSetting={() => {}} />);
    expect(findByText('settings:permissions.items.remoteRestart.label')).toBeNull();
    expect(findByText('settings:permissions.items.blockUserInput.label')).toBeNull();
  });

  it('keeps the three that are enforced', () => {
    render(<PermissionsSettings settings={DEFAULT_SETTINGS} updateSetting={() => {}} />);
    for (const key of ['keyboardMouse', 'fileTransfer', 'terminal']) {
      expect(findByText(`settings:permissions.items.${key}.label`)).not.toBeNull();
    }
  });

  it('shows clipboard and audio, but marks them not yet enforced', () => {
    render(<PermissionsSettings settings={DEFAULT_SETTINGS} updateSetting={() => {}} />);
    expect(findByText('settings:permissions.items.clipboard.label')).not.toBeNull();
    expect(findByText('settings:permissions.items.audio.label')).not.toBeNull();
    expect(findAllByText('settings:permissions.notYetActive')).toHaveLength(2);
  });

  it('does not fire updateSetting when a pending toggle is clicked', () => {
    const updateSetting = vi.fn();
    render(<PermissionsSettings settings={DEFAULT_SETTINGS} updateSetting={updateSetting} />);
    const clipboardLabel = findByText('settings:permissions.items.clipboard.label')!;
    // clipboardLabel is itself a <div>, so it is its own label-wrapper's only
    // text child: go up one level for the wrapper, one more for the row.
    const row = clipboardLabel.parentElement!.parentElement!;
    const toggle = row.lastElementChild as HTMLElement;
    act(() => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(updateSetting).not.toHaveBeenCalled();
  });
});
