import type { AppPage } from '../components/AppShell';

export type RoutablePage = AppPage | 'login' | 'register';

const PAGE_TO_PATH: Record<RoutablePage, string> = {
  machines: '/machines',
  organization: '/organization',
  'api-keys': '/api-keys',
  downloads: '/downloads',
  branding: '/branding',
  settings: '/settings',
  login: '/login',
  register: '/register',
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

export function pathFor(page: RoutablePage, sub?: string | null): string {
  const base = PAGE_TO_PATH[page];
  return page === 'downloads' && sub ? `${base}/${sub}` : base;
}
