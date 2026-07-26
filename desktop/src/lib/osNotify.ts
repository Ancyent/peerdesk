import type { Toast } from '@pd/ui';

export interface OsNotifyDeps {
  isFocused: () => Promise<boolean>;
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<'granted' | 'denied' | 'default'>;
  send: (options: { title: string; body?: string }) => void;
}

/** Mirror a toast to an OS notification, but only when the window is not
 *  focused. Any failure is swallowed on purpose: the in-app toast has already
 *  been shown, so OS delivery is a bonus channel and never the only one. */
export async function routeToOs(toast: Toast, deps: OsNotifyDeps): Promise<void> {
  try {
    if (await deps.isFocused()) return;

    let granted = await deps.isPermissionGranted();
    if (!granted) granted = (await deps.requestPermission()) === 'granted';
    if (!granted) return;

    deps.send({ title: toast.message, body: toast.detail });
  } catch {
    // Plugin missing, capability not granted, or the OS refused. The user
    // has already seen the in-app toast, so there is nothing to recover
    // here — OS delivery is a bonus channel, never the only one.
  }
}

/** Wire routeToOs to the real Tauri APIs. Returns a callback for
 *  NotifyProvider's `onExternal`. */
export function createOsNotifier(): (toast: Toast) => void {
  // onExternal fires exactly once per genuinely new toast (see
  // NotifyProvider), so this dedup set is cheap insurance rather than a
  // load-bearing guard against double-firing.
  const seen = new Set<number>();

  return (toast: Toast) => {
    if (seen.has(toast.id)) return;
    seen.add(toast.id);

    void (async () => {
      try {
        const [windowApi, notification] = await Promise.all([
          import('@tauri-apps/api/window'),
          import('@tauri-apps/plugin-notification'),
        ]);

        await routeToOs(toast, {
          isFocused: () => windowApi.getCurrentWindow().isFocused(),
          isPermissionGranted: notification.isPermissionGranted,
          requestPermission: notification.requestPermission,
          send: notification.sendNotification,
        });
      } catch {
        // Not running under Tauri (e.g. plain `vite dev` in a browser) —
        // the dynamic imports above throw, and there is no OS layer to
        // deliver to. The in-app toast has already been shown.
      }
    })();
  };
}
