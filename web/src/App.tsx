// web/src/App.tsx
import { useCallback, useRef, useState } from 'react';
import { ConnectForm } from './components/ConnectForm';
import { Viewer } from './components/Viewer';
import { useSignaling } from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import type { SignalingMessage } from './types/messages';

const SIGNALING_URL = (import.meta.env.VITE_SIGNALING_URL as string | undefined)
  ?? 'ws://localhost:8001/ws';

type State = 'idle' | 'connecting' | 'connected' | 'error';

export default function App() {
  const [appState, setAppState] = useState<State>('idle');
  const [errMsg, setErrMsg] = useState('');

  const sendRef = useRef<((m: SignalingMessage) => void) | null>(null);

  const webrtc = useWebRTC(
    useCallback((m: SignalingMessage) => { sendRef.current?.(m); }, [])
  );

  const { send } = useSignaling(SIGNALING_URL, async (msg) => {
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
      setErrMsg('Remote machine disconnected');
      setAppState('error');
    }
  });

  // Sync send function into ref so webrtc hook can use it
  sendRef.current = send;

  const handleConnect = (peerId: string, password: string) => {
    setErrMsg('');
    setAppState('connecting');
    send({ type: 'join', peer_id: peerId, password });
  };

  if (appState === 'idle' || appState === 'error') {
    return <ConnectForm onConnect={handleConnect} error={errMsg || undefined} />;
  }

  if (appState === 'connecting') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif' }}>
        Connecting…
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <Viewer
        stream={webrtc.stream}
        onMouseMove={(x, y) => webrtc.sendInput({ type: 'mouse_move', x, y })}
        onMouseDown={(b) => webrtc.sendInput({ type: 'mouse_down', button: b })}
        onMouseUp={(b) => webrtc.sendInput({ type: 'mouse_up', button: b })}
        onKeyDown={(key) => webrtc.sendInput({ type: 'key_down', key })}
        onKeyUp={(key) => webrtc.sendInput({ type: 'key_up', key })}
        onScroll={(dx, dy) => webrtc.sendInput({ type: 'scroll', delta_x: dx, delta_y: dy })}
      />
    </div>
  );
}
