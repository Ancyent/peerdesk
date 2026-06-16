import type { AppSettings } from '../types';
import { Toggle } from '../components/Toggle';

interface Props {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;
}

export function GeneralSettings({ settings, updateSetting }: Props) {
  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3', marginBottom: 20 }}>General</div>
      <div style={{ fontSize: 10, color: '#b3bdca', letterSpacing: 1, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase' }}>Startup</div>
      {([
        { key: 'start_on_boot' as const, label: 'Start on system boot', desc: 'Launch PeerDesk automatically when your computer starts' },
        { key: 'minimize_to_tray' as const, label: 'Minimize to tray on close', desc: 'Keep running in the background when window is closed' },
      ]).map((item, i) => (
        <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i === 0 ? '1px solid #1c2128' : 'none' }}>
          <div>
            <div style={{ fontSize: 12, color: '#e6ebf1' }}>{item.label}</div>
            <div style={{ fontSize: 10, color: '#b3bdca', marginTop: 2 }}>{item.desc}</div>
          </div>
          <Toggle value={settings[item.key]} onChange={v => updateSetting(item.key, v)} />
        </div>
      ))}
    </div>
  );
}
