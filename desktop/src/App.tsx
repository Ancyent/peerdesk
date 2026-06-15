import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { HomeScreen } from './screens/HomeScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ViewerTab } from './screens/ViewerTab';
import { StatusBar } from './components/StatusBar';
import { TabBar } from './components/TabBar';
import { useAgent } from './hooks/useAgent';
import type { Session, SessionState } from './types';

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeTab, setActiveTab] = useState<'home' | 'settings' | string>('home');
  const { status, start } = useAgent();

  const signalingUrl = useMemo(() =>
    status.server_url
      ? status.server_url.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://') + '/ws'
      : 'ws://localhost:8001/ws',
  [status.server_url]);

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
      <StatusBar approvalStatus={status.approval_status} serverUrl={status.server_url} />

      <TabBar
        sessions={sessions}
        activeTab={activeTab}
        onTabSelect={setActiveTab}
        onTabClose={handleCloseSession}
        onSettings={() => setActiveTab('settings')}
      />

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
            <ViewerTab
              session={session}
              signalingUrl={signalingUrl}
              onStateChange={handleStateChange}
              onClose={() => handleCloseSession(session.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
