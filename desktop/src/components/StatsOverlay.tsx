import { useTranslation } from 'react-i18next';
import type { LiveStats } from '../lib/stats';

export function StatsOverlay({ stats, targetKbps }: { stats: LiveStats | null; targetKbps: number }) {
  const { t } = useTranslation('viewer');
  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ opacity: 0.7 }}>{label}</span><span>{value}</span>
    </div>
  );
  const v = (n: number | null | undefined, suffix = '') => (n == null ? '—' : `${n}${suffix}`);
  return (
    <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.6)', color: '#fff',
      font: '11px/1.5 monospace', padding: '8px 10px', borderRadius: 6, pointerEvents: 'none', zIndex: 10 }}>
      {row('FPS', v(stats?.fps))}
      {row(t('viewer:stats.speed'), v(stats?.bitrateKbps, ' kbps'))}
      {row(t('viewer:stats.target'), `${targetKbps} kbps`)}
      {row(t('viewer:stats.delay'), v(stats?.rttMs, ' ms'))}
      {row(t('viewer:stats.res'), stats?.width ? `${stats.width}×${stats.height}` : '—')}
      {row('Codec', stats?.codec ?? '—')}
      {row(t('viewer:stats.loss'), stats?.lossPct == null ? '—' : `${stats.lossPct.toFixed(1)}%`)}
    </div>
  );
}
