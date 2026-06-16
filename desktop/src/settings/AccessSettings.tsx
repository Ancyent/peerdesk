import type { AppSettings } from '../types';
import { Toggle } from '../components/Toggle';

interface Props {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;
}

const MODES = [
  { value: 'full' as const, label: 'Full Access', desc: 'Remote users can control your device completely' },
  { value: 'view_only' as const, label: 'View Only / Cast', desc: 'Remote users see your screen but cannot control it' },
  { value: 'no_incoming' as const, label: 'No Incoming', desc: 'Reject all incoming session requests' },
];

const SectionTitle = ({ children }: { children: string }) => (
  <div style={{ fontSize: 10, color: '#b3bdca', letterSpacing: 1, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase' }}>{children}</div>
);

export function AccessSettings({ settings, updateSetting }: Props) {
  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3', marginBottom: 20 }}>Access</div>

      <div style={{ marginBottom: 20 }}>
        <SectionTitle>Access Mode</SectionTitle>
        {MODES.map(m => (
          <div key={m.value} onClick={() => updateSetting('access_mode', m.value)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${settings.access_mode === m.value ? '#26c6da' : '#30363d'}`, background: settings.access_mode === m.value ? '#26c6da' : 'transparent', marginTop: 2, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12, color: '#e6ebf1' }}>{m.label}</div>
              <div style={{ fontSize: 10, color: '#b3bdca', marginTop: 2 }}>{m.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        <SectionTitle>Incoming Requests</SectionTitle>
        {([
          { key: 'show_approval_dialog' as const, label: 'Show approval dialog', desc: 'Ask before accepting each connection' },
          { key: 'lock_screen_after_session' as const, label: 'Lock screen after session ends', desc: '' },
        ] as const).map(item => (
          <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1c2128' }}>
            <div>
              <div style={{ fontSize: 12, color: '#e6ebf1' }}>{item.label}</div>
              {item.desc && <div style={{ fontSize: 10, color: '#b3bdca' }}>{item.desc}</div>}
            </div>
            <Toggle value={settings[item.key]} onChange={v => updateSetting(item.key, v)} />
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
          <div>
            <div style={{ fontSize: 12, color: '#e6ebf1' }}>Auto-disconnect on inactivity</div>
            <div style={{ fontSize: 10, color: '#b3bdca' }}>Close session after idle</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {settings.auto_disconnect_minutes !== null && (
              <select value={settings.auto_disconnect_minutes ?? 10} onChange={e => updateSetting('auto_disconnect_minutes', Number(e.target.value))} style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 5, padding: '3px 6px', fontSize: 11, color: '#e6ebf1' }}>
                {[5, 10, 15, 30].map(n => <option key={n} value={n}>{n} min</option>)}
              </select>
            )}
            <Toggle value={settings.auto_disconnect_minutes !== null} onChange={v => updateSetting('auto_disconnect_minutes', v ? 10 : null)} />
          </div>
        </div>
      </div>

      <div>
        <SectionTitle>Unattended Access</SectionTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 10, color: '#93a0b2' }}>PERMANENT PASSWORD</div>
          <span style={{ fontSize: 9, fontWeight: 600, color: '#b3bdca', background: '#21262d', border: '1px solid #30363d', borderRadius: 10, padding: '1px 7px' }}>Coming soon</span>
        </div>
        <input
          type="password"
          disabled
          placeholder="Set a permanent password for unattended access..."
          style={{ width: '100%', background: '#1a1f25', border: '1px solid #30363d', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#93a0b2', boxSizing: 'border-box', cursor: 'not-allowed' }}
        />
        <div style={{ fontSize: 10, color: '#93a0b2', marginTop: 4 }}>Unattended access is not available yet.</div>
      </div>
    </div>
  );
}
