import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentContext, useSettingsContext } from '../context/AppContext';
import { ModeDropdown } from '../components/ModeDropdown';
import { RecentItem } from '../components/RecentItem';
import { SecurityCodeBanner } from '../components/SecurityCodeBanner';
import { getRecents, addRecent } from '../lib/recents';

interface Props {
  onConnect: (peerId: string) => void;
}

const fmt = (id: string) => id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');

export function HomeScreen({ onConnect }: Props) {
  const { status, loading, start } = useAgentContext();
  const { settings, updateSetting } = useSettingsContext();
  const [connectId, setConnectId] = useState('');
  const [newPwd, setNewPwd] = useState<string | null>(null);
  const [securityCode, setSecurityCode] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [recents, setRecents] = useState(() => getRecents());

  const handleConnect = (peerId: string) => {
    setRecents(addRecent(peerId));
    onConnect(peerId);
  };

  const denied = status.approval_status === 'denied';

  const handleResetPwd = async () => {
    try {
      setNewPwd(await invoke<string>('reset_password'));
    } catch { /* ignore */ }
  };

  const cleanId = connectId.replace(/\s/g, '');

  return (
    <div style={{ flex: 1, display: 'flex', gap: 12, padding: 16, overflow: 'hidden' }}>
      {/* Left: This Device */}
      <div style={{ flex: 1, background: '#161b22', borderRadius: 10, padding: 18, border: '1px solid #21262d', overflow: 'auto' }}>
        <div style={{ fontSize: 9, color: '#484f58', letterSpacing: 2, fontWeight: 700, marginBottom: 14, textTransform: 'uppercase' }}>
          This Device
        </div>

        {status.peer_id ? (
          <>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#26c6da', letterSpacing: 4, fontFamily: 'monospace', marginBottom: 14 }}>
              {fmt(status.peer_id)}
            </div>

            <div style={{ fontSize: 10, color: '#484f58', marginBottom: 5 }}>Password</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              {status.password ? (
                <div style={{ fontSize: 18, color: '#26c6da', letterSpacing: 2, flex: 1, fontFamily: 'monospace', fontWeight: 600 }}>
                  {showPwd ? status.password : '•'.repeat(status.password.length)}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#8b949e', flex: 1 }}>•••••• — reset to set a visible password</div>
              )}
              {status.password && (
                <button
                  onClick={() => setShowPwd((v) => !v)}
                  title={showPwd ? 'Hide' : 'Show'}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'rgba(38,198,218,0.10)', border: '1px solid rgba(38,198,218,0.30)', borderRadius: 6, color: '#26c6da', cursor: 'pointer' }}
                >
                  {showPwd ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              )}
              {status.password && (
                <button
                  onClick={() => navigator.clipboard.writeText(status.password!)}
                  title="Copy password"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'rgba(38,198,218,0.10)', border: '1px solid rgba(38,198,218,0.30)', borderRadius: 6, color: '#26c6da', cursor: 'pointer' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                </button>
              )}
              <button
                onClick={handleResetPwd}
                title="Reset password"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'rgba(38,198,218,0.10)', border: '1px solid rgba(38,198,218,0.30)', borderRadius: 6, color: '#26c6da', cursor: 'pointer' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
              </button>
            </div>

            {newPwd && (
              <div style={{ background: '#0a2a2e', border: '1px solid #26c6da', borderRadius: 6, padding: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 4 }}>New password — copy now:</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, fontSize: 12, color: '#26c6da', fontFamily: 'monospace' }}>{newPwd}</code>
                  <button onClick={() => { navigator.clipboard.writeText(newPwd!); setNewPwd(null); }} style={{ background: '#26c6da', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 10, color: '#0d1117', fontWeight: 700, cursor: 'pointer' }}>Copy</button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {status.approval_status !== 'standalone' && (
                <span style={{
                  padding: '3px 9px', borderRadius: 12, fontSize: 9, fontWeight: 600,
                  background: denied ? '#3a1a1a' : status.approval_status === 'pending' ? '#3a2a0a' : '#1a3a1a',
                  color: denied ? '#f85149' : status.approval_status === 'pending' ? '#e3b341' : '#56d364',
                }}>
                  ● {denied ? 'Denied' : status.approval_status === 'pending' ? 'Pending' : 'Approved'}
                </span>
              )}
              {status.server_url && (
                <span style={{ padding: '3px 9px', borderRadius: 12, fontSize: 9, background: '#0a2a2e', color: '#26c6da' }}>
                  {status.server_url.replace(/^https?:\/\//, '')}
                </span>
              )}
            </div>

            {securityCode && (
              <SecurityCodeBanner code={securityCode} onDismiss={() => setSecurityCode(null)} />
            )}

            <div style={{ fontSize: 10, color: '#484f58', marginBottom: 5 }}>Access mode</div>
            <ModeDropdown value={settings.access_mode} onChange={(m) => updateSetting('access_mode', m)} />
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#8b949e' }}>Agent not running</div>
            <button onClick={start} disabled={loading} style={{ background: '#26c6da', color: '#0d1117', border: 'none', borderRadius: 6, padding: '8px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Starting…' : 'Start Agent'}
            </button>
          </div>
        )}
      </div>

      {/* Right: Connect to Remote */}
      <div style={{ flex: 1, background: '#161b22', borderRadius: 10, padding: 18, border: '1px solid #21262d', overflow: 'auto' }}>
        <div style={{ fontSize: 9, color: '#484f58', letterSpacing: 2, fontWeight: 700, marginBottom: 14, textTransform: 'uppercase' }}>
          Connect to Remote
        </div>

        <input
          value={connectId}
          onChange={e => setConnectId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && cleanId.length === 9 && handleConnect(cleanId)}
          placeholder="Enter Peer ID  (e.g. 987 654 321)"
          style={{ width: '100%', background: '#21262d', border: '1px solid #30363d', borderRadius: 6, padding: '9px 12px', fontSize: 12, color: '#c9d1d9', marginBottom: 8, boxSizing: 'border-box', outline: 'none' }}
        />
        <button
          onClick={() => handleConnect(cleanId)}
          disabled={cleanId.length !== 9}
          style={{ width: '100%', background: '#26c6da', color: '#0d1117', border: 'none', borderRadius: 6, padding: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 16, opacity: cleanId.length !== 9 ? 0.5 : 1 }}
        >
          Connect
        </button>

        <div style={{ fontSize: 9, color: '#484f58', letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>Recent</div>
        {recents.length === 0 ? (
          <div style={{ fontSize: 11, color: '#484f58', padding: '10px 0', textAlign: 'center' }}>
            No recent connections
          </div>
        ) : (
          recents.map(r => (
            <RecentItem key={r.peerId} peerId={r.peerId} onConnect={handleConnect} />
          ))
        )}
      </div>
    </div>
  );
}
