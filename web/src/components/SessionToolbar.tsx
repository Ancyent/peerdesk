import React from 'react';

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
}

function latencyColor(ms: number | null): string {
  if (ms === null) return 'var(--text-3)';
  if (ms < 50)    return 'var(--green)';
  if (ms < 150)   return 'var(--yellow)';
  return 'var(--red)';
}

export function SessionToolbar({ peerId, latencyMs, fps, isViewOnly, videoRef, onDisconnect, onCtrlAltDel, onToggleViewOnly, onFileTransfer }: Props) {
  const btn = (active?: boolean, danger?: boolean): React.CSSProperties => ({
    padding: '4px 10px', border: 'none', borderRadius: 6,
    background: active ? 'rgba(0,200,150,0.2)' : 'rgba(255,255,255,0.06)',
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

  const sep = <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />;

  return (
    <div style={{ height: 36, background: 'rgba(17,24,36,0.93)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', flexShrink: 0 }}>
      {/* Latency/FPS badge */}
      <div style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-dim)', borderRadius: 6, padding: '2px 8px', color: latencyColor(latencyMs), display: 'flex', alignItems: 'center', gap: 6 }}>
        {latencyMs !== null ? `${latencyMs}ms` : '—'}
        <span style={{ color: 'var(--text-3)' }}>·</span>
        <span style={{ color: 'var(--text-2)' }}>{fps !== null ? `${fps}fps` : '—'}</span>
      </div>
      {sep}
      <button style={btn()} onClick={handleScreenshot}>📸 Screenshot</button>
      <button style={btn()} onClick={onCtrlAltDel}>⌨ Ctrl+Alt+Del</button>
      <button style={btn(isViewOnly)} onClick={onToggleViewOnly}>👁 {isViewOnly ? 'View-Only ON' : 'View-Only'}</button>
      <button style={btn()} onClick={onFileTransfer}>📁 Fișiere</button>
      <div style={{ flex: 1 }} />
      <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'monospace' }}>
        {peerId.replace(/(\d{3})(\d{3})(\d{3})/, '$1·$2·$3')}
      </div>
      {sep}
      <button
        style={btn(false, true)}
        onClick={onDisconnect}
        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--red-bg)'}
        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'}
      >✕ Deconectează</button>
    </div>
  );
}
