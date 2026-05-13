import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgent } from '../hooks/useAgent';
import { useSettings } from '../hooks/useSettings';
import { StatusBar } from '../components/StatusBar';
import { ModeDropdown } from '../components/ModeDropdown';
import { RecentItem } from '../components/RecentItem';

interface Props {
  onOpenSettings: () => void;
}

const RECENT = [
  { name: 'Desktop PC — Birou', peerId: '987654321', online: true },
  { name: 'Work Server', peerId: '456789123', online: false },
  { name: 'Laptop personal', peerId: '321654987', online: false },
];

const fmt = (id: string) => id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');

export function HomeScreen({ onOpenSettings }: Props) {
  const { status, loading, start } = useAgent();
  const { settings, updateSetting } = useSettings();
  const [connectId, setConnectId] = useState('');
  const [newPwd, setNewPwd] = useState<string | null>(null);

  const handleConnect = useCallback((peerId: string) => {
    // TODO: open viewer window
  }, []);

  const handleResetPwd = async () => {
    try {
      setNewPwd(await invoke<string>('reset_password'));
    } catch {
      /* ignore */
    }
  };

  const cleanId = connectId.replace(/\s/g, '');

  return (
    <div
      style={{
        fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        background: '#0d1117',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        color: '#e6edf3',
      }}
    >
      {/* Title bar */}
      <div
        style={{
          background: '#161b22',
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          borderBottom: '1px solid #21262d',
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          {['#ff5f56', '#febc2e', '#27c93f'].map((c, i) => (
            <div key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: c }} />
          ))}
        </div>
        <div
          style={{ flex: 1, textAlign: 'center', fontSize: 12, color: '#8b949e', fontWeight: 500 }}
        >
          PeerDesk
        </div>
        <button
          onClick={onOpenSettings}
          style={{ background: 'none', border: 'none', color: '#484f58', cursor: 'pointer', fontSize: 16 }}
        >
          ⚙
        </button>
      </div>

      <StatusBar approvalStatus={status.approval_status} serverUrl={status.server_url} />

      {/* Tab bar */}
      <div style={{ display: 'flex', padding: '0 16px', borderBottom: '1px solid #21262d' }}>
        {['Home', 'Favorites', 'Discovered'].map((t, i) => (
          <div
            key={t}
            style={{
              padding: '8px 14px',
              fontSize: 12,
              color: i === 0 ? '#26c6da' : '#8b949e',
              cursor: 'pointer',
              borderBottom: i === 0 ? '2px solid #26c6da' : '2px solid transparent',
              fontWeight: 500,
            }}
          >
            {t}
          </div>
        ))}
      </div>

      {/* Panels */}
      <div style={{ flex: 1, display: 'flex', gap: 12, padding: 16, overflow: 'hidden' }}>
        {/* Left: This Device */}
        <div
          style={{
            flex: 1,
            background: '#161b22',
            borderRadius: 10,
            padding: 18,
            border: '1px solid #21262d',
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: '#484f58',
              letterSpacing: 2,
              fontWeight: 700,
              marginBottom: 14,
              textTransform: 'uppercase',
            }}
          >
            This Device
          </div>

          {status.peer_id ? (
            <>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: '#26c6da',
                  letterSpacing: 4,
                  fontFamily: 'monospace',
                  marginBottom: 14,
                }}
              >
                {fmt(status.peer_id)}
              </div>

              <div style={{ fontSize: 10, color: '#484f58', marginBottom: 5 }}>Password</div>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}
              >
                <div style={{ fontSize: 16, color: '#c9d1d9', letterSpacing: 3, flex: 1 }}>
                  ••••••••
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(status.peer_id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, fontSize: 13 }}
                  title="Copy ID"
                >
                  📋
                </button>
                <button
                  onClick={handleResetPwd}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, fontSize: 13 }}
                  title="Reset password"
                >
                  🔄
                </button>
              </div>

              {newPwd && (
                <div
                  style={{
                    background: '#0a2a2e',
                    border: '1px solid #26c6da',
                    borderRadius: 6,
                    padding: 10,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 4 }}>
                    New password — copy now:
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code
                      style={{ flex: 1, fontSize: 12, color: '#26c6da', fontFamily: 'monospace' }}
                    >
                      {newPwd}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(newPwd!);
                        setNewPwd(null);
                      }}
                      style={{
                        background: '#26c6da',
                        border: 'none',
                        borderRadius: 4,
                        padding: '3px 8px',
                        fontSize: 10,
                        color: '#0d1117',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                {status.approval_status !== 'standalone' && (
                  <span
                    style={{
                      padding: '3px 9px',
                      borderRadius: 12,
                      fontSize: 9,
                      fontWeight: 600,
                      background: '#1a3a1a',
                      color: '#56d364',
                    }}
                  >
                    ● {status.approval_status === 'pending' ? 'Pending' : 'Approved'}
                  </span>
                )}
                {status.server_url && (
                  <span
                    style={{
                      padding: '3px 9px',
                      borderRadius: 12,
                      fontSize: 9,
                      background: '#0a2a2e',
                      color: '#26c6da',
                    }}
                  >
                    {status.server_url.replace(/^https?:\/\//, '')}
                  </span>
                )}
              </div>

              <div style={{ fontSize: 10, color: '#484f58', marginBottom: 5 }}>Access mode</div>
              <ModeDropdown
                value={settings.access_mode}
                onChange={(m) => updateSetting('access_mode', m)}
              />
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, color: '#8b949e' }}>Agent not running</div>
              <button
                onClick={start}
                disabled={loading}
                style={{
                  background: '#26c6da',
                  color: '#0d1117',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 0',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Starting…' : 'Start Agent'}
              </button>
            </div>
          )}
        </div>

        {/* Right: Connect */}
        <div
          style={{
            flex: 1,
            background: '#161b22',
            borderRadius: 10,
            padding: 18,
            border: '1px solid #21262d',
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: '#484f58',
              letterSpacing: 2,
              fontWeight: 700,
              marginBottom: 14,
              textTransform: 'uppercase',
            }}
          >
            Connect to Remote
          </div>

          <input
            value={connectId}
            onChange={(e) => setConnectId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && cleanId.length === 9 && handleConnect(cleanId)}
            placeholder="Enter Peer ID  (e.g. 987 654 321)"
            style={{
              width: '100%',
              background: '#21262d',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '9px 12px',
              fontSize: 12,
              color: '#c9d1d9',
              marginBottom: 8,
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
          <button
            onClick={() => handleConnect(cleanId)}
            disabled={cleanId.length !== 9}
            style={{
              width: '100%',
              background: '#26c6da',
              color: '#0d1117',
              border: 'none',
              borderRadius: 6,
              padding: 9,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              marginBottom: 16,
              opacity: cleanId.length !== 9 ? 0.5 : 1,
            }}
          >
            Connect
          </button>

          <div
            style={{
              fontSize: 9,
              color: '#484f58',
              letterSpacing: 2,
              marginBottom: 8,
              textTransform: 'uppercase',
            }}
          >
            Recent
          </div>
          {RECENT.map((r) => (
            <RecentItem key={r.peerId} {...r} onConnect={handleConnect} />
          ))}
        </div>
      </div>
    </div>
  );
}
