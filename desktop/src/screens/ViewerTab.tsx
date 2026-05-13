import { useState, useCallback, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useSignaling } from '../hooks/useSignaling';
import { useWebRTC } from '../hooks/useWebRTC';
import { ViewerToolbar } from '../components/ViewerToolbar';
import { FileTransferModal } from '../components/FileTransferModal';
import type { Session, SessionState } from '../types';
import type { SignalingMessage } from '../types/messages';

const fmt = (id: string) => id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');

interface Props {
  session: Session;
  signalingUrl: string;
  onStateChange: (id: string, state: SessionState, error?: string) => void;
  onClose: () => void;
}

export function ViewerTab({ session, signalingUrl, onStateChange, onClose }: Props) {
  const [password, setPassword] = useState('');
  const [viewState, setViewState] = useState<'connecting' | 'pending_approval' | 'negotiating' | 'connected' | 'error'>('connecting');
  const [errMsg, setErrMsg] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sendRef = useRef<((m: SignalingMessage) => void) | null>(null);
  const iceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const webrtc = useWebRTC(
    useCallback((m: SignalingMessage) => { sendRef.current?.(m); }, []),
    useCallback((text: string) => { navigator.clipboard.writeText(text).catch(() => {}); }, []),
  );

  const { send } = useSignaling(signalingUrl, useCallback(async (msg: SignalingMessage) => {
    if (msg.type === 'joined') {
      setViewState('negotiating');
      webrtc.startOffer();
    } else if (msg.type === 'answer') {
      await webrtc.handleAnswer(msg.sdp);
    } else if (msg.type === 'ice_candidate') {
      await webrtc.handleIceCandidate(msg.candidate);
    } else if (msg.type === 'error') {
      if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current);
      const m = msg.code === 'unauthorized' ? 'Wrong password' : 'Machine not found';
      setErrMsg(m);
      setViewState('error');
      onStateChange(session.id, 'error', m);
    } else if (msg.type === 'denied') {
      if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current);
      const m = msg.reason || 'Connection denied by remote machine';
      setErrMsg(m);
      setViewState('error');
      onStateChange(session.id, 'error', m);
    } else if (msg.type === 'agent_disconnected') {
      if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current);
      webrtc.disconnect();
      onStateChange(session.id, 'error', 'Remote machine disconnected');
      onClose();
    }
  }, [webrtc, session.id, onStateChange, onClose]));

  sendRef.current = send;

  useEffect(() => () => { webrtc.disconnect(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!webrtc.stream || !videoRef.current) return;
    videoRef.current.srcObject = webrtc.stream;
    videoRef.current.play().catch(() => {});
    videoRef.current.focus();
    if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current);
    setViewState('connected');
    onStateChange(session.id, 'connected');
  }, [webrtc.stream]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (viewState !== 'negotiating') return;
    iceTimeoutRef.current = setTimeout(() => {
      const m = 'Could not reach remote machine';
      setErrMsg(m);
      setViewState('error');
      onStateChange(session.id, 'error', m);
      webrtc.disconnect();
    }, 15000);
    return () => { if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current); };
  }, [viewState]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoin = () => {
    setViewState('pending_approval');
    onStateChange(session.id, 'negotiating'); // parent still sees 'negotiating'
    send({ type: 'join', peer_id: session.id, password });
  };

  const handleDisconnect = () => {
    webrtc.disconnect();
    onClose();
  };

  const handleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      videoRef.current?.requestFullscreen().catch(() => {});
    }
  };

  const handleClipboardSync = () => {
    navigator.clipboard.readText()
      .then(text => webrtc.sendClipboard(text))
      .catch(() => {});
  };

  const center: CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1117' };
  const card: CSSProperties = { background: '#161b22', border: '1px solid #21262d', borderRadius: 10, padding: 28, width: 280 };
  const inp: CSSProperties = { width: '100%', background: '#21262d', border: '1px solid #30363d', borderRadius: 6, padding: '9px 12px', fontSize: 12, color: '#c9d1d9', marginBottom: 10, boxSizing: 'border-box', outline: 'none' };
  const btnPrimary: CSSProperties = { width: '100%', background: '#26c6da', color: '#0d1117', border: 'none', borderRadius: 6, padding: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 8 };
  const btnGhost: CSSProperties = { width: '100%', background: 'none', border: 'none', color: '#484f58', fontSize: 12, cursor: 'pointer', padding: 4 };

  if (viewState === 'connecting') {
    return (
      <div style={center}>
        <div style={card}>
          <div style={{ fontSize: 9, color: '#484f58', letterSpacing: 2, fontWeight: 700, marginBottom: 16, textTransform: 'uppercase' }}>Connect to Remote</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#26c6da', letterSpacing: 4, fontFamily: 'monospace', marginBottom: 16 }}>{fmt(session.id)}</div>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && password && handleJoin()}
            placeholder="Password"
            autoFocus
            style={inp}
          />
          <button onClick={handleJoin} disabled={!password} style={{ ...btnPrimary, opacity: !password ? 0.5 : 1 }}>
            Connect
          </button>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
        </div>
      </div>
    );
  }

  if (viewState === 'pending_approval' || viewState === 'negotiating') {
    return (
      <div style={center}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#26c6da', margin: '0 auto 16px', animation: 'pulsedot 1s infinite' }} />
          <div style={{ color: '#8b949e', fontSize: 13 }}>Establishing connection...</div>
          <button onClick={() => { webrtc.disconnect(); onClose(); }} style={{ ...btnGhost, marginTop: 16 }}>Cancel</button>
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
            Retry
          </button>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', borderRadius: 6, padding: '8px 20px', fontSize: 12, cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000' }}>
      <ViewerToolbar
        peerId={fmt(session.id)}
        onFullscreen={handleFullscreen}
        onClipboardSync={handleClipboardSync}
        onFiles={() => setShowFiles(true)}
        onQualityChange={kbps => webrtc.setMaxBitrate(kbps)}
        onDisconnect={handleDisconnect}
      />
      <video
        ref={videoRef}
        autoPlay
        muted
        tabIndex={0}
        style={{ flex: 1, width: '100%', objectFit: 'contain', display: 'block', cursor: 'crosshair', outline: 'none' }}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const vw = videoRef.current?.videoWidth ?? rect.width;
          const vh = videoRef.current?.videoHeight ?? rect.height;
          webrtc.sendInput({
            type: 'mouse_move',
            x: Math.round((e.clientX - rect.left) / rect.width * vw),
            y: Math.round((e.clientY - rect.top) / rect.height * vh),
          });
        }}
        onMouseDown={e => { e.preventDefault(); e.currentTarget.focus(); webrtc.sendInput({ type: 'mouse_down', button: e.button }); }}
        onMouseUp={e => { e.preventDefault(); webrtc.sendInput({ type: 'mouse_up', button: e.button }); }}
        onContextMenu={e => e.preventDefault()}
        onKeyDown={e => { e.preventDefault(); webrtc.sendInput({ type: 'key_down', key: e.key }); }}
        onKeyUp={e => { e.preventDefault(); webrtc.sendInput({ type: 'key_up', key: e.key }); }}
        onWheel={e => { e.preventDefault(); webrtc.sendInput({ type: 'scroll', delta_x: Math.round(e.deltaX), delta_y: Math.round(e.deltaY) }); }}
      />
      {showFiles && <FileTransferModal ftChannel={webrtc.getFtChannel()} onClose={() => setShowFiles(false)} />}
    </div>
  );
}
