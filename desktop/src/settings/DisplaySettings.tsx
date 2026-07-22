import { useTranslation } from 'react-i18next';
import type { AppSettings } from '../types';
import { Toggle } from '../components/Toggle';

interface Props {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;
}

function Radio<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, color: '#93a0b2', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      {options.map(o => (
        <div key={o.value} onClick={() => onChange(o.value)} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, cursor: 'pointer' }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${value === o.value ? '#26c6da' : '#30363d'}`, background: value === o.value ? '#26c6da' : 'transparent', flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: '#e6ebf1' }}>{o.label}</div>
        </div>
      ))}
    </div>
  );
}

export function DisplaySettings({ settings, updateSetting }: Props) {
  const { t } = useTranslation('settings');
  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3', marginBottom: 20 }}>{t('settings:display.title')}</div>
      <Radio label={t('settings:display.imageQuality.label')} value={settings.image_quality} onChange={v => updateSetting('image_quality', v)}
        options={[
          { value: 'best', label: t('settings:display.imageQuality.best') },
          { value: 'balanced', label: t('settings:display.imageQuality.balanced') },
          { value: 'performance', label: t('settings:display.imageQuality.performance') },
        ]} />
      <Radio label={t('settings:display.codec.label')} value={settings.codec} onChange={v => updateSetting('codec', v)}
        options={[
          { value: 'auto', label: t('settings:display.codec.auto') },
          { value: 'h264', label: t('settings:display.codec.h264') },
          { value: 'vp9', label: t('settings:display.codec.vp9') },
          { value: 'av1', label: t('settings:display.codec.av1') },
        ]} />
      <Radio label={t('settings:display.viewMode.label')} value={settings.view_mode} onChange={v => updateSetting('view_mode', v)}
        options={[
          { value: 'fit', label: t('settings:display.viewMode.fit') },
          { value: 'original', label: t('settings:display.viewMode.original') },
          { value: 'stretch', label: t('settings:display.viewMode.stretch') },
        ]} />
      <div style={{ borderTop: '1px solid #21262d', paddingTop: 16 }}>
        {([
          { key: 'show_remote_cursor' as const, label: t('settings:display.showRemoteCursor') },
          { key: 'hardware_acceleration' as const, label: t('settings:display.hardwareAcceleration') },
        ]).map((item, i) => (
          <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i === 0 ? '1px solid #1c2128' : 'none' }}>
            <div style={{ fontSize: 12, color: '#e6ebf1' }}>{item.label}</div>
            <Toggle value={settings[item.key]} onChange={v => updateSetting(item.key, v)} />
          </div>
        ))}
      </div>
    </div>
  );
}
