import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentContext } from '../context/AppContext';

export function NetworkSettings() {
  const { status } = useAgentContext();
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const syncedRef = useRef(false);

  // Sync server URL once, after the first async status poll returns
  useEffect(() => {
    if (!syncedRef.current && status.server_url !== null) {
      syncedRef.current = true;
      setServerUrl(status.server_url ?? '');
    }
  }, [status.server_url]);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const showMsg = (text: string, ok: boolean) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const applyUrl = async (url: string) => {
    try {
      await invoke('apply_config_link', { url });
      showMsg('✓ Config applied — reconnecting...', true);
    } catch (e) {
      showMsg(`✗ ${String(e)}`, false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.startsWith('peerdesk://')) {
        showMsg('✗ No valid config link found in clipboard', false);
        return;
      }
      await applyUrl(text);
    } catch (e) {
      showMsg(`✗ ${String(e)}`, false);
    }
  };

  return (
    <div style={{ padding: '20px 24px', position: 'relative' }}>
      {toast && (
        <div style={{ position: 'absolute', top: 12, right: 12, background: toast.ok ? '#1a3a1a' : '#3a1a1a', border: `1px solid ${toast.ok ? '#56d364' : '#f85149'}`, borderRadius: 6, padding: '8px 14px', fontSize: 12, color: toast.ok ? '#56d364' : '#f85149', zIndex: 10 }}>
          {toast.text}
        </div>
      )}
      <div style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3', marginBottom: 20 }}>Network</div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, color: '#b3bdca', letterSpacing: 1, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase' }}>PeerDesk Server</div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#93a0b2', marginBottom: 5 }}>SERVER URL</div>
          <input value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="https://api.example.com"
            style={{ width: '100%', background: '#21262d', border: `1px solid ${serverUrl ? '#26c6da' : '#30363d'}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: serverUrl ? '#26c6da' : '#e6ebf1', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#93a0b2', marginBottom: 5 }}>API KEY</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={status.approval_status !== 'standalone' && !apiKey ? '••• key saved — enter new key to replace' : 'pd_••••••••••••••••'}
              style={{ flex: 1, background: '#21262d', border: '1px solid #30363d', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#e6ebf1' }}
            />
            <button onClick={() => setShowKey(v => !v)} style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 6, padding: '0 12px', cursor: 'pointer', color: '#b3bdca', fontSize: 11 }}>{showKey ? 'Hide' : 'Show'}</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handlePaste} style={{ background: '#21262d', border: '1px solid #30363d', padding: '6px 12px', borderRadius: 5, fontSize: 11, color: '#b3bdca', cursor: 'pointer' }}>
            Paste config link
          </button>
          <button onClick={() => applyUrl(`peerdesk://setup?server=${encodeURIComponent(serverUrl)}&api_key=${encodeURIComponent(apiKey)}`)}
            style={{ background: '#26c6da', border: 'none', padding: '6px 14px', borderRadius: 5, fontSize: 11, color: '#0d1117', fontWeight: 700, cursor: 'pointer' }}>
            Apply & Reconnect
          </button>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, color: '#b3bdca', letterSpacing: 1, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase' }}>Connection Status</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1c2128' }}>
          <div style={{ fontSize: 12, color: '#e6ebf1' }}>Status</div>
          <div style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 600, background: '#1a3a1a', color: '#56d364' }}>
            ● {status.approval_status === 'standalone' ? 'Connected (standalone)' : status.approval_status}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: 12, color: '#e6ebf1' }}>Peer ID</div>
          <div style={{ fontSize: 12, color: '#26c6da', fontFamily: 'monospace' }}>
            {status.peer_id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')}
          </div>
        </div>
      </div>
    </div>
  );
}
