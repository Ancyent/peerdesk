import type { AppSettings } from '../types';
interface Props { settings: AppSettings; updateSetting: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void; }
export function PermissionsSettings(_: Props) { return <div style={{ padding: 20, color: '#8b949e' }}>Permissions — coming in Task 8</div>; }
