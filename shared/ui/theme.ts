/** Theme selection, shared by both apps.
 *
 *  The stylesheets key off `data-theme` on <html>. 'system' is resolved here
 *  rather than by a CSS media query, because the user can override the OS
 *  preference and an attribute is the only thing both can write to.
 *
 *  Note the app renders correctly before any of this runs: the dark set is
 *  declared on bare `:root`, so a missing attribute means dark. What the inline
 *  script in index.html buys is the LIGHT case - without it a light-mode user
 *  sees one dark frame on every load. */

export type Theme = 'dark' | 'light' | 'system';

export const THEME_STORAGE_KEY = 'pd-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function isTheme(v: unknown): v is Theme {
  return v === 'dark' || v === 'light' || v === 'system';
}

/** Resolves 'system' against the OS preference. */
export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function getStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : 'system';
  } catch {
    // Private-mode Safari and some embedded webviews throw on localStorage
    // access rather than returning null.
    return 'system';
  }
}

export function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not fatal: the theme still applies for this session.
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(theme));
}

/** Applies the stored choice and keeps it in step with the OS while the choice
 *  is 'system'. Returns an unsubscribe function.
 *
 *  Call once at startup. The listener stays attached even when the user picks an
 *  explicit theme, because they may switch back to 'system' without a reload -
 *  it re-reads storage on each OS change instead of capturing the value. */
export function watchSystemTheme(): () => void {
  applyTheme(getStoredTheme());

  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  const onChange = () => {
    if (getStoredTheme() === 'system') applyTheme('system');
  };

  // addEventListener on MediaQueryList is unavailable in older WebKit, which is
  // a real target here: the desktop app runs inside WebKitGTK.
  if (mq.addEventListener) {
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }
  mq.addListener(onChange);
  return () => mq.removeListener(onChange);
}
