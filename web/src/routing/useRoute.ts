import { useEffect, useRef, useCallback } from 'react';
import { parsePath, pathFor, type RoutablePage } from './paths';

/**
 * Syncs the History API with app navigation. `onPop` is called on browser
 * back/forward with the parsed destination. The returned `navigate` writes the
 * URL only (pushState for section changes, replaceState for OS sub-tab changes
 * within /downloads) — the caller updates React state.
 */
export function useRoute(
  onPop: (page: RoutablePage, sub: string | null, params: Record<string, string>) => void,
) {
  const onPopRef = useRef(onPop);
  onPopRef.current = onPop;

  useEffect(() => {
    const handler = () => {
      const { page, sub, params } = parsePath(window.location.pathname, window.location.search);
      onPopRef.current(page, sub, params);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  return useCallback((page: RoutablePage, sub: string | null) => {
    const target = pathFor(page, sub);
    if (target === window.location.pathname) return;
    const onDownloads = window.location.pathname.startsWith('/downloads');
    if (page === 'downloads' && onDownloads) {
      window.history.replaceState({}, '', target);
    } else {
      window.history.pushState({}, '', target);
    }
  }, []);
}
