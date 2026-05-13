import { useState } from 'react';
import type { CSSProperties } from 'react';
import { QualitySelector } from './QualitySelector';
import type { Quality } from './QualitySelector';

const BITRATES: Record<Quality, number | null> = {
  auto: null,
  high: 2000,
  medium: 800,
  low: 300,
};

interface Props {
  peerId: string;
  onFullscreen: () => void;
  onClipboardSync: () => void;
  onFiles: () => void;
  onQualityChange: (kbps: number | null) => void;
  onDisconnect: () => void;
}

export function ViewerToolbar({ peerId, onFullscreen, onClipboardSync, onFiles, onQualityChange, onDisconnect }: Props) {
  const [quality, setQuality] = useState<Quality>('auto');

  const handleQuality = (q: Quality) => {
    setQuality(q);
    onQualityChange(BITRATES[q]);
  };

  const btn: CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#8b949e',
    fontSize: 11,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 4,
  };

  return (
    <div style={{ background: '#0d0d0d', borderBottom: '1px solid #1a1a1a', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <span style={{ width: 6, height: 6, background: '#26c6da', borderRadius: '50%', animation: 'pulsedot 2s infinite', flexShrink: 0 }} />
      <span style={{ color: '#484f58', fontSize: 10, marginRight: 8, fontFamily: 'monospace' }}>{peerId}</span>

      <button style={btn} onClick={onFullscreen} title="Fullscreen">⛶ Fullscreen</button>
      <button style={btn} onClick={onClipboardSync} title="Sync local clipboard to remote">📋 Clipboard</button>
      <button style={btn} onClick={onFiles} title="File transfer">📁 Files</button>
      <QualitySelector value={quality} onChange={handleQuality} />

      <div style={{ flex: 1 }} />

      <button
        onClick={onDisconnect}
        style={{ background: '#3a1a1a', border: 'none', color: '#f85149', fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
      >
        ✕ Disconnect
      </button>
      <style>{`@keyframes pulsedot{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}
