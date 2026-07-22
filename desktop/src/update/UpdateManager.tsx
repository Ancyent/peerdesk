import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';
import { useSettingsContext } from '../context/AppContext';
import { cmpVer, shouldPrompt } from './shouldPrompt';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const RELEASES_PAGE = 'https://github.com/Ancyent/peerdesk/releases/latest';

interface UpdateInfo { version: string; current_version: string; notes: string; pub_date: string }
interface UpdateStateJson { skip_version?: string; snooze_until?: number | null }

type Status = 'idle' | 'checking' | 'downloading' | 'error';

interface UpdateValue {
  current: string; latest: string | null; notes: string;
  status: Status; progress: number; available: boolean;
  promptOpen: boolean; isAndroid: boolean;
  check: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
  openDownloadPage: () => Promise<void>;
  snooze: () => Promise<void>;
  skip: () => Promise<void>;
  dismiss: () => void;
}

const Ctx = createContext<UpdateValue | null>(null);

const isAndroid = /android/i.test(navigator.userAgent);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { settings, loaded } = useSettingsContext();
  const [current, setCurrent] = useState('');
  const [latest, setLatest] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [skipVersion, setSkipVersion] = useState('');
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(null);
  // Set when check(true) (manual) runs; forces the dialog open for the current
  // available update even if it was previously skipped/snoozed. Cleared by
  // dismiss()/persist() (Skip, Later, No).
  const [forced, setForced] = useState(false);

  useEffect(() => { getVersion().then(setCurrent).catch(() => {}); }, []);

  // Load skip/snooze bookkeeping once. Uses state (not refs) so the initial
  // load re-renders and promptOpen is recomputed once it resolves — otherwise
  // a check() that resolves first can prompt for an already-skipped/snoozed
  // version and the stale prompt won't clear (ref writes don't re-render).
  useEffect(() => {
    invoke<UpdateStateJson>('get_update_state')
      .then((s) => { setSkipVersion(s.skip_version ?? ''); setSnoozeUntil(s.snooze_until ?? null); })
      .catch(() => {});
  }, []);

  // Progress events from the Rust installer.
  useEffect(() => {
    const un1 = listen<{ downloaded: number; total: number | null }>('update://progress', (e) => {
      const { downloaded, total } = e.payload;
      setProgress(total ? Math.min(1, downloaded / total) : 0);
    });
    const un2 = listen('update://finished', () => setProgress(1));
    return () => { un1.then((f) => f()); un2.then((f) => f()); };
  }, []);

  const check = useCallback(async (manual = false) => {
    if (manual) setForced(true);
    setStatus('checking');
    try {
      const info = await invoke<UpdateInfo | null>('check_for_update');
      if (info) { setLatest(info.version); setNotes(info.notes || ''); }
      else { setLatest(null); setNotes(''); }
      setDismissed(false);
      setStatus('idle');
    } catch {
      setStatus('error'); // no server / offline / old server without the endpoint — never crash
    }
  }, []);

  // Auto-check: on startup (if auto_update) and every 6h while running.
  useEffect(() => {
    if (!loaded || !settings.auto_update) return;
    void check();
    const id = setInterval(() => { void check(); }, SIX_HOURS);
    return () => clearInterval(id);
  }, [loaded, settings.auto_update, check]);

  const install = useCallback(async () => {
    if (isAndroid) return;
    setStatus('downloading'); setProgress(0);
    try { await invoke('download_and_install_update'); /* app relaunches */ }
    catch { setStatus('error'); }
  }, []);

  const openDownloadPage = useCallback(async () => {
    try { await open(RELEASES_PAGE); } catch { /* ignore */ }
  }, []);

  const persist = useCallback(async (patch: UpdateStateJson) => {
    const next = { skip_version: skipVersion, snooze_until: snoozeUntil, ...patch };
    setSkipVersion(next.skip_version ?? ''); setSnoozeUntil(next.snooze_until ?? null);
    try { await invoke('save_update_state', { state: next }); } catch { /* ignore */ }
    setDismissed(true);
    setForced(false);
  }, [skipVersion, snoozeUntil]);

  const snooze = useCallback(() => persist({ snooze_until: Date.now() + 24 * 60 * 60 * 1000 }), [persist]);
  const skip = useCallback(() => persist({ skip_version: latest ?? '' }), [persist, latest]);
  const dismiss = useCallback(() => { setDismissed(true); setForced(false); }, []);

  const available = !!current && !!latest && cmpVer(latest, current) > 0;
  const promptOpen = !dismissed && !isAndroid && (forced ? available : shouldPrompt({
    current, latest, skipVersion, snoozeUntil, now: Date.now(),
  }));

  const value: UpdateValue = {
    current, latest, notes, status, progress, available, promptOpen, isAndroid,
    check, install, openDownloadPage, snooze, skip, dismiss,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUpdate(): UpdateValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUpdate must be used within an UpdateProvider');
  return ctx;
}
