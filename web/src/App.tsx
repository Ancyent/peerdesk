import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './auth/useAuth';
import { api, type MachineOut } from './api/client';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { MachinesPage } from './pages/MachinesPage';
import { OrganizationPage } from './pages/OrganizationPage';
import { DownloadsPage } from './pages/DownloadsPage';
import { BrandingPage } from './pages/BrandingPage';
import { SettingsPage } from './pages/SettingsPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { TeamPage } from './pages/TeamPage';
import { InvitePage } from './pages/InvitePage';
import { AppShell, type AppPage } from './components/AppShell';
import { OrgTree, type OrgNode } from './components/OrgTree';
import { ConnectForm } from './components/ConnectForm';
import { Viewer } from './components/Viewer';
import { TerminalView } from './components/TerminalView';
import { OverlayControls } from './components/OverlayControls';
import type { ViewerHandle } from './components/Viewer';
import { FileTransferBar } from './components/FileTransferBar';
import { StatsOverlay } from './components/StatsOverlay';
import { useStats } from './hooks/useStats';
import { PRESETS, type QualitySettings } from './quality';
import { useSignaling } from './hooks/useSignaling';
import { useWebRTC } from './hooks/useWebRTC';
import { useClipboard } from './hooks/useClipboard';
import { useFileTransfer } from './hooks/useFileTransfer';
import { getConfig } from './config';
import type { SignalingMessage } from './types/messages';
import { parsePath, type RoutablePage } from './routing/paths';
import { useRoute } from './routing/useRoute';
import { useViewerDeepLink } from './routing/useViewerDeepLink';
import { coerceOs, type OsId } from './pages/downloads/osData';

type FullPage = AppPage | 'login' | 'register' | 'connect' | 'viewer' | 'invite';

export default function App() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { user, loading, setSessionActive, accessToken, role } = useAuth();
  const initialRoute = parsePath(window.location.pathname, window.location.search);
  const [page, setPage] = useState<FullPage>(initialRoute.page);
  const [downloadsOs, setDownloadsOs] = useState<OsId>(coerceOs(initialRoute.sub));
  const [inviteToken, setInviteToken] = useState<string | null>(
    initialRoute.page === 'invite' ? initialRoute.sub : null,
  );
  const [machineKeyFilter, setMachineKeyFilter] = useState<string | undefined>(
    initialRoute.params.key,
  );
  const [viewerMachineId, setViewerMachineId] = useState<string | null>(
    initialRoute.page === 'viewer' ? initialRoute.sub : null,
  );
  const [connectPeerId, setConnectPeerId] = useState('');
  const [connectMachineId, setConnectMachineId] = useState<string | null>(null);
  // Set when a "remember password" connect is in flight; saved once the host accepts.
  const pendingSaveRef = useRef<{ machineId: string; password: string } | null>(null);
  // machineId whose saved password we're auto-connecting with, so a wrong-password
  // failure can drop the now-stale saved value.
  const autoSavedMachineRef = useRef<string | null>(null);
  const [viewerState, setViewerState] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [displays, setDisplays] = useState<Array<{index: number; width: number; height: number; is_primary: boolean}>>([]);
  const [currentDisplay, setCurrentDisplay] = useState(0);
  const [orgNode, setOrgNode] = useState<OrgNode>({ type: 'all' });
  const sendRef = useRef<((m: SignalingMessage) => void) | null>(null);
  const clipboardReceiveRef = useRef<((text: string) => void) | null>(null);
  const viewerRef = useRef<ViewerHandle>(null);
  const fsRef = useRef<HTMLDivElement | null>(null);
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [showFileTransfer, setShowFileTransfer] = useState(false);
  const [latencyMs] = useState<number | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [showCursor, setShowCursor] = useState(true);
  const [targetKbps, setTargetKbps] = useState(PRESETS.balanced.bitrate_kbps);
  const [sessionMode, setSessionMode] = useState<'gui' | 'terminal'>('gui');

  const navigate = useRoute((p, sub, params) => {
    // Fix 1: tear down WebRTC session when navigating back from viewer or connect
    if (page === 'viewer' || page === 'connect') {
      webrtc.disconnect();
      setViewerState('idle');
      setIsViewOnly(false);
      setShowFileTransfer(false);
      setSessionMode('gui');
    }
    // Fix 2: if an authed user pops back to a login/register URL, redirect to machines
    if (user && (p === 'login' || p === 'register')) {
      window.history.replaceState({}, '', '/machines');
      setPage('machines');
      return;
    }
    setPage(p);
    if (p === 'downloads') setDownloadsOs(coerceOs(sub));
    if (p === 'invite') setInviteToken(sub);
    if (p === 'machines') setMachineKeyFilter(params.key);
    if (p === 'viewer') setViewerMachineId(sub);
  });
  const go = useCallback((p: RoutablePage, sub?: string) => {
    navigate(p, sub ?? null);
    setPage(p);
    if (p === 'downloads') setDownloadsOs(coerceOs(sub ?? null));
    if (p === 'invite') setInviteToken(sub ?? null);
    if (p === 'machines') setMachineKeyFilter(undefined);
  }, [navigate]);

  // Deep-link from ApiKeysPage's machine-count link: not a plain section
  // change (pathFor has no notion of query strings), so it writes the URL
  // itself rather than going through `navigate`.
  const goToMachinesFilteredByKey = (keyId: string) => {
    window.history.pushState({}, '', `/machines?key=${encodeURIComponent(keyId)}`);
    setMachineKeyFilter(keyId);
    setPage('machines');
  };

  // After login, don't linger on /login or /register.
  useEffect(() => {
    if (user && (page === 'login' || page === 'register')) go('machines');
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const SIGNALING_URL = getConfig().signalingUrl;

  const webrtc = useWebRTC(
    useCallback((m: SignalingMessage) => { sendRef.current?.(m); }, []),
    useCallback((text: string) => { clipboardReceiveRef.current?.(text); }, [])
  );

  const liveStats = useStats(webrtc.getPc, showStats && viewerState === 'connected');

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
    setSessionActive(viewerState === 'connected');
  }, [viewerState, setSessionActive]);

  useEffect(() => {
    if (viewerState !== 'connected') return;
    const id = setInterval(() => setSessionActive(true), 60_000);
    return () => clearInterval(id);
  }, [viewerState, setSessionActive]);

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
    if (msg.type === 'joined')             {
      await webrtc.startOffer(); webrtc.setQuality(PRESETS.balanced);
      autoSavedMachineRef.current = null;
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending && accessToken) {
        // Best-effort: the password is already applied to this session, and a
        // failure here only means it won't be remembered next time.
        api.machines.saveSavedPassword(accessToken, pending.machineId, pending.password).catch(() => {});
      }
    }
    else if (msg.type === 'answer')        { await webrtc.handleAnswer(msg.sdp); setViewerState('connected'); }
    else if (msg.type === 'ice_candidate') { await webrtc.handleIceCandidate(msg.candidate); }
    else if (msg.type === 'error')         {
      // A saved password that no longer works (host rotated it) is stale — drop it
      // so we stop auto-connecting with it and fall back to manual entry.
      if (msg.code === 'unauthorized' && autoSavedMachineRef.current && accessToken) {
        // Best-effort cleanup of a stale saved password: if this fails we'll
        // just try it again and get the same "wrong credentials" error next
        // connect attempt, same as if we'd never cleared it.
        api.machines.clearSavedPassword(accessToken, autoSavedMachineRef.current).catch(() => {});
      }
      autoSavedMachineRef.current = null;
      pendingSaveRef.current = null;
      setErrMsg(msg.code === 'unauthorized' ? t('dashboard:viewer.errors.wrongCredentials') : t('dashboard:viewer.errors.machineNotFound')); setViewerState('error'); setPage('connect');
    }
    else if (msg.type === 'agent_disconnected') { webrtc.disconnect(); setErrMsg(t('dashboard:viewer.errors.remoteDisconnected')); setViewerState('error'); go('machines'); }
    else if (msg.type === 'denied')        { webrtc.disconnect(); setErrMsg(msg.reason ?? t('dashboard:viewer.errors.connectionDenied')); setViewerState('error'); setPage('connect'); }
    else if (msg.type === 'session_mode')  { setSessionMode(msg.mode); }
    else if (msg.type === 'display_list')  {
      setDisplays(msg.displays);
      // Always start a fresh connection on the default (primary) monitor, not
      // wherever a previous session was left.
      const primary = msg.displays.find(d => d.is_primary) ?? msg.displays[0];
      if (primary) { setCurrentDisplay(primary.index); send({ type: 'switch_display', index: primary.index }); }
    }
  });
  sendRef.current = send;

  const handleConnect = (peerId: string, password: string, remember = false) => {
    setErrMsg(''); setViewerState('connecting'); setPage('viewer');
    // Guard on peerId === connectPeerId so editing the ID away from the picked
    // machine doesn't save the password under the wrong machine.
    pendingSaveRef.current = (remember && connectMachineId && peerId === connectPeerId)
      ? { machineId: connectMachineId, password } : null;
    autoSavedMachineRef.current = null;
    send({ type: 'join', peer_id: peerId, password });
  };

  const handleDashboardConnect = async (machine: MachineOut) => {
    navigate('viewer', machine.id);
    setViewerMachineId(machine.id);
    setConnectPeerId(machine.peer_id); setConnectMachineId(machine.id); setErrMsg('');
    // If a password is saved for this machine, connect straight away.
    if (machine.has_saved_password && accessToken) {
      try {
        const { password } = await api.machines.getSavedPassword(accessToken, machine.id);
        pendingSaveRef.current = null;
        autoSavedMachineRef.current = machine.id;
        setViewerState('connecting'); setPage('viewer');
        send({ type: 'join', peer_id: machine.peer_id, password });
        return;
      } catch { /* fall through to the manual form */ }
    }
    setViewerState('idle'); setPage('connect');
  };

  const handleDisplaySwitch = useCallback((index: number) => {
    setCurrentDisplay(index); send({ type: 'switch_display', index });
  }, [send]);

  useViewerDeepLink({
    enabled: !!user && !!accessToken && page === 'viewer',
    machineId: viewerMachineId,
    // `enabled` already requires a token, but TypeScript cannot narrow it
    // through the object, and a non-null assertion would add a lint error to a
    // count that must not rise.
    fetchMachine: (id) => accessToken
      ? api.machines.get(accessToken, id)
      : Promise.reject(new Error('not signed in')),
    onMachine: handleDashboardConnect,
    onNotFound: () => {
      setErrMsg(t('dashboard:viewer.errors.machineNotFound'));
      setViewerState('error');
    },
  });

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#9ca3af', fontFamily: 'sans-serif' }}>{t('common:loading')}</div>
  );

  if (!user) {
    if (page === 'invite' && inviteToken) return <InvitePage token={inviteToken} />;
    if (page === 'register') return <RegisterPage onGoLogin={() => go('login')} />;
    return <LoginPage onGoRegister={() => go('register')} />;
  }

  // Fix 2: an authed user who navigated back to /login or /register sees machines
  const effectivePage: FullPage = user && (page === 'login' || page === 'register') ? 'machines' : page;

  // A signed-in user can also open an invite link (e.g. to join a second
  // account) -- InvitePage itself branches on whether useAuth() has a user.
  if (effectivePage === 'invite') return <InvitePage token={inviteToken ?? ''} />;

  if (effectivePage === 'viewer') {
    if (viewerState === 'connecting' || (viewerState === 'idle' && viewerMachineId)) return (
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
          <div style={{ color: 'var(--text-2)', fontSize: 14 }}>{t('dashboard:viewer.connecting')}</div>
          <div style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'monospace', marginTop: 6 }}>
            {connectPeerId.replace(/(\d{3})(\d{3})(\d{3})/, '$1 · $2 · $3')}
          </div>
        </div>
      </div>
    );
    if (viewerState === 'connected') return (
      <div ref={fsRef} style={{ width: '100vw', height: '100vh', background: '#000', position: 'relative', overflow: 'hidden' }}>
        {showStats && <StatsOverlay stats={liveStats} targetKbps={targetKbps} />}
        {sessionMode === 'terminal'
          ? <TerminalView channel={webrtc.getTerminalChannel()} />
          : <Viewer
              ref={viewerRef}
              stream={webrtc.stream}
              isViewOnly={isViewOnly}
              cursor={showCursor ? webrtc.cursor : null}
              onMouseMove={(x, y) => webrtc.sendInput({ type: 'mouse_move', x, y })}
              onMouseDown={(b) => webrtc.sendInput({ type: 'mouse_down', button: b })}
              onMouseUp={(b) => webrtc.sendInput({ type: 'mouse_up', button: b })}
              onKeyDown={(key, code) => webrtc.sendInput({ type: 'key_down', key, code })}
              onKeyUp={(key, code) => webrtc.sendInput({ type: 'key_up', key, code })}
              onScroll={(dx, dy) => webrtc.sendInput({ type: 'scroll', delta_x: dx, delta_y: dy })}
            />}
        <OverlayControls
          peerId={connectPeerId}
          latencyMs={latencyMs}
          fps={fps}
          isViewOnly={isViewOnly}
          videoRef={{ current: viewerRef.current?.videoElement ?? null } as React.RefObject<HTMLVideoElement | null>}
          fullscreenTargetRef={fsRef}
          onDisconnect={() => { webrtc.disconnect(); setViewerState('idle'); go('machines'); setIsViewOnly(false); setShowFileTransfer(false); setSessionMode('gui'); }}
          onCtrlAltDel={() => {
            webrtc.sendInput({ type: 'key_down', key: 'Control', code: 'ControlLeft' });
            webrtc.sendInput({ type: 'key_down', key: 'Alt', code: 'AltLeft' });
            webrtc.sendInput({ type: 'key_down', key: 'Delete', code: 'Delete' });
            webrtc.sendInput({ type: 'key_up', key: 'Delete', code: 'Delete' });
            webrtc.sendInput({ type: 'key_up', key: 'Alt', code: 'AltLeft' });
            webrtc.sendInput({ type: 'key_up', key: 'Control', code: 'ControlLeft' });
          }}
          onToggleViewOnly={() => setIsViewOnly(v => !v)}
          onFileTransfer={() => setShowFileTransfer(v => !v)}
          onQualityChange={(q: QualitySettings) => { webrtc.setQuality(q); setTargetKbps(q.bitrate_kbps); }}
          showStats={showStats}
          onToggleStats={() => setShowStats((s) => !s)}
          showCursor={showCursor}
          onToggleCursor={() => setShowCursor((s) => !s)}
          displays={displays}
          currentDisplay={currentDisplay}
          onDisplayChange={handleDisplaySwitch}
        />
        {(showFileTransfer || transfer) && (
          <FileTransferBar transfer={transfer} onSendFile={sendFile} />
        )}
      </div>
    );
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-base)', gap: 16,
        fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{ color: 'var(--text-2)', fontSize: 14 }}>{errMsg || t('dashboard:viewer.sessionEnded')}</div>
        <button onClick={() => { setViewerState('idle'); setPage('connect'); }}
          style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border-dim)',
            background: 'var(--bg-hover)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 13 }}>
          {t('dashboard:viewer.back')}
        </button>
      </div>
    );
  }

  if (effectivePage === 'connect') return (
    <ConnectForm onConnect={handleConnect} initialPeerId={connectPeerId} error={errMsg || undefined} canSave={!!connectMachineId} />
  );

  const shellPage: AppPage = ['login', 'register', 'connect', 'viewer'].includes(effectivePage) ? 'machines' : effectivePage as AppPage;

  const orgPanel = effectivePage === 'organization'
    ? <OrgTree selected={orgNode} onSelect={setOrgNode} machineCounts={{}} />
    : undefined;

  return (
    <AppShell page={shellPage} onNavigate={p => go(p)} contextPanel={orgPanel}>
      {effectivePage === 'machines'      && <MachinesPage onConnect={handleDashboardConnect} filterKeyId={machineKeyFilter} />}
      {effectivePage === 'organization'  && <OrganizationPage onConnect={handleDashboardConnect} orgNode={orgNode} />}
      {effectivePage === 'api-keys'      && <ApiKeysPage onNavigateToMachines={goToMachinesFilteredByKey} />}
      {effectivePage === 'downloads'     && <DownloadsPage os={downloadsOs} onOsChange={(o) => go('downloads', o)} />}
      {effectivePage === 'branding'      && <BrandingPage onBack={() => go('machines')} />}
      {effectivePage === 'settings'      && <SettingsPage />}
      {effectivePage === 'team'          && role === 'admin' && <TeamPage />}
    </AppShell>
  );
}
