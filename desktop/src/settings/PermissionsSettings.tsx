import { useTranslation } from 'react-i18next';
import type { AppSettings } from '../types';
import { Toggle } from '../components/Toggle';

interface Props {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;
}

export function PermissionsSettings({ settings, updateSetting }: Props) {
  const { t } = useTranslation('settings');

  const PERMS: { key: keyof AppSettings; label: string; desc?: string }[] = [
    { key: 'allow_keyboard_mouse', label: t('settings:permissions.items.keyboardMouse.label') },
    { key: 'allow_clipboard', label: t('settings:permissions.items.clipboard.label') },
    { key: 'allow_file_transfer', label: t('settings:permissions.items.fileTransfer.label') },
    { key: 'allow_audio', label: t('settings:permissions.items.audio.label') },
    { key: 'allow_terminal', label: t('settings:permissions.items.terminal.label') },
    { key: 'allow_remote_restart', label: t('settings:permissions.items.remoteRestart.label') },
    { key: 'block_user_input', label: t('settings:permissions.items.blockUserInput.label'), desc: t('settings:permissions.items.blockUserInput.desc') },
  ];

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3', marginBottom: 20 }}>{t('settings:permissions.title')}</div>
      <div style={{ fontSize: 10, color: '#b3bdca', letterSpacing: 1, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase' }}>
        {t('settings:permissions.sectionTitle')}
      </div>
      {PERMS.map((p, i) => (
        <div key={String(p.key)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < PERMS.length - 1 ? '1px solid #1c2128' : 'none' }}>
          <div>
            <div style={{ fontSize: 12, color: '#e6ebf1' }}>{p.label}</div>
            {p.desc && <div style={{ fontSize: 10, color: '#b3bdca', marginTop: 2 }}>{p.desc}</div>}
          </div>
          <Toggle
            value={settings[p.key] as boolean}
            onChange={v => updateSetting(p.key, v as AppSettings[typeof p.key])}
          />
        </div>
      ))}
    </div>
  );
}
