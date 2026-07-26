import { useState, useCallback, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotify } from '@pd/ui';
import { useSignaling } from '../hooks/useSignaling';
import { useWebRTC } from '../hooks/useWebRTC';
import { ViewerToolbar } from '../components/ViewerToolbar';
import { FileTransferModal } from '../components/FileTransferModal';
import { StatsOverlay } from '../components/StatsOverlay';
import { DisplaySelector } from '../components/DisplaySelector';
import { normToPx } from '../lib/viewerGeom';
import { useStats } from '../hooks/useStats';
import { PRESETS, type QualitySettings } from '../quality';
import type { Session, SessionState } from '../types';
import type { SignalingMessage } from '../types/messages';

const fmt = (id: string) => id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');

async function computeHmacKey(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('peerdesk-v1'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(password));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function computeResponse(nonce: string, hmacKey: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(hmacKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(nonce));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface Props {
  session: Session;
  signalingUrl: string;
  onStateChange: (id: string, state: SessionState, error?: string) => void;
  onClose: () => void;
}

export function ViewerTab({ session, signalingUrl, onStateChange, onClose }: Props) {
  const { t } = useTranslation(['viewer', 'common']);
  const { notify } = useNotify();
  const [password, setPassword] = useState('');
  const [viewState, setViewState] = useState<'connecting' | 'pending_approval' | 'negotiating' | 'connected' | 'error'>('connecting');
  const [errMsg, setErrMsg] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showCursor, setShowCursor] = useState(true);
  const [targetKbps, setTargetKbps] = useState(PRESETS.balanced.bitrate_kbps);
  const [displays, setDisplays] = useState<Array<{ index: number; width: number; height: number; is_primary: boolean }>>([]);
  const [currentDisplay, setCurrentDisplay] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sendRef = useRef<((m: SignalingMessage) => void) | null>(null);
  const iceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The agent pushes a clipboard update on every remote clipboard change (as
  // often as every 500ms), with no user gesture behind it, so a failing
  // writeText (e.g. "document not focused" in WebKitGTK) would otherwise
  // stack a fresh permanent error toast per change. Report only the first
  // failure since the last success, mirroring LogPanel's reportedRef guard.
  // Unlike LogPanel (one poll loop, reset on unmount), this fires for the
  // component's whole lifetime, so it resets on success instead: the user
  // is told once per outage, and told again if sync recovers and then
  // breaks a second time.
  const clipboardErrorReportedRef = useRef(false);

  const webrtc = useWebRTC(
    useCallback((m: SignalingMessage) => { sendRef.current?.(m); }, []),
    // Writes the remote host's clipboard sync into the local clipboard. If this
    // fails, the user pastes and silently gets stale content instead of what
    // they just copied on the remote machine, so it's worth a toast.
    useCallback((text: string) => {
      navigator.clipboard.writeText(text)
        .then(() => { clipboardErrorReportedRef.current = false; })
        .catch(() => {
          if (!clipboardErrorReportedRef.current) {
            clipboardErrorReportedRef.current = true;
            notify.error(t('notify:clipboardFailed'));
          }
        });
    }, [notify, t]),
  );

  const liveStats = useStats(webrtc.getPc, showStats);

  const { send } = useSignaling(signalingUrl, useCallback(async (msg: SignalingMessage) => {
    if (msg.type === 'joined') {
      setViewState('negotiating');
      await webrtc.startOffer();
      webrtc.setQuality(PRESETS.balanced);
    } else if (msg.type === 'challenge') {
      const nonce = msg.nonce;
      computeHmacKey(password).then(hmacKey =>
        computeResponse(nonce, hmacKey).then(response => {
          sendRef.current?.({ type: 'auth_response', peer_id: session.id, response });
        })
      ).catch(() => {
        setErrMsg(t('viewer:errors.crypto'));
        setViewState('error');
        onStateChange(session.id, 'error', t('viewer:errors.crypto'));
      });
    } else if (msg.type === 'answer') {
      await webrtc.handleAnswer(msg.sdp);
    } else if (msg.type === 'ice_candidate') {
      await webrtc.handleIceCandidate(msg.candidate);
    } else if (msg.type === 'error') {
      if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current);
      const m = msg.code === 'unauthorized' ? t('viewer:errors.wrongPassword') : t('viewer:errors.machineNotFound');
      setErrMsg(m);
      setViewState('error');
      onStateChange(session.id, 'error', m);
    } else if (msg.type === 'denied') {
      if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current);
      const m = msg.reason || t('viewer:errors.connectionDenied');
      setErrMsg(m);
      setViewState('error');
      onStateChange(session.id, 'error', m);
    } else if (msg.type === 'display_list') {
      setDisplays(msg.displays);
    } else if (msg.type === 'agent_disconnected') {
      if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current);
      webrtc.disconnect();
      onStateChange(session.id, 'error', t('viewer:errors.remoteDisconnected'));
      onClose();
    }
  }, [webrtc, session.id, onStateChange, onClose, password, t]),
  useCallback(() => {
    // WebSocket failed to open / closed abnormally — don't hang on "Establishing connection".
    setViewState(prev => {
      if (prev === 'connected') return prev;
      const m = t('viewer:errors.signalingUnreachable');
      setErrMsg(m);
      onStateChange(session.id, 'error', m);
      return 'error';
    });
  }, [session.id, onStateChange, t]));

  sendRef.current = send;

  useEffect(() => () => { webrtc.disconnect(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!webrtc.stream || !videoRef.current) return;
    videoRef.current.srcObject = webrtc.stream;
    // Silent: autoplay rejection is normal browser policy (e.g. no user
    // gesture yet); the video plays once the user interacts with the tab.
    videoRef.current.play().catch(() => {});
    videoRef.current.focus();
    if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current);
    setViewState('connected');
    onStateChange(session.id, 'connected');
  }, [webrtc.stream]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (viewState !== 'negotiating') return;
    iceTimeoutRef.current = setTimeout(() => {
      const m = t('viewer:errors.remoteUnreachable');
      setErrMsg(m);
      setViewState('error');
      onStateChange(session.id, 'error', m);
      webrtc.disconnect();
    }, 15000);
    return () => { if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current); };
  }, [viewState]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoin = () => {
    setViewState('pending_approval');
    onStateChange(session.id, 'negotiating');
    send({ type: 'request_challenge', peer_id: session.id });
  };

  const handleDisconnect = () => {
    webrtc.disconnect();
    onClose();
  };

  const handleFullscreen = () => {
    // Silent both ways: fullscreen enter/exit rejections are normal OS/browser
    // behavior (e.g. permission policy, already in the requested state) and
    // the toolbar button reflects the real state either way.
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      videoRef.current?.requestFullscreen().catch(() => {});
    }
  };

  const handleDisplaySwitch = (index: number) => {
    setCurrentDisplay(index);
    sendRef.current?.({ type: 'switch_display', index });
  };

  const handleClipboardSync = () => {
    // Explicit toolbar action: if this fails, the user believes the local
    // clipboard reached the remote host when it never left this machine.
    navigator.clipboard.readText()
      .then(text => webrtc.sendClipboard(text))
      .catch(() => notify.error(t('notify:clipboardFailed')));
  };

  const center: CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1117' };
  const card: CSSProperties = { background: '#161b22', border: '1px solid #21262d', borderRadius: 10, padding: 28, width: 280 };
  const inp: CSSProperties = { width: '100%', background: '#21262d', border: '1px solid #30363d', borderRadius: 6, padding: '9px 12px', fontSize: 12, color: '#e6ebf1', marginBottom: 10, boxSizing: 'border-box', outline: 'none' };
  const btnPrimary: CSSProperties = { width: '100%', background: '#26c6da', color: '#0d1117', border: 'none', borderRadius: 6, padding: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 8 };
  const btnGhost: CSSProperties = { width: '100%', background: 'none', border: 'none', color: '#93a0b2', fontSize: 12, cursor: 'pointer', padding: 4 };

  if (viewState === 'connecting') {
    return (
      <div style={center}>
        <div style={card}>
          <div style={{ fontSize: 9, color: '#93a0b2', letterSpacing: 2, fontWeight: 700, marginBottom: 16, textTransform: 'uppercase' }}>{t('viewer:connecting.eyebrow')}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#26c6da', letterSpacing: 4, fontFamily: 'monospace', marginBottom: 16 }}>{fmt(session.id)}</div>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && password && handleJoin()}
            placeholder={t('viewer:connecting.passwordPlaceholder')}
            autoFocus
            style={inp}
          />
          <button onClick={handleJoin} disabled={!password} style={{ ...btnPrimary, opacity: !password ? 0.5 : 1 }}>
            {t('viewer:connecting.connect')}
          </button>
          <button onClick={onClose} style={btnGhost}>{t('common:cancel')}</button>
        </div>
      </div>
    );
  }

  if (viewState === 'pending_approval' || viewState === 'negotiating') {
    return (
      <div style={center}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#26c6da', margin: '0 auto 16px', animation: 'pulsedot 1s infinite' }} />
          <div style={{ color: '#b3bdca', fontSize: 13 }}>{t('viewer:negotiating.establishing')}</div>
          <button onClick={() => { webrtc.disconnect(); onClose(); }} style={{ ...btnGhost, marginTop: 16 }}>{t('common:cancel')}</button>
        </div>
        <style>{`@keyframes pulsedot{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      </div>
    );
  }

  if (viewState === 'error') {
    return (
      <div style={center}>
        <div style={{ ...card, border: '1px solid #f85149', background: '#1a0a0a', textAlign: 'center' }}>
          <div style={{ color: '#f85149', fontSize: 13, marginBottom: 16 }}>{errMsg}</div>
          <button onClick={() => { setViewState('connecting'); setErrMsg(''); }} style={{ ...btnPrimary, width: 'auto', padding: '8px 20px', marginRight: 8 }}>
            {t('viewer:error.retry')}
          </button>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #30363d', color: '#b3bdca', borderRadius: 6, padding: '8px 20px', fontSize: 12, cursor: 'pointer' }}>
            {t('viewer:error.close')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000', position: 'relative' }}>
      <ViewerToolbar
        peerId={fmt(session.id)}
        onFullscreen={handleFullscreen}
        onClipboardSync={handleClipboardSync}
        onFiles={() => setShowFiles(true)}
        onQualityChange={(q: QualitySettings) => { webrtc.setQuality(q); setTargetKbps(q.bitrate_kbps); }}
        onToggleStats={() => setShowStats((s) => !s)}
        showCursor={showCursor}
        onToggleCursor={() => setShowCursor((s) => !s)}
        onDisconnect={handleDisconnect}
      />
      <div style={{ flex: 1, position: 'relative', display: 'flex', minHeight: 0 }}>
        <DisplaySelector displays={displays} current={currentDisplay} onChange={handleDisplaySwitch} />
        <video
          ref={videoRef}
          autoPlay
          muted
          tabIndex={0}
          style={{ flex: 1, width: '100%', objectFit: 'contain', display: 'block', cursor: 'crosshair', outline: 'none' }}
          onMouseMove={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const vw = videoRef.current?.videoWidth ?? 0;
            const vh = videoRef.current?.videoHeight ?? 0;
            if (!vw || !vh) return;
            const ca = rect.width / rect.height, va = vw / vh;
            let rW: number, rH: number, oX: number, oY: number;
            if (ca > va) { rH = rect.height; rW = rH * va; oX = (rect.width - rW) / 2; oY = 0; }
            else { rW = rect.width; rH = rW / va; oX = 0; oY = (rect.height - rH) / 2; }
            const lX = e.clientX - rect.left - oX, lY = e.clientY - rect.top - oY;
            webrtc.sendInput({ type: 'mouse_move', x: lX / rW, y: lY / rH });
          }}
          onMouseDown={e => { e.preventDefault(); e.currentTarget.focus(); webrtc.sendInput({ type: 'mouse_down', button: e.button }); }}
          onMouseUp={e => { e.preventDefault(); webrtc.sendInput({ type: 'mouse_up', button: e.button }); }}
          onContextMenu={e => e.preventDefault()}
          onKeyDown={e => { e.preventDefault(); webrtc.sendInput({ type: 'key_down', key: e.key, code: e.code }); }}
          onKeyUp={e => { e.preventDefault(); webrtc.sendInput({ type: 'key_up', key: e.key, code: e.code }); }}
          onWheel={e => { e.preventDefault(); webrtc.sendInput({ type: 'scroll', delta_x: Math.round(e.deltaX), delta_y: Math.round(e.deltaY) }); }}
        />
        {showCursor && webrtc.cursor && videoRef.current && (() => {
          const r = videoRef.current.getBoundingClientRect();
          const cr = videoRef.current.parentElement?.getBoundingClientRect();
          const p = normToPx(webrtc.cursor.x, webrtc.cursor.y, { width: r.width, height: r.height },
            videoRef.current.videoWidth, videoRef.current.videoHeight);
          return p ? (
            <svg width="20" height="20" viewBox="0 0 24 24" style={{ position: 'absolute',
              left: (r.left - (cr?.left ?? r.left)) + p.left, top: (r.top - (cr?.top ?? r.top)) + p.top,
              pointerEvents: 'none', zIndex: 6,
              filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.7))' }}>
              <path d="M3 2 L3 20 L8 15 L11 21 L14 20 L11 14 L18 14 Z" fill="#fff" stroke="#000" strokeWidth="1.5" />
            </svg>
          ) : null;
        })()}
      </div>
      {showStats && <StatsOverlay stats={liveStats} targetKbps={targetKbps} />}
      {showFiles && <FileTransferModal ftChannel={webrtc.getFtChannel()} onClose={() => setShowFiles(false)} />}
    </div>
  );
}
