import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { QualitySelector } from './QualitySelector';
import type { QualitySettings } from '../quality';

interface Props {
  peerId: string;
  onFullscreen: () => void;
  onClipboardSync: () => void;
  onFiles: () => void;
  onQualityChange: (q: QualitySettings) => void;
  onToggleStats: () => void;
  showCursor: boolean;
  onToggleCursor: () => void;
  onDisconnect: () => void;
  /** `undefined` means the host never said — an agent older than this feature. */
  canFileTransfer?: boolean;
}

export function ViewerToolbar({ peerId, onFullscreen, onClipboardSync, onFiles, onQualityChange, onToggleStats, showCursor, onToggleCursor, onDisconnect, canFileTransfer }: Props) {
  const { t } = useTranslation('viewer');
  const [qOpen, setQOpen] = useState(false);
  const btn: CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#b3bdca',
    fontSize: 11,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 4,
  };

  return (
    <div style={{ position: 'relative', zIndex: 10, background: '#0d0d0d', borderBottom: '1px solid #1a1a1a', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <span style={{ width: 6, height: 6, background: '#26c6da', borderRadius: '50%', animation: 'pulsedot 2s infinite', flexShrink: 0 }} />
      <span style={{ color: '#93a0b2', fontSize: 10, marginRight: 8, fontFamily: 'monospace' }}>{peerId}</span>

      <button style={btn} onClick={onFullscreen} title={t('viewer:toolbar.fullscreen')}>⛶ {t('viewer:toolbar.fullscreen')}</button>
      <button style={btn} onClick={onClipboardSync} title={t('viewer:toolbar.clipboardTitle')}>📋 {t('viewer:toolbar.clipboard')}</button>
      {canFileTransfer !== false && (
        <button style={btn} onClick={onFiles} title={t('viewer:toolbar.filesTitle')}>📁 {t('viewer:toolbar.files')}</button>
      )}
      <div style={{ position: 'relative' }}>
        <button style={btn} onClick={() => setQOpen(o => !o)} title={t('viewer:toolbar.quality')}>⚙ {t('viewer:toolbar.quality')}</button>
        <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 20, background: '#0d1117',
          border: '1px solid #30363d', borderRadius: 8, padding: 8, display: qOpen ? 'block' : 'none',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          <QualitySelector onChange={onQualityChange} />
        </div>
      </div>
      <button style={btn} onClick={onToggleStats} title={t('viewer:toolbar.statsTitle')}>📊 {t('viewer:toolbar.stats')}</button>
      <button style={btn} onClick={onToggleCursor} title={t('viewer:toolbar.cursorTitle')}>🖱 {t('viewer:toolbar.cursor')}</button>

      <div style={{ flex: 1 }} />

      <button
        onClick={onDisconnect}
        style={{ background: '#3a1a1a', border: 'none', color: '#f85149', fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
      >
        ✕ {t('viewer:toolbar.disconnect')}
      </button>
      <style>{`@keyframes pulsedot{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}
