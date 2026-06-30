import { useEffect } from 'react';

export function useActivityTracker(onActivity: () => void, throttleMs = 30_000) {
  useEffect(() => {
    let last = 0;
    const handler = () => {
      const now = Date.now();
      if (now - last > throttleMs) { last = now; onActivity(); }
    };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, handler));
  }, [onActivity, throttleMs]);
}
