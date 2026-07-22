import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsContext } from '../context/AppContext';
import { AccessSettings } from '../settings/AccessSettings';
import { NetworkSettings } from '../settings/NetworkSettings';
import { PermissionsSettings } from '../settings/PermissionsSettings';
import { DisplaySettings } from '../settings/DisplaySettings';
import { GeneralSettings } from '../settings/GeneralSettings';
import { AccountSettings } from '../settings/AccountSettings';

type Page = 'general' | 'network' | 'access' | 'permissions' | 'display' | 'audio' | 'account';
interface Props { onBack: () => void; }

export function SettingsScreen({ onBack }: Props) {
  const [active, setActive] = useState<Page>('access');
  const { settings, loaded, updateSetting } = useSettingsContext();
  const { t } = useTranslation(['settings', 'common']);

  if (!loaded) return null;

  const NAV = [
    { group: t('settings:nav.groups.application'), items: [
      { id: 'general' as Page, icon: '⚙', label: t('settings:nav.items.general') },
      { id: 'network' as Page, icon: '🌐', label: t('settings:nav.items.network') },
    ] },
    { group: t('settings:nav.groups.security'), items: [
      { id: 'access' as Page, icon: '🔒', label: t('settings:nav.items.access') },
      { id: 'permissions' as Page, icon: '🛡', label: t('settings:nav.items.permissions') },
    ] },
    { group: t('settings:nav.groups.session'), items: [
      { id: 'display' as Page, icon: '🖥', label: t('settings:nav.items.display') },
      { id: 'audio' as Page, icon: '🔊', label: t('settings:nav.items.audio') },
    ] },
    { group: t('settings:nav.groups.account'), items: [
      { id: 'account' as Page, icon: '👤', label: t('settings:nav.items.account') },
    ] },
  ];

  const content = () => {
    switch (active) {
      case 'access': return <AccessSettings settings={settings} updateSetting={updateSetting} />;
      case 'network': return <NetworkSettings />;
      case 'permissions': return <PermissionsSettings settings={settings} updateSetting={updateSetting} />;
      case 'display': return <DisplaySettings settings={settings} updateSetting={updateSetting} />;
      case 'general': return <GeneralSettings settings={settings} updateSetting={updateSetting} />;
      case 'account': return <AccountSettings />;
      default: return <div style={{ padding: 20, color: '#b3bdca', fontSize: 13 }}>{t('common:comingSoon')}</div>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d1117', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', color: '#e6edf3' }}>
      <div style={{ background: '#161b22', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: '1px solid #21262d' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#b3bdca', cursor: 'pointer', fontSize: 13, marginLeft: 4 }}>← {t('common:back')}</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 12, color: '#b3bdca', fontWeight: 500 }}>{t('settings:chrome.title')}</div>
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 158, background: '#161b22', borderRight: '1px solid #21262d', padding: '10px 0', overflowY: 'auto', flexShrink: 0 }}>
          {NAV.map(g => (
            <div key={g.group}>
              <div style={{ padding: '8px 14px 4px', fontSize: 9, color: '#93a0b2', letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase' }}>{g.group}</div>
              {g.items.map(item => (
                <div key={item.id} onClick={() => setActive(item.id)}
                  style={{ padding: '6px 14px', paddingLeft: active === item.id ? 12 : 14, fontSize: 11, color: active === item.id ? '#26c6da' : '#b3bdca', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, background: active === item.id ? '#0a2a2e' : 'transparent', borderLeft: active === item.id ? '2px solid #26c6da' : '2px solid transparent' }}
                  onMouseEnter={e => { if (active !== item.id) { e.currentTarget.style.background = '#1c2128'; e.currentTarget.style.color = '#e6ebf1'; } }}
                  onMouseLeave={e => { if (active !== item.id) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#b3bdca'; } }}
                >
                  {item.icon} {item.label}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>{content()}</div>
      </div>
    </div>
  );
}
