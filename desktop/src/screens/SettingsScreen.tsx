import { useState } from 'react';
import { useSettingsContext } from '../context/AppContext';
import { AccessSettings } from '../settings/AccessSettings';
import { NetworkSettings } from '../settings/NetworkSettings';
import { PermissionsSettings } from '../settings/PermissionsSettings';
import { DisplaySettings } from '../settings/DisplaySettings';
import { GeneralSettings } from '../settings/GeneralSettings';
import { AccountSettings } from '../settings/AccountSettings';

type Page = 'general' | 'network' | 'access' | 'permissions' | 'display' | 'audio' | 'account';
interface Props { onBack: () => void; }

const NAV = [
  { group: 'APPLICATION', items: [{ id: 'general' as Page, icon: '⚙', label: 'General' }, { id: 'network' as Page, icon: '🌐', label: 'Network' }] },
  { group: 'SECURITY', items: [{ id: 'access' as Page, icon: '🔒', label: 'Access' }, { id: 'permissions' as Page, icon: '🛡', label: 'Permissions' }] },
  { group: 'SESSION', items: [{ id: 'display' as Page, icon: '🖥', label: 'Display' }, { id: 'audio' as Page, icon: '🔊', label: 'Audio' }] },
  { group: 'ACCOUNT', items: [{ id: 'account' as Page, icon: '👤', label: 'My Device' }] },
];

export function SettingsScreen({ onBack }: Props) {
  const [active, setActive] = useState<Page>('access');
  const { settings, loaded, updateSetting } = useSettingsContext();

  if (!loaded) return null;

  const content = () => {
    switch (active) {
      case 'access': return <AccessSettings settings={settings} updateSetting={updateSetting} />;
      case 'network': return <NetworkSettings />;
      case 'permissions': return <PermissionsSettings settings={settings} updateSetting={updateSetting} />;
      case 'display': return <DisplaySettings settings={settings} updateSetting={updateSetting} />;
      case 'general': return <GeneralSettings settings={settings} updateSetting={updateSetting} />;
      case 'account': return <AccountSettings />;
      default: return <div style={{ padding: 20, color: '#8b949e', fontSize: 13 }}>Coming soon</div>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d1117', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', color: '#e6edf3' }}>
      <div style={{ background: '#161b22', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: '1px solid #21262d' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 13, marginLeft: 4 }}>← Back</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 12, color: '#8b949e', fontWeight: 500 }}>PeerDesk · Settings</div>
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 158, background: '#161b22', borderRight: '1px solid #21262d', padding: '10px 0', overflowY: 'auto', flexShrink: 0 }}>
          {NAV.map(g => (
            <div key={g.group}>
              <div style={{ padding: '8px 14px 4px', fontSize: 9, color: '#484f58', letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase' }}>{g.group}</div>
              {g.items.map(item => (
                <div key={item.id} onClick={() => setActive(item.id)}
                  style={{ padding: '6px 14px', paddingLeft: active === item.id ? 12 : 14, fontSize: 11, color: active === item.id ? '#26c6da' : '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, background: active === item.id ? '#0a2a2e' : 'transparent', borderLeft: active === item.id ? '2px solid #26c6da' : '2px solid transparent' }}
                  onMouseEnter={e => { if (active !== item.id) { e.currentTarget.style.background = '#1c2128'; e.currentTarget.style.color = '#c9d1d9'; } }}
                  onMouseLeave={e => { if (active !== item.id) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8b949e'; } }}
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
