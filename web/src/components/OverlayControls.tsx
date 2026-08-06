import React from 'react';
import { useTranslation } from 'react-i18next';
import type { QualitySettings } from '../quality';
import { QualitySelector } from './QualitySelector';
import { DisplaySelector } from './DisplaySelector';

interface DisplayInfo {
  index: number;
  width: number;
  height: number;
  is_primary: boolean;
}

interface Props {
  peerId: string;
  latencyMs: number | null;
  fps: number | null;
  isViewOnly: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  fullscreenTargetRef: React.RefObject<HTMLElement | null>;
  onDisconnect: () => void;
  onCtrlAltDel: () => void;
  onToggleViewOnly: () => void;
  onFileTransfer: () => void;
  onQualityChange: (q: QualitySettings) => void;
  showStats: boolean;
  onToggleStats: () => void;
  showCursor: boolean;
  onToggleCursor: () => void;
  displays: DisplayInfo[];
  currentDisplay: number;
  onDisplayChange: (index: number) => void;
  /** `undefined` means the host never said — an agent older than this feature. Treated as permitted, because it is. */
  canFileTransfer?: boolean;
  /** Same three-state reading as `canFileTransfer`. `false` means the agent drops every input event. */
  canInput?: boolean;
}

function latencyColor(ms: number | null): string {
  if (ms === null) return 'var(--text-3)';
  if (ms < 50) return 'var(--green)';
  if (ms < 150) return 'var(--yellow)';
  return 'var(--red)';
}

export function OverlayControls(props: Props) {
  const { t } = useTranslation('viewer');
  const {
    peerId, latencyMs, fps, isViewOnly, videoRef, fullscreenTargetRef,
    onDisconnect, onCtrlAltDel, onToggleViewOnly, onFileTransfer, onQualityChange,
    showStats, onToggleStats, showCursor, onToggleCursor,
    displays, currentDisplay, onDisplayChange, canFileTransfer, canInput,
  } = props;

  // The host denied keyboard and mouse. Every event we send is dropped at the
  // agent, so offering controls that only make sense when input works would be
  // a lie; say so once instead. `undefined` means an agent older than this
  // feature, which permits input — never hide on silence.
  const inputDenied = canInput === false;

  const [collapsed, setCollapsed] = React.useState(true);
  const [top, setTop] = React.useState(8);
  const [qOpen, setQOpen] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const drag = React.useRef<{ startY: number; startTop: number } | null>(null);

  React.useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = () => {
    const el = fullscreenTargetRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  const handleScreenshot = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `peerdesk-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const onHandleDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startTop: top };
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.startY;
    const next = Math.max(8, Math.min(window.innerHeight - 80, drag.current.startTop + dy));
    setTop(next);
  };
  const onHandleUp = (e: React.PointerEvent) => {
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const dragHandle = (
    <div
      onPointerDown={onHandleDown}
      onPointerMove={onHandleMove}
      onPointerUp={onHandleUp}
      title={t('viewer:controls.dragToMove')}
      style={{
        cursor: 'grab', touchAction: 'none', color: 'var(--text-3)',
        fontSize: 13, lineHeight: 1, textAlign: 'center', userSelect: 'none',
        padding: '2px 0',
      }}
    >
      ⠿
    </div>
  );

  // Compact icon button (collapsed pill + header controls).
  const iconBtn = (danger?: boolean): React.CSSProperties => ({
    width: 28, height: 28, padding: 0,
    border: `1px solid ${danger ? 'rgba(248,113,113,0.3)' : 'rgba(0,200,150,0.18)'}`,
    borderRadius: 6,
    background: danger ? 'rgba(248,113,113,0.1)' : 'rgba(0,200,150,0.07)',
    color: danger ? 'var(--red)' : 'var(--text-2)',
    fontSize: 14, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });

  // Wider labelled button (expanded panel).
  const btn = (active?: boolean, danger?: boolean): React.CSSProperties => ({
    padding: '5px 10px',
    border: `1px solid ${active ? 'rgba(0,200,150,0.4)' : danger ? 'rgba(248,113,113,0.3)' : 'rgba(0,200,150,0.15)'}`,
    borderRadius: 7,
    background: active ? 'rgba(0,200,150,0.15)' : danger ? 'rgba(248,113,113,0.1)' : 'rgba(0,200,150,0.06)',
    color: danger ? 'var(--red)' : active ? 'var(--accent)' : 'var(--text-2)',
    fontSize: 11, fontWeight: active ? 600 : 400, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 5,
    whiteSpace: 'nowrap', width: '100%',
  });

  const shellBase: React.CSSProperties = {
    position: 'absolute', left: 8, top, zIndex: 10,
    background: 'rgba(10,15,24,0.98)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(0,200,150,0.25)',
    borderRadius: 10,
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column',
  };

  if (collapsed) {
    return (
      <div style={{ ...shellBase, width: 36, alignItems: 'center', gap: 4, padding: '4px 0' }}>
        {dragHandle}
        <button style={iconBtn()} title={t('viewer:controls.open')} onClick={() => setCollapsed(false)}>›</button>
        <button style={iconBtn()} title={isFullscreen ? t('viewer:controls.exitFullscreen') : t('viewer:controls.fullscreen')} onClick={toggleFullscreen}>⛶</button>
        <button style={iconBtn(true)} title={t('viewer:controls.disconnect')} onClick={onDisconnect}>✕</button>
      </div>
    );
  }

  return (
    <div style={{ ...shellBase, width: 230, gap: 7, padding: 8 }}>
      {/* header: drag handle + collapse/fullscreen/disconnect */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ flex: 1 }}>{dragHandle}</div>
        <button style={iconBtn()} title={t('viewer:controls.collapse')} onClick={() => setCollapsed(true)}>‹</button>
        <button style={iconBtn()} title={isFullscreen ? t('viewer:controls.exitFullscreen') : t('viewer:controls.fullscreen')} onClick={toggleFullscreen}>⛶</button>
        <button style={iconBtn(true)} title={t('viewer:controls.disconnect')} onClick={onDisconnect}>✕</button>
      </div>

      {/* latency / fps */}
      <div style={{
        fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
        background: 'rgba(0,200,150,0.12)', border: '1px solid rgba(0,200,150,0.3)',
        borderRadius: 7, padding: '3px 10px', color: latencyColor(latencyMs),
        display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
      }}>
        {latencyMs !== null ? `${latencyMs}ms` : '—'}
        <span style={{ color: 'rgba(0,200,150,0.3)' }}>·</span>
        <span style={{ color: 'var(--text-2)' }}>{fps !== null ? `${fps}fps` : '—'}</span>
      </div>

      {/* monitor picker — only here, when expanded */}
      {displays.length > 1 && (
        <DisplaySelector displays={displays} current={currentDisplay} onChange={onDisplayChange} inline />
      )}

      <button style={btn(showStats)} onClick={onToggleStats}>📊 {t('viewer:controls.stats')}</button>
      <button style={btn(showCursor)} onClick={onToggleCursor}>🖱 {t('viewer:controls.cursor')}</button>
      <div style={{ position: 'relative' }}>
        <button style={btn(qOpen)} onClick={() => setQOpen(o => !o)}>⚙ {t('viewer:controls.quality')}</button>
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 20, background: '#0d1117',
          border: '1px solid #30363d', borderRadius: 8, padding: 8, display: qOpen ? 'block' : 'none',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          <QualitySelector onChange={onQualityChange} />
        </div>
      </div>
      {inputDenied ? (
        <div
          title={t('viewer:controls.inputDisabledHint')}
          style={{
            padding: '5px 10px', borderRadius: 7, fontSize: 11,
            border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.1)',
            color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          🔒 {t('viewer:controls.inputDisabled')}
        </div>
      ) : (
        // The view-only toggle only means something while input is possible:
        // with input denied the session is already view-only and nothing the
        // user does here can change that.
        <button style={btn(isViewOnly)} onClick={onToggleViewOnly}>👁 {isViewOnly ? t('viewer:controls.viewOnlyOn') : t('viewer:controls.viewOnly')}</button>
      )}
      {canFileTransfer !== false && (
        <button style={btn()} onClick={onFileTransfer}>📁 {t('viewer:controls.files')}</button>
      )}
      <button style={btn()} onClick={handleScreenshot}>📸 {t('viewer:controls.screenshot')}</button>
      {!inputDenied && (
        <button style={btn()} onClick={onCtrlAltDel}>⌨ {t('viewer:controls.ctrlAltDel')}</button>
      )}

      <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'monospace', textAlign: 'center' }}>
        {peerId.replace(/(\d{3})(\d{3})(\d{3})/, '$1·$2·$3')}
      </div>
    </div>
  );
}
