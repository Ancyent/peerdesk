import { useTranslation } from 'react-i18next';
import type { AppSettings } from '../types';
import { Toggle } from '../components/Toggle';
import i18n from '../i18n';
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES } from '../i18n/languages';
import { useUpdate } from '../update/UpdateManager';

interface Props {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;
}

export function GeneralSettings({ settings, updateSetting }: Props) {
  const { t } = useTranslation('settings');
  const update = useUpdate();
  const ITEMS = [
    { key: 'start_on_boot' as const, label: t('settings:general.startOnBoot.label'), desc: t('settings:general.startOnBoot.desc') },
    { key: 'minimize_to_tray' as const, label: t('settings:general.minimizeToTray.label'), desc: t('settings:general.minimizeToTray.desc') },
  ];
  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3', marginBottom: 20 }}>{t('settings:general.title')}</div>
      <div style={{ fontSize: 10, color: '#b3bdca', letterSpacing: 1, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase' }}>{t('settings:general.sectionStartup')}</div>
      {ITEMS.map((item, i) => (
        <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i === 0 ? '1px solid #1c2128' : 'none' }}>
          <div>
            <div style={{ fontSize: 12, color: '#e6ebf1' }}>{item.label}</div>
            <div style={{ fontSize: 10, color: '#b3bdca', marginTop: 2 }}>{item.desc}</div>
          </div>
          <Toggle value={settings[item.key]} onChange={v => updateSetting(item.key, v)} />
        </div>
      ))}
      <div style={{ fontSize: 10, color: '#b3bdca', letterSpacing: 1, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase', marginTop: 24 }}>{t('settings:general.sectionLocalization')}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
        <div style={{ fontSize: 12, color: '#e6ebf1' }}>{t('settings:general.language')}</div>
        <select
          value={settings.language || i18n.language}
          onChange={e => {
            const v = e.target.value;
            updateSetting('language', v);
            i18n.changeLanguage(v);
          }}
          style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 5, padding: '3px 6px', fontSize: 11, color: '#e6ebf1' }}
        >
          {SUPPORTED_LANGUAGES.map(lng => (
            <option key={lng} value={lng}>{LANGUAGE_NAMES[lng]}</option>
          ))}
        </select>
      </div>
      <div style={{ fontSize: 10, color: '#b3bdca', letterSpacing: 1, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase', marginTop: 24 }}>{t('settings:general.sectionUpdates')}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #1c2128' }}>
        <div>
          <div style={{ fontSize: 12, color: '#e6ebf1' }}>{t('settings:general.autoUpdate.label')}</div>
          <div style={{ fontSize: 10, color: '#b3bdca', marginTop: 2 }}>{t('settings:general.autoUpdate.desc')}</div>
        </div>
        <Toggle value={settings.auto_update} onChange={v => updateSetting('auto_update', v)} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
        <div style={{ fontSize: 11, color: '#b3bdca' }}>
          {update.status === 'checking'
            ? t('settings:general.checking')
            : update.available
              ? t('settings:general.updateReady', { version: update.latest })
              : update.status === 'error'
                ? t('settings:general.checkFailed')
                : t('settings:general.upToDateNow')}
        </div>
        <button
          onClick={() => update.check(true)}
          disabled={update.status === 'checking'}
          style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 5, padding: '4px 10px', fontSize: 11, color: '#e6ebf1', cursor: 'pointer' }}
        >
          {t('settings:general.checkNow')}
        </button>
      </div>
    </div>
  );
}
