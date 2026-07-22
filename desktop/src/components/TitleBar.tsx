import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

/** Custom frameless title bar — replaces the native OS chrome with the
 *  PeerDesk dark theme. Window controls are wired to the Tauri window API;
 *  the bar background is a Tauri drag region so the window stays movable. */
export function TitleBar() {
  const { t } = useTranslation('app');
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    appWindow.isMaximized().then(setMaximized).catch(() => {});
    appWindow
      .onResized(() => {
        appWindow.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  const ctrlBase: React.CSSProperties = {
    width: 46,
    height: 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#b3bdca',
    transition: 'background 120ms ease, color 120ms ease',
    outline: 'none',
  };

  const hover = (e: React.MouseEvent<HTMLButtonElement>, on: boolean, danger = false) => {
    const el = e.currentTarget;
    el.style.background = on ? (danger ? '#e5484d' : '#1f2a3c') : 'transparent';
    el.style.color = on ? '#ffffff' : '#b3bdca';
  };

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 34,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'linear-gradient(180deg, #131a26 0%, #0f141d 100%)',
        borderBottom: '1px solid rgba(38, 198, 218, 0.18)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Brand — left */}
      <div
        data-tauri-drag-region
        style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, pointerEvents: 'none' }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: '#26c6da',
            boxShadow: '0 0 8px 1px rgba(38, 198, 218, 0.7)',
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: '#e6edf3' }}>
          Peer<span style={{ color: '#26c6da' }}>Desk</span>
        </span>
      </div>

      {/* Window controls — right */}
      <div style={{ display: 'flex' }}>
        <button
          style={ctrlBase}
          onMouseEnter={(e) => hover(e, true)}
          onMouseLeave={(e) => hover(e, false)}
          onClick={() => appWindow.minimize()}
          title={t('app:titlebar.minimize')}
          aria-label={t('app:titlebar.minimize')}
        >
          <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="5" width="9" height="1.2" fill="currentColor" /></svg>
        </button>
        <button
          style={ctrlBase}
          onMouseEnter={(e) => hover(e, true)}
          onMouseLeave={(e) => hover(e, false)}
          onClick={() => appWindow.toggleMaximize()}
          title={maximized ? t('app:titlebar.restore') : t('app:titlebar.maximize')}
          aria-label={maximized ? t('app:titlebar.restore') : t('app:titlebar.maximize')}
        >
          {maximized ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.1">
              <rect x="2.2" y="1.2" width="6.2" height="6.2" /><rect x="1" y="3" width="6.2" height="6.2" fill="#0f141d" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.1">
              <rect x="1.2" y="1.2" width="8.6" height="8.6" />
            </svg>
          )}
        </button>
        <button
          style={ctrlBase}
          onMouseEnter={(e) => hover(e, true, true)}
          onMouseLeave={(e) => hover(e, false)}
          onClick={() => appWindow.close()}
          title={t('app:titlebar.close')}
          aria-label={t('app:titlebar.close')}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M1.5 1.5 L9.5 9.5 M9.5 1.5 L1.5 9.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
