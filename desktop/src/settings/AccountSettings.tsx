import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgent } from '../hooks/useAgent';

export function AccountSettings() {
  const { status } = useAgent();
  const [newPwd, setNewPwd] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleReset = async () => {
    try {
      setNewPwd(await invoke<string>('reset_password'));
    } catch {
      /* ignore */
    }
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3', marginBottom: 20 }}>My Device</div>

      <div style={{ fontSize: 10, color: '#8b949e', letterSpacing: 1, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase' }}>Device Info</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #1c2128' }}>
        <div style={{ fontSize: 12, color: '#8b949e' }}>Peer ID</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#26c6da', fontFamily: 'monospace' }}>
            {status.peer_id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')}
          </div>
          <button
            onClick={() => { navigator.clipboard.writeText(status.peer_id); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 4, padding: '2px 8px', fontSize: 10, color: '#8b949e', cursor: 'pointer' }}
          >
            {copied ? '✓' : 'Copy'}
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #1c2128' }}>
        <div style={{ fontSize: 12, color: '#8b949e' }}>Platform</div>
        <div style={{ fontSize: 12, color: '#c9d1d9' }}>{navigator.platform || 'Unknown'}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0' }}>
        <div style={{ fontSize: 12, color: '#8b949e' }}>Agent version</div>
        <div style={{ fontSize: 12, color: '#c9d1d9' }}>v0.2.0</div>
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 10, color: '#8b949e', letterSpacing: 1, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase' }}>Password</div>
        <button onClick={handleReset} style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 6, padding: '8px 16px', fontSize: 12, color: '#c9d1d9', cursor: 'pointer' }}>
          Generate new password
        </button>
        {newPwd && (
          <div style={{ marginTop: 12, background: '#0a2a2e', border: '1px solid #26c6da', borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 6 }}>New password — copy it now:</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ flex: 1, fontSize: 13, color: '#26c6da', fontFamily: 'monospace' }}>{newPwd}</code>
              <button onClick={() => { navigator.clipboard.writeText(newPwd!); setNewPwd(null); }} style={{ background: '#26c6da', border: 'none', borderRadius: 4, padding: '5px 12px', fontSize: 11, color: '#0d1117', fontWeight: 700, cursor: 'pointer' }}>Copy & Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
