import type { MouseEvent } from 'react';
import type { AppPage } from '../components/AppShell';

export type RoutablePage = AppPage | 'login' | 'register' | 'invite';

const PAGE_TO_PATH: Record<RoutablePage, string> = {
  machines: '/machines',
  organization: '/organization',
  'api-keys': '/api-keys',
  downloads: '/downloads',
  branding: '/branding',
  settings: '/settings',
  team: '/team',
  login: '/login',
  register: '/register',
  invite: '/invite',
};

const PATH_TO_PAGE: Record<string, RoutablePage> = Object.fromEntries(
  Object.entries(PAGE_TO_PATH).map(([page, path]) => [path, page as RoutablePage]),
) as Record<string, RoutablePage>;

export function parsePath(pathname: string): { page: RoutablePage; sub: string | null } {
  const clean = pathname.replace(/\/+$/, '');
  if (clean === '') return { page: 'machines', sub: null };
  const segments = clean.split('/').filter(Boolean);
  const page = PATH_TO_PAGE['/' + segments[0]];
  if (!page) return { page: 'machines', sub: null };
  return { page, sub: segments.length > 1 ? segments[1] : null };
}

// Pages whose path carries a second segment (e.g. /downloads/windows,
// /invite/{token}). Any RoutablePage not listed here ignores `sub` entirely.
const PAGES_WITH_SUB: RoutablePage[] = ['downloads', 'invite'];

export function pathFor(page: RoutablePage, sub?: string | null): string {
  const base = PAGE_TO_PATH[page];
  return sub && PAGES_WITH_SUB.includes(page) ? `${base}/${sub}` : base;
}

/** A modified click means the user asked the BROWSER to handle it: new tab,
 *  new window, download. Intercepting those is the bug this fixes. Only a
 *  plain left click routes in-app. */
export function isPlainLeftClick(e: MouseEvent): boolean {
  return !e.defaultPrevented && e.button === 0
    && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
