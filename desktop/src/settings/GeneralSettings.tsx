import type { AppSettings } from '../types';
interface Props { settings: AppSettings; updateSetting: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void; }
export function GeneralSettings(_: Props) { return <div style={{ padding: 20, color: '#8b949e' }}>General — coming in Task 8</div>; }
