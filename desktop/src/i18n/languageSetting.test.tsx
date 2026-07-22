// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import i18n, { resolveLanguage } from './index';
import { DEFAULT_SETTINGS } from '../types';
import { GeneralSettings } from '../settings/GeneralSettings';

// GeneralSettings now renders an Updates section via useUpdate(); this suite only
// exercises the language switcher, so stub the hook rather than wiring a full UpdateProvider.
vi.mock('../update/UpdateManager', () => ({
  useUpdate: () => ({ status: 'idle', available: false, latest: null, check: vi.fn() }),
}));

// react-dom's act() requires this flag when @testing-library isn't in play.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('resolveLanguage', () => {
  const originalLanguage = navigator.language;

  afterEach(() => {
    Object.defineProperty(navigator, 'language', { value: originalLanguage, configurable: true });
  });

  it("returns the explicit setting when it is a supported language", () => {
    expect(resolveLanguage('ro')).toBe('ro');
    expect(resolveLanguage('en')).toBe('en');
  });

  it("falls back to the OS locale when unset ('')", () => {
    Object.defineProperty(navigator, 'language', { value: 'ro-RO', configurable: true });
    expect(resolveLanguage('')).toBe('ro');
  });

  it('falls back to the OS locale when null', () => {
    Object.defineProperty(navigator, 'language', { value: 'ro-RO', configurable: true });
    expect(resolveLanguage(null)).toBe('ro');
  });

  it("falls back to 'en' when the OS locale is unsupported", () => {
    Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true });
    expect(resolveLanguage(null)).toBe('en');
    expect(resolveLanguage('')).toBe('en');
  });

  it("ignores an unsupported explicit value and falls back to OS-or-'en'", () => {
    Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true });
    expect(resolveLanguage('xx')).toBe('en');
    Object.defineProperty(navigator, 'language', { value: 'ro-RO', configurable: true });
    expect(resolveLanguage('xx')).toBe('ro');
  });
});

describe('GeneralSettings language switcher', () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  function mount(updateSetting: (...args: unknown[]) => void) {
    const root = createRoot(container);
    act(() => {
      root.render(
        <GeneralSettings
          settings={{ ...DEFAULT_SETTINGS }}
          updateSetting={updateSetting as never}
        />
      );
    });
    return root;
  }

  it('calls updateSetting("language", v) and i18n.changeLanguage(v) when a new language is picked', async () => {
    const updateSetting = vi.fn();
    mount(updateSetting);

    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();

    await act(async () => {
      select.value = 'ro';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(updateSetting).toHaveBeenCalledWith('language', 'ro');
    expect(i18n.language).toBe('ro');
  });
});
