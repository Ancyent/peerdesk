import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    invoke<AppSettings>('get_settings')
      .then((s) => {
        setSettings(s);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          invoke('save_settings', { settings: next }).catch(console.error);
        }, 500);
        return next;
      });
    },
    []
  );

  return { settings, loaded, updateSetting };
}
