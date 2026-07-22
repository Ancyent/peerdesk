// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import i18n from '../i18n';
import { applyUserLanguage } from './AuthContext';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    api: {
      ...actual.api,
      users: {
        ...actual.api.users,
        update: vi.fn().mockResolvedValue({ id: '1', email: 'a@b.com', name: 'A', created_at: '', language: 'ro' }),
      },
    },
  };
});

vi.mock('./useAuth', () => ({
  useAuth: vi.fn(),
}));

import { api } from '../api/client';
import { useAuth } from './useAuth';
import { SettingsPage } from '../pages/SettingsPage';

// react-dom's act() requires this flag when @testing-library isn't in play.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('applyUserLanguage (DB wins on load)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('switches i18n to the user language when it is a supported, different value', async () => {
    applyUserLanguage({ language: 'ro' });
    await Promise.resolve();
    await Promise.resolve();
    expect(i18n.language).toBe('ro');
  });

  it('leaves i18n unchanged when user.language is null', async () => {
    applyUserLanguage({ language: null });
    await Promise.resolve();
    expect(i18n.language).toBe('en');
  });

  it('leaves i18n unchanged when user.language is not a supported value', async () => {
    applyUserLanguage({ language: 'xx' });
    await Promise.resolve();
    expect(i18n.language).toBe('en');
  });

  it('leaves i18n unchanged when user is null', async () => {
    applyUserLanguage(null);
    await Promise.resolve();
    expect(i18n.language).toBe('en');
  });
});

describe('SettingsPage language switcher write-through', () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('en');
    vi.mocked(api.users.update).mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  function mountSettingsPage() {
    const root = createRoot(container);
    act(() => { root.render(<SettingsPage />); });
    return root;
  }

  it('calls api.users.update with the new language when a token is present', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: '1', email: 'a@b.com', name: 'A', created_at: '' },
      accessToken: 'tok-123',
    } as unknown as ReturnType<typeof useAuth>);

    mountSettingsPage();
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();

    await act(async () => {
      select.value = 'ro';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(api.users.update).toHaveBeenCalledWith('tok-123', { language: 'ro' });
  });

  it('does NOT call api.users.update when there is no access token', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
    } as unknown as ReturnType<typeof useAuth>);

    mountSettingsPage();
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();

    await act(async () => {
      select.value = 'ro';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(api.users.update).not.toHaveBeenCalled();
  });
});
