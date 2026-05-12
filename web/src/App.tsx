import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from './auth/useAuth';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { ConnectForm } from './components/ConnectForm';
import { Viewer } from './components/Viewer';
import { FileTransferBar } from './components/FileTransferBar';
import { DisplaySelector } from './components/DisplaySelector';
import { useSignaling } from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import { useClipboard } from './hooks/useClipboard';
import { useFileTransfer } from './hooks/useFileTransfer';
import type { SignalingMessage } from './types/messages';

const SIGNALING_URL = (import.meta.env.VITE_SIGNALING_URL as string | undefined)
  ?? 'ws://localhost:8001/ws';

type AppPage = 'login' | 'register' | 'dashboard' | 'connect' | 'viewer';
type ViewerState = 'idle' | 'connecting' | 'connected' | 'error';

export default function App() {
  const { user, loading } = useAuth();
  const [page, setPage] = useState<AppPage>('dashboard');
  const [connectPeerId, setConnectPeerId] = useState('');
  const [viewerState, setViewerState] = useState<ViewerState>('idle');
  const [errMsg, setErrMsg] = useState('');
  const sendRef = useRef<((m: SignalingMessage) => void) | null>(null);
  const [displays, setDisplays] = useState<Array<{index: number; width: number; height: number; is_primary: boolean}>>([]);
  const [currentDisplay, setCurrentDisplay] = useState(0);

  // Temporary ref for clipboard receive — set after useClipboard is called
  const clipboardReceiveRef = useRef<((text: string) => void) | null>(null);

  const webrtc = useWebRTC(
    useCallback((m: SignalingMessage) => { sendRef.current?.(m); }, []),
    useCallback((text: string) => { clipboardReceiveRef.current?.(text); }, [])
  );

  const { receiveFromAgent } = useClipboard(
    webrtc.stream ? webrtc.sendClipboard : null  // only sync when connected
  );
  clipboardReceiveRef.current = receiveFromAgent;

  const ftChannel = webrtc.getFtChannel?.() ?? null;
  const { transfer, sendFile, handleMessage: handleFtMessage } = useFileTransfer(ftChannel);

  // Wire the ft channel onmessage when the stream is connected
  useEffect(() => {
    const ch = webrtc.getFtChannel?.();
    if (!ch) return;
    ch.onmessage = (e: MessageEvent) => handleFtMessage(e.data as string | ArrayBuffer);
  }, [webrtc.stream, handleFtMessage, webrtc]);

  const { send } = useSignaling(SIGNALING_URL, async (msg) => {
    if (msg.type === 'joined') {
      webrtc.startOffer();
    } else if (msg.type === 'answer') {
      await webrtc.handleAnswer(msg.sdp);
      setViewerState('connected');
    } else if (msg.type === 'ice_candidate') {
      await webrtc.handleIceCandidate(msg.candidate);
    } else if (msg.type === 'error') {
      setErrMsg(msg.code === 'unauthorized' ? 'Wrong ID or password' : 'Machine not found');
      setViewerState('error');
      setPage('connect');
    } else if (msg.type === 'agent_disconnected') {
      webrtc.disconnect();
      setErrMsg('Remote machine disconnected');
      setViewerState('error');
      setPage('dashboard');
    } else if (msg.type === 'denied') {
      webrtc.disconnect();
      setErrMsg(msg.reason ?? 'Connection denied by host');
      setViewerState('error');
      setPage('connect');
    } else if (msg.type === 'display_list') {
      setDisplays(msg.displays);
    }
  });
  sendRef.current = send;

  const handleConnect = (peerId: string, password: string) => {
    setErrMsg('');
    setViewerState('connecting');
    setPage('viewer');
    send({ type: 'join', peer_id: peerId, password });
  };

  const handleDashboardConnect = (peerId: string) => {
    setConnectPeerId(peerId);
    setErrMsg('');
    setViewerState('idle');
    setPage('connect');
  };

  const handleDisplaySwitch = useCallback((index: number) => {
    setCurrentDisplay(index);
    send({ type: 'switch_display', index });
  }, [send]);

  // Loading screen while checking stored token
  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'sans-serif', color:'#9ca3af' }}>
        Loading…
      </div>
    );
  }

  // Auth gate
  if (!user) {
    if (page === 'register') return <RegisterPage onGoLogin={() => setPage('login')} />;
    return <LoginPage onGoRegister={() => setPage('register')} />;
  }

  // Viewer
  if (page === 'viewer') {
    if (viewerState === 'connecting') {
      return (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'sans-serif', color:'#6b7280' }}>
          Connecting to {connectPeerId}…
        </div>
      );
    }
    if (viewerState === 'connected') {
      return (
        <div style={{ width:'100vw', height:'100vh', background:'#000', position: 'relative' }}>
          <Viewer
            stream={webrtc.stream}
            onMouseMove={(x, y) => webrtc.sendInput({ type:'mouse_move', x, y })}
            onMouseDown={(b) => webrtc.sendInput({ type:'mouse_down', button: b })}
            onMouseUp={(b) => webrtc.sendInput({ type:'mouse_up', button: b })}
            onKeyDown={(key) => webrtc.sendInput({ type:'key_down', key })}
            onKeyUp={(key) => webrtc.sendInput({ type:'key_up', key })}
            onScroll={(dx, dy) => webrtc.sendInput({ type:'scroll', delta_x: dx, delta_y: dy })}
          />
          <DisplaySelector
            displays={displays}
            current={currentDisplay}
            onChange={handleDisplaySwitch}
          />
          <FileTransferBar transfer={transfer} onSendFile={sendFile} />
        </div>
      );
    }
  }

  // Connect form (manual ID entry or pre-filled from dashboard)
  if (page === 'connect') {
    return <ConnectForm onConnect={handleConnect} initialPeerId={connectPeerId} error={errMsg || undefined} />;
  }

  // Dashboard (default)
  return <DashboardPage onConnect={handleDashboardConnect} />;
}
