import React from 'react';
import { QualitySelector } from './QualitySelector';

interface Props {
  peerId: string;
  latencyMs: number | null;
  fps: number | null;
  isViewOnly: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onDisconnect: () => void;
  onCtrlAltDel: () => void;
  onToggleViewOnly: () => void;
  onFileTransfer: () => void;
  onQualityChange: (q: import('../quality').QualitySettings) => void;
  showStats: boolean;
  onToggleStats: () => void;
}

function latencyColor(ms: number | null): string {
  if (ms === null) return 'var(--text-3)';
  if (ms < 50)    return 'var(--green)';
  if (ms < 150)   return 'var(--yellow)';
  return 'var(--red)';
}

export function SessionToolbar({ peerId, latencyMs, fps, isViewOnly, videoRef, onDisconnect, onCtrlAltDel, onToggleViewOnly, onFileTransfer, onQualityChange, showStats, onToggleStats }: Props) {
  const [qOpen, setQOpen] = React.useState(false);
  const btn = (active?: boolean, danger?: boolean): React.CSSProperties => ({
    padding: '5px 11px',
    border: `1px solid ${active ? 'rgba(0,200,150,0.4)' : danger ? 'rgba(248,113,113,0.3)' : 'rgba(0,200,150,0.15)'}`,
    borderRadius: 7,
    background: active ? 'rgba(0,200,150,0.15)' : danger ? 'rgba(248,113,113,0.1)' : 'rgba(0,200,150,0.06)',
    color: danger ? 'var(--red)' : active ? 'var(--accent)' : 'var(--text-2)',
    fontSize: 11, fontWeight: active ? 600 : 400, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 5,
    transition: 'all 0.15s', whiteSpace: 'nowrap' as const,
  });

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

  const sep = <div style={{ width: 1, height: 18, background: 'rgba(0,200,150,0.2)', margin: '0 6px' }} />;

  return (
    <div style={{
      height: 42,
      position: 'relative', zIndex: 10,
      background: 'rgba(10,15,24,0.98)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(0,200,150,0.25)',
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '0 14px', flexShrink: 0,
      boxShadow: '0 2px 16px rgba(0,0,0,0.5)',
    }}>
      <div style={{
        fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
        background: 'rgba(0,200,150,0.12)',
        border: '1px solid rgba(0,200,150,0.3)',
        borderRadius: 7, padding: '3px 10px',
        color: latencyColor(latencyMs),
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {latencyMs !== null ? `${latencyMs}ms` : '—'}
        <span style={{ color: 'rgba(0,200,150,0.3)' }}>·</span>
        <span style={{ color: 'var(--text-2)' }}>{fps !== null ? `${fps}fps` : '—'}</span>
      </div>
      {sep}
      <button style={btn()} onClick={handleScreenshot}>📸 Screenshot</button>
      <button style={btn()} onClick={onCtrlAltDel}>⌨ Ctrl+Alt+Del</button>
      <button style={btn(isViewOnly)} onClick={onToggleViewOnly}>
        👁 {isViewOnly ? 'View-Only ON' : 'View-Only'}
      </button>
      <button style={btn()} onClick={onFileTransfer}>📁 Fișiere</button>
      <div style={{ position: 'relative' }}>
        <button style={btn(qOpen)} onClick={() => setQOpen(o => !o)} title="Quality">⚙ Quality</button>
        <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 20, background: '#0d1117',
          border: '1px solid #30363d', borderRadius: 8, padding: 8, display: qOpen ? 'block' : 'none',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          <QualitySelector onChange={onQualityChange} />
        </div>
      </div>
      <button style={btn(showStats)} onClick={onToggleStats} title="Connection stats">📊 Stats</button>
      <div style={{ flex: 1 }} />
      <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'monospace', marginRight: 8 }}>
        {peerId.replace(/(\d{3})(\d{3})(\d{3})/, '$1·$2·$3')}
      </div>
      {sep}
      <button
        style={btn(false, true)}
        onClick={onDisconnect}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(248,113,113,0.2)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(248,113,113,0.5)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(248,113,113,0.1)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(248,113,113,0.3)'; }}
      >✕ Deconectează</button>
    </div>
  );
}
