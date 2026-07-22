import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdate } from '../update/UpdateManager';

export function UpdateDialog() {
  const { t } = useTranslation('app');
  const { promptOpen, current, latest, notes, status, progress, install, dismiss, snooze, skip } = useUpdate();
  if (!promptOpen) return null;
  const downloading = status === 'downloading';
  const percent = Math.round(progress * 100);

  const overlay: CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const card: CSSProperties = {
    width: 420, maxWidth: '90vw', background: '#161b22', border: '1px solid #30363d',
    borderRadius: 10, padding: 20, color: '#e6edf3',
  };
  const btn = (bg: string, color: string): CSSProperties => ({
    border: '1px solid #30363d', background: bg, color, borderRadius: 6,
    padding: '6px 12px', fontSize: 12, cursor: 'pointer',
  });

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{t('app:updateDialog.title')}</div>
        <div style={{ fontSize: 12.5, color: '#c9d1d9', marginBottom: 12 }}>
          {t('app:updateDialog.body', { current: current || '—', latest: latest || '—' })}
        </div>
        {notes ? (
          <pre style={{ maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontSize: 11, color: '#b3bdca', background: '#0d1117', border: '1px solid #21262d',
            borderRadius: 6, padding: 10, margin: '0 0 14px' }}>{notes}</pre>
        ) : null}
        {downloading ? (
          <div>
            <div style={{ fontSize: 12, color: '#c9d1d9', marginBottom: 8 }}>
              {percent >= 100 ? t('app:updateDialog.installing') : t('app:updateDialog.downloading', { percent })}
            </div>
            <div style={{ height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${percent}%`, height: '100%', background: '#26c6da', transition: 'width .2s' }} />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button style={btn('transparent', '#8b949e')} onClick={skip}>{t('app:updateDialog.skip')}</button>
            <button style={btn('transparent', '#8b949e')} onClick={snooze}>{t('app:updateDialog.later')}</button>
            <button style={btn('transparent', '#c9d1d9')} onClick={dismiss}>{t('app:updateDialog.no')}</button>
            <button style={btn('rgba(38,198,218,0.15)', '#26c6da')} onClick={install}>{t('app:updateDialog.yes')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
