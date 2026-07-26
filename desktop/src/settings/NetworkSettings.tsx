import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useNotify } from '@pd/ui';
import { useAgentContext } from '../context/AppContext';
import { LogPanel } from '../components/LogPanel';

export function NetworkSettings() {
  const { status, start } = useAgentContext();
  const { t } = useTranslation('settings');
  const { notify } = useNotify();
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

  const applyUrl = async (url: string) => {
    try {
      await invoke('apply_config_link', { url });
      notify.success(t('settings:network.toastApplied'));
      // apply_config_link stops the agent; restart it so it registers with
      // the new server/key.
      setTimeout(() => { start(); }, 1500);
    } catch (e) {
      notify.error(t('settings:network.toastError', { message: String(e) }));
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.startsWith('peerdesk://')) {
        notify.error(t('settings:network.toastNoConfigLink'));
        return;
      }
      await applyUrl(text);
    } catch (e) {
      notify.error(t('settings:network.toastError', { message: String(e) }));
    }
  };

  return (
    <div style={{ padding: '20px 24px', position: 'relative' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3', marginBottom: 20 }}>{t('settings:network.title')}</div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, color: '#b3bdca', letterSpacing: 1, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase' }}>{t('settings:network.sectionServer')}</div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#93a0b2', marginBottom: 5 }}>{t('settings:network.serverUrlLabel')}</div>
          <input value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="https://api.example.com"
            style={{ width: '100%', background: '#21262d', border: `1px solid ${serverUrl ? '#26c6da' : '#30363d'}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: serverUrl ? '#26c6da' : '#e6ebf1', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#93a0b2', marginBottom: 5 }}>{t('settings:network.apiKeyLabel')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={status.approval_status !== 'standalone' && !apiKey ? t('settings:network.apiKeyPlaceholderSaved') : 'pd_••••••••••••••••'}
              style={{ flex: 1, background: '#21262d', border: '1px solid #30363d', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#e6ebf1' }}
            />
            <button onClick={() => setShowKey(v => !v)} style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 6, padding: '0 12px', cursor: 'pointer', color: '#b3bdca', fontSize: 11 }}>{showKey ? t('settings:network.hideKey') : t('settings:network.showKey')}</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handlePaste} style={{ background: '#21262d', border: '1px solid #30363d', padding: '6px 12px', borderRadius: 5, fontSize: 11, color: '#b3bdca', cursor: 'pointer' }}>
            {t('settings:network.pasteConfigLink')}
          </button>
          <button onClick={() => applyUrl(`peerdesk://setup?server=${encodeURIComponent(serverUrl)}&api_key=${encodeURIComponent(apiKey)}`)}
            style={{ background: '#26c6da', border: 'none', padding: '6px 14px', borderRadius: 5, fontSize: 11, color: '#0d1117', fontWeight: 700, cursor: 'pointer' }}>
            {t('settings:network.applyReconnect')}
          </button>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, color: '#b3bdca', letterSpacing: 1, fontWeight: 600, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase' }}>{t('settings:network.sectionConnectionStatus')}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1c2128' }}>
          <div style={{ fontSize: 12, color: '#e6ebf1' }}>{t('settings:network.statusLabel')}</div>
          <div style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 600, background: '#1a3a1a', color: '#56d364' }}>
            ● {t('settings:network.status.' + status.approval_status)}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: 12, color: '#e6ebf1' }}>{t('settings:network.peerIdLabel')}</div>
          <div style={{ fontSize: 12, color: '#26c6da', fontFamily: 'monospace' }}>
            {status.peer_id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')}
          </div>
        </div>
      </div>

      <LogPanel />
    </div>
  );
}
