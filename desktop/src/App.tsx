import { useState, useEffect, useRef, useCallback } from 'react';
import { HomeScreen } from './screens/HomeScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { StatusBar } from './components/StatusBar';
import { useAgent } from './hooks/useAgent';
import type { Session, SessionState } from './types';

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeTab, setActiveTab] = useState<'home' | 'settings' | string>('home');
  const { status, start } = useAgent();

  const signalingUrl = status.server_url
    ? status.server_url.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://') + '/ws'
    : 'ws://localhost:8001/ws';

  const startedRef = useRef(false);
  useEffect(() => {
    if (!startedRef.current && !status.running) {
      startedRef.current = true;
      start();
    }
  }, [status.running, start]);

  const handleConnect = useCallback((peerId: string) => {
    setSessions(prev => {
      if (prev.find(s => s.id === peerId)) return prev;
      return [...prev, { id: peerId, state: 'connecting' as SessionState }];
    });
    setActiveTab(peerId);
  }, []);

  const handleStateChange = useCallback((id: string, state: SessionState, error?: string) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, state, error } : s));
  }, []);

  const handleCloseSession = useCallback((id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    setActiveTab(prev => prev === id ? 'home' : prev);
  }, []);

  return (
    <div style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', background: '#0d1117', height: '100vh', display: 'flex', flexDirection: 'column', color: '#e6edf3' }}>
      {/* Title bar */}
      <div style={{ background: '#161b22', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: '1px solid #21262d', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['#ff5f56', '#febc2e', '#27c93f'] as const).map((c, i) => (
            <div key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: c }} />
          ))}
        </div>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 12, color: '#8b949e', fontWeight: 500 }}>PeerDesk</div>
        <div style={{ width: 16 }} />
      </div>

      <StatusBar approvalStatus={status.approval_status} serverUrl={status.server_url} />

      {/* Tab bar — replaced by TabBar component in Task 2 */}
      <div style={{ background: '#161b22', padding: '0 8px', display: 'flex', alignItems: 'center', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
        {(['home', ...sessions.map(s => s.id)] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{ background: 'none', border: 'none', borderBottom: activeTab === tab ? '2px solid #26c6da' : '2px solid transparent', color: activeTab === tab ? '#26c6da' : '#8b949e', padding: '8px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {tab === 'home' ? 'Home' : tab}
            {tab !== 'home' && (
              <span onClick={e => { e.stopPropagation(); handleCloseSession(tab); }} style={{ opacity: 0.5, fontSize: 14 }}>×</span>
            )}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setActiveTab('settings')} style={{ background: 'none', border: 'none', color: '#484f58', cursor: 'pointer', fontSize: 16, padding: '4px 8px' }}>⚙</button>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{ display: activeTab === 'home' ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
          <HomeScreen onConnect={handleConnect} />
        </div>
        {activeTab === 'settings' && (
          <SettingsScreen onBack={() => setActiveTab('home')} />
        )}
        {sessions.map(session => (
          <div key={session.id} style={{ display: activeTab === session.id ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
            {/* ViewerTab wired in Task 7 */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1117', color: '#484f58', fontSize: 12 }}>
              Session {session.id} — loading viewer...
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
