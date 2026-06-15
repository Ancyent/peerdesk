import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from './auth/useAuth';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { MachinesPage } from './pages/MachinesPage';
import { OrganizationPage } from './pages/OrganizationPage';
import { AgentInstallPage } from './pages/AgentInstallPage';
import { DownloadsPage } from './pages/DownloadsPage';
import { BrandingPage } from './pages/BrandingPage';
import { SettingsPage } from './pages/SettingsPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { AppShell, type AppPage } from './components/AppShell';
import { OrgTree, type OrgNode } from './components/OrgTree';
import { ConnectForm } from './components/ConnectForm';
import { Viewer } from './components/Viewer';
import { SessionToolbar } from './components/SessionToolbar';
import type { ViewerHandle } from './components/Viewer';
import { FileTransferBar } from './components/FileTransferBar';
import { DisplaySelector } from './components/DisplaySelector';
import { useSignaling } from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import { useClipboard } from './hooks/useClipboard';
import { useFileTransfer } from './hooks/useFileTransfer';
import { getConfig } from './config';
import type { SignalingMessage } from './types/messages';

type FullPage = AppPage | 'login' | 'register' | 'connect' | 'viewer';

export default function App() {
  const { user, loading } = useAuth();
  const [page, setPage] = useState<FullPage>('machines');
  const [connectPeerId, setConnectPeerId] = useState('');
  const [viewerState, setViewerState] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [displays, setDisplays] = useState<Array<{index: number; width: number; height: number; is_primary: boolean}>>([]);
  const [currentDisplay, setCurrentDisplay] = useState(0);
  const [orgNode, setOrgNode] = useState<OrgNode>({ type: 'all' });
  const sendRef = useRef<((m: SignalingMessage) => void) | null>(null);
  const clipboardReceiveRef = useRef<((text: string) => void) | null>(null);
  const viewerRef = useRef<ViewerHandle>(null);
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [showFileTransfer, setShowFileTransfer] = useState(false);
  const [latencyMs] = useState<number | null>(null);
  const [fps, setFps] = useState<number | null>(null);

  const SIGNALING_URL = getConfig().signalingUrl;

  const webrtc = useWebRTC(
    useCallback((m: SignalingMessage) => { sendRef.current?.(m); }, []),
    useCallback((text: string) => { clipboardReceiveRef.current?.(text); }, [])
  );

  const { receiveFromAgent } = useClipboard(webrtc.stream ? webrtc.sendClipboard : null);
  clipboardReceiveRef.current = receiveFromAgent;

  const ftChannel = webrtc.getFtChannel?.() ?? null;
  const { transfer, sendFile, handleMessage: handleFtMessage } = useFileTransfer(ftChannel);

  useEffect(() => {
    const ch = webrtc.getFtChannel?.();
    if (!ch) return;
    ch.onmessage = (e: MessageEvent) => handleFtMessage(e.data as string | ArrayBuffer);
  }, [webrtc.stream, handleFtMessage, webrtc]);

  useEffect(() => {
    if (viewerState !== 'connected') return;
    let frames = 0;
    let rafId: number;
    const tick = () => { frames++; rafId = requestAnimationFrame(tick); };
    rafId = requestAnimationFrame(tick);
    const id = setInterval(() => { setFps(frames); frames = 0; }, 1000);
    return () => { cancelAnimationFrame(rafId); clearInterval(id); };
  }, [viewerState]);

  const { send } = useSignaling(SIGNALING_URL, async (msg) => {
    if (msg.type === 'joined')             { webrtc.startOffer(); }
    else if (msg.type === 'answer')        { await webrtc.handleAnswer(msg.sdp); setViewerState('connected'); }
    else if (msg.type === 'ice_candidate') { await webrtc.handleIceCandidate(msg.candidate); }
    else if (msg.type === 'error')         { setErrMsg(msg.code === 'unauthorized' ? 'Wrong ID or password' : 'Machine not found'); setViewerState('error'); setPage('connect'); }
    else if (msg.type === 'agent_disconnected') { webrtc.disconnect(); setErrMsg('Remote machine disconnected'); setViewerState('error'); setPage('machines'); }
    else if (msg.type === 'denied')        { webrtc.disconnect(); setErrMsg(msg.reason ?? 'Connection denied'); setViewerState('error'); setPage('connect'); }
    else if (msg.type === 'display_list')  { setDisplays(msg.displays); }
  });
  sendRef.current = send;

  const handleConnect = (peerId: string, password: string) => {
    setErrMsg(''); setViewerState('connecting'); setPage('viewer');
    send({ type: 'join', peer_id: peerId, password });
  };

  const handleDashboardConnect = (peerId: string) => {
    setConnectPeerId(peerId); setErrMsg(''); setViewerState('idle'); setPage('connect');
  };

  const handleDisplaySwitch = useCallback((index: number) => {
    setCurrentDisplay(index); send({ type: 'switch_display', index });
  }, [send]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#9ca3af', fontFamily: 'sans-serif' }}>Loading…</div>
  );

  if (!user) {
    if (page === 'register') return <RegisterPage onGoLogin={() => setPage('login')} />;
    return <LoginPage onGoRegister={() => setPage('register')} />;
  }

  if (page === 'viewer') {
    if (viewerState === 'connecting') return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-base)', gap: 20,
        fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{
          width: 44, height: 44,
          border: '2px solid rgba(0,200,150,0.15)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--text-2)', fontSize: 14 }}>Conectare în curs...</div>
          <div style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'monospace', marginTop: 6 }}>
            {connectPeerId.replace(/(\d{3})(\d{3})(\d{3})/, '$1 · $2 · $3')}
          </div>
        </div>
      </div>
    );
    if (viewerState === 'connected') return (
      <div style={{ width: '100vw', height: '100vh', background: '#000', display: 'flex', flexDirection: 'column' }}>
        <SessionToolbar
          peerId={connectPeerId}
          latencyMs={latencyMs}
          fps={fps}
          isViewOnly={isViewOnly}
          videoRef={{ current: viewerRef.current?.videoElement ?? null } as React.RefObject<HTMLVideoElement | null>}
          onDisconnect={() => { webrtc.disconnect(); setViewerState('idle'); setPage('machines'); setIsViewOnly(false); setShowFileTransfer(false); }}
          onCtrlAltDel={() => {
            webrtc.sendInput({ type: 'key_down', key: 'Control' });
            webrtc.sendInput({ type: 'key_down', key: 'Alt' });
            webrtc.sendInput({ type: 'key_down', key: 'Delete' });
            webrtc.sendInput({ type: 'key_up', key: 'Delete' });
            webrtc.sendInput({ type: 'key_up', key: 'Alt' });
            webrtc.sendInput({ type: 'key_up', key: 'Control' });
          }}
          onToggleViewOnly={() => setIsViewOnly(v => !v)}
          onFileTransfer={() => setShowFileTransfer(v => !v)}
        />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <Viewer
            ref={viewerRef}
            stream={webrtc.stream}
            isViewOnly={isViewOnly}
            onMouseMove={(x, y) => webrtc.sendInput({ type: 'mouse_move', x, y })}
            onMouseDown={(b) => webrtc.sendInput({ type: 'mouse_down', button: b })}
            onMouseUp={(b) => webrtc.sendInput({ type: 'mouse_up', button: b })}
            onKeyDown={(key) => webrtc.sendInput({ type: 'key_down', key })}
            onKeyUp={(key) => webrtc.sendInput({ type: 'key_up', key })}
            onScroll={(dx, dy) => webrtc.sendInput({ type: 'scroll', delta_x: dx, delta_y: dy })}
          />
          <DisplaySelector displays={displays} current={currentDisplay} onChange={handleDisplaySwitch} />
          {(showFileTransfer || transfer) && (
            <FileTransferBar transfer={transfer} onSendFile={sendFile} />
          )}
        </div>
      </div>
    );
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-base)', gap: 16,
        fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{ color: 'var(--text-2)', fontSize: 14 }}>{errMsg || 'Sesiunea s-a încheiat'}</div>
        <button onClick={() => { setViewerState('idle'); setPage('connect'); }}
          style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border-dim)',
            background: 'var(--bg-hover)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 13 }}>
          Înapoi
        </button>
      </div>
    );
  }

  if (page === 'connect') return (
    <ConnectForm onConnect={handleConnect} initialPeerId={connectPeerId} error={errMsg || undefined} />
  );

  const shellPage: AppPage = ['login', 'register', 'connect', 'viewer'].includes(page) ? 'machines' : page as AppPage;

  const orgPanel = page === 'organization'
    ? <OrgTree selected={orgNode} onSelect={setOrgNode} machineCounts={{}} />
    : undefined;

  return (
    <AppShell page={shellPage} onNavigate={p => setPage(p)} contextPanel={orgPanel}>
      {page === 'machines'      && <MachinesPage onConnect={handleDashboardConnect} />}
      {page === 'organization'  && <OrganizationPage onConnect={handleDashboardConnect} orgNode={orgNode} />}
      {page === 'agent-install' && <AgentInstallPage />}
      {page === 'api-keys'      && <ApiKeysPage />}
      {page === 'downloads'     && <DownloadsPage />}
      {page === 'branding'      && <BrandingPage onBack={() => setPage('machines')} />}
      {page === 'settings'      && <SettingsPage />}
    </AppShell>
  );
}
