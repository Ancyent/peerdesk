import { useTranslation } from 'react-i18next';
import { useUpdate } from '../update/UpdateManager';

/** Bottom-right version badge; a thin view over UpdateManager. Shows the current
 *  version and, when an update is available, a click-to-update pill. */
export function UpdateBadge() {
  const { t } = useTranslation('app');
  const { current, latest, available, status, isAndroid, openDownloadPage, check } = useUpdate();

  const onClick = () => {
    if (isAndroid) { void openDownloadPage(); return; }
    void check(true); // re-open the dialog (clears the dismissed flag)
  };

  return (
    <div style={{ position: 'fixed', right: 10, bottom: 7, zIndex: 500, userSelect: 'none' }}>
      {available ? (
        <button
          onClick={onClick}
          title={t('app:updateBadge.updateTooltip', { version: latest })}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(38,198,218,0.12)', border: '1px solid rgba(38,198,218,0.45)',
            borderRadius: 20, padding: '3px 10px', cursor: 'pointer',
            fontSize: 10.5, fontWeight: 600, color: '#26c6da',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#26c6da', boxShadow: '0 0 6px #26c6da', animation: 'pulsedot 2s infinite' }} />
          {t('app:updateBadge.updateAvailable', { version: latest })}
        </button>
      ) : (
        <span style={{ fontSize: 10, color: '#5b6675', padding: '3px 8px' }}>
          {status === 'checking' ? t('app:updateBadge.checking') : `v${current || '—'}`}
        </span>
      )}
      <style>{`@keyframes pulsedot{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
    </div>
  );
}
