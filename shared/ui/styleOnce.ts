const injected = new Set<string>();

/** Injects a stylesheet into <head> exactly once per id.
 *
 *  Modal and ToastHost render their <style> inline on every mount, which is
 *  fine for one dialog. A Button used in 140 places cannot do that, and its
 *  rules need real :hover / :active / :focus-visible selectors that an inline
 *  style attribute cannot express at all.
 *
 *  Safe to call during render: it is idempotent and touches only <head>. */
export function styleOnce(id: string, css: string): void {
  if (injected.has(id)) return;
  if (typeof document === 'undefined') return;

  injected.add(id);
  // A previous instance may have left the tag behind (HMR, or a second bundle
  // on the same page); the Set alone would not catch that.
  if (document.getElementById(id)) return;

  const el = document.createElement('style');
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
