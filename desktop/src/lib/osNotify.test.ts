import { describe, it, expect, vi } from 'vitest';
import { routeToOs, type OsNotifyDeps } from './osNotify';
import type { Toast } from '@pd/ui';

const toast = (over: Partial<Toast> = {}): Toast => ({
  id: 1, kind: 'error', message: 'Boom', count: 1,
  remainingMs: 0, ageMs: 0, expires: false, ...over,
});

const deps = (over: Partial<OsNotifyDeps> = {}): OsNotifyDeps => ({
  isFocused: vi.fn().mockResolvedValue(false),
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted' as const),
  send: vi.fn(),
  ...over,
});

describe('routeToOs', () => {
  it('does not send an OS notification while the window is focused', async () => {
    const d = deps({ isFocused: vi.fn().mockResolvedValue(true) });
    await routeToOs(toast(), d);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('sends an OS notification when the window is not focused', async () => {
    const d = deps();
    await routeToOs(toast({ message: 'Disconnected' }), d);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.send).mock.calls[0][0].title).toBe('Disconnected');
  });

  it('includes the detail as the notification body', async () => {
    const d = deps();
    await routeToOs(toast({ detail: 'timeout' }), d);
    expect(vi.mocked(d.send).mock.calls[0][0].body).toBe('timeout');
  });

  it('requests permission only when it is not already granted', async () => {
    const d = deps();
    await routeToOs(toast(), d);
    expect(d.requestPermission).not.toHaveBeenCalled();

    const d2 = deps({ isPermissionGranted: vi.fn().mockResolvedValue(false) });
    await routeToOs(toast(), d2);
    expect(d2.requestPermission).toHaveBeenCalledTimes(1);
    expect(d2.send).toHaveBeenCalledTimes(1);
  });

  it('does not send when permission is denied', async () => {
    const d = deps({
      isPermissionGranted: vi.fn().mockResolvedValue(false),
      requestPermission: vi.fn().mockResolvedValue('denied' as const),
    });
    await routeToOs(toast(), d);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('never throws when the plugin fails — the in-app toast is the guarantee', async () => {
    const d = deps({ isFocused: vi.fn().mockRejectedValue(new Error('no plugin')) });
    await expect(routeToOs(toast(), d)).resolves.toBeUndefined();
  });
});
