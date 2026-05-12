import { useState, useCallback, useRef, useEffect } from 'react';
import { useSignaling } from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import type { SignalingMessage } from './types/messages';

interface Props { onBack: () => void; }

export function ViewerMode({ onBack }: Props) {
  const [peerId, setPeerId] = useState('');
  const [password, setPassword] = useState('');
  const [signalingUrl, setSignalingUrl] = useState(
    localStorage.getItem('pd_signaling_url') ?? 'ws://localhost:8001/ws'
  );
  const [appState, setAppState] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const sendRef = useRef<((m: SignalingMessage) => void) | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const webrtc = useWebRTC(
    useCallback((m: SignalingMessage) => { sendRef.current?.(m); }, [])
  );

  const { send } = useSignaling(signalingUrl, useCallback(async (msg: SignalingMessage) => {
    if (msg.type === 'joined') {
      webrtc.startOffer();
    } else if (msg.type === 'answer') {
      await webrtc.handleAnswer(msg.sdp);
      setAppState('connected');
    } else if (msg.type === 'ice_candidate') {
      await webrtc.handleIceCandidate(msg.candidate);
    } else if (msg.type === 'error') {
      setErrMsg(msg.code === 'unauthorized' ? 'Wrong ID or password' : 'Machine not found');
      setAppState('error');
    } else if (msg.type === 'agent_disconnected') {
      webrtc.disconnect();
      setAppState('idle');
    }
  }, [webrtc]));

  sendRef.current = send;

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && webrtc.stream) {
      videoRef.current.srcObject = webrtc.stream;
      videoRef.current.play().catch(() => {});
    }
  }, [webrtc.stream]);

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg('');
    setAppState('connecting');
    localStorage.setItem('pd_signaling_url', signalingUrl);
    send({ type: 'join', peer_id: peerId, password });
  };

  const handleDisconnect = () => {
    webrtc.disconnect();
    setAppState('idle');
    setPeerId('');
    setPassword('');
  };

  const inp: React.CSSProperties = {
    padding: '10px 12px', fontSize: 14, borderRadius: 6,
    border: '1px solid #d1d5db', width: '100%', boxSizing: 'border-box', outline: 'none',
  };

  if (appState === 'connected') {
    return (
      <div style={{ width: '100vw', height: '100vh', background: '#000', position: 'relative' }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 8 }}>
          <button onClick={onBack} style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 13 }}>
            ← Back
          </button>
          <button onClick={handleDisconnect} style={{ padding: '6px 12px', background: 'rgba(220,38,38,0.8)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 13 }}>
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 400, margin: '0 auto', padding: '28px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 22 }}>←</button>
        <h2 style={{ margin: 0, fontSize: 20 }}>Connect to PC</h2>
      </div>

      {errMsg && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
          {errMsg}
        </div>
      )}

      {appState === 'connecting' ? (
        <div style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⟳</div>
          Connecting to {peerId}…
        </div>
      ) : (
        <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Remote ID</label>
            <input
              type="text"
              value={peerId}
              onChange={e => setPeerId(e.target.value.replace(/\D/g, '').slice(0, 9))}
              placeholder="9-digit ID"
              maxLength={9}
              required
              autoFocus
              style={{ ...inp, fontSize: 24, letterSpacing: 6, textAlign: 'center' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              required style={inp} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Signaling Server</label>
            <input type="text" value={signalingUrl} onChange={e => setSignalingUrl(e.target.value)}
              style={{ ...inp, fontSize: 12, color: '#6b7280' }} />
          </div>
          <button type="submit" disabled={peerId.length !== 9} style={{
            padding: '11px 0', background: '#2563eb', color: '#fff', border: 'none',
            borderRadius: 6, fontSize: 14, cursor: 'pointer', fontWeight: 600,
            opacity: peerId.length !== 9 ? 0.6 : 1,
          }}>
            Connect
          </button>
        </form>
      )}
    </div>
  );
}
