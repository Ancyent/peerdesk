import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useNotify } from '@pd/ui';
import type { AppSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

export function useSettings() {
  const { t } = useTranslation();
  const { notify } = useNotify();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    invoke<AppSettings>('get_settings')
      .then((s) => {
        setSettings(s);
        setLoaded(true);
      })
      .catch(() => {
        // A failed load silently falls back to DEFAULT_SETTINGS, which reads
        // to the user as "my settings were reset" -- and the next toggle
        // would then overwrite the real, persisted settings with those
        // defaults. Surface it instead (same failure shape BrandingPage's
        // load handler was fixed to surface, in web/src/pages/BrandingPage.tsx).
        notify.error(t('notify:settingsLoadFailed'));
        setLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          invoke('save_settings', { settings: next }).catch(() => {
            notify.error(t('notify:settingsSaveFailed'));
          });
        }, 500);
        return next;
      });
    },
    [notify, t]
  );

  return { settings, loaded, updateSetting };
}
