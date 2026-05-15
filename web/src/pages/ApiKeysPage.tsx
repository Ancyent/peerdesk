import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { api, type ApiKeyListOut } from '../api/client';

export function ApiKeysPage() {
  const { accessToken } = useAuth();
  const [keys, setKeys] = useState<ApiKeyListOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () => {
    if (!accessToken) return;
    api.apiKeys.list(accessToken).then(setKeys).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [accessToken]);

  const handleCreate = async () => {
    if (!accessToken || !newName.trim()) return;
    setCreating(true);
    try {
      const created = await api.apiKeys.create(accessToken, newName.trim(), autoApprove);
      setNewKey(created.key);
      setNewName('');
      setAutoApprove(false);
      load();
    } catch (e) { console.error(e); }
    finally { setCreating(false); }
  };

  const handleRevoke = async (id: string) => {
    if (!accessToken) return;
    await api.apiKeys.revoke(accessToken, id);
    setKeys(prev => prev.filter(k => k.id !== id));
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ padding: '20px 24px', maxWidth: 700, background: 'var(--bg-base)', minHeight: '100%' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>API Keys</h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-2)' }}>
        Reusable keys for agent deployment. One key can register many machines.
      </p>

      {/* Create form */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, padding: 16, background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-dim)' }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Key name (e.g. Production Deploy)"
          style={{ flex: 1, padding: '7px 12px', fontSize: 13, border: '1px solid var(--border-dim)', borderRadius: 6, background: 'var(--bg-hover)', color: 'var(--text-1)' }}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-2)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
          <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />
          Auto-approve
        </label>
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent-2)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: creating || !newName.trim() ? 0.5 : 1 }}
        >
          {creating ? 'Creating...' : 'Create Key'}
        </button>
      </div>

      {/* Newly created key — show once */}
      {newKey && (
        <div style={{ marginBottom: 20, padding: 16, background: 'var(--green-bg)', border: '1px solid var(--green-glow)', borderRadius: 8 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
            ✓ Key created — copy it now, it won't be shown again in full.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ flex: 1, padding: '6px 10px', background: 'rgba(0,229,160,0.15)', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--text-1)' }}>
              {newKey}
            </code>
            <button onClick={() => handleCopy(newKey)} style={{ padding: '6px 12px', fontSize: 12, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={() => setNewKey(null)} style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-hover)', color: 'var(--text-2)', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              Dismiss
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-2)' }}>
            Deploy: <code style={{ background: 'rgba(0,229,160,0.15)', padding: '2px 4px', borderRadius: 3, fontSize: 11, color: 'var(--text-1)' }}>
              peerdesk-agent --server=YOUR_SERVER --api-key={newKey}
            </code>
          </p>
        </div>
      )}

      {loading && <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading...</p>}

      {!loading && keys.length === 0 && (
        <div style={{ padding: 32, border: '1px dashed var(--border)', borderRadius: 8, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
          No API keys yet. Create one above to start deploying agents.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {keys.map(k => (
          <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-dim)', borderRadius: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{k.name}</span>
                {k.auto_approve && (
                  <span style={{ fontSize: 11, padding: '2px 6px', background: 'rgba(0,168,255,0.12)', color: 'var(--accent-2)', borderRadius: 10, fontWeight: 500 }}>Auto-approve</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                <code style={{ background: 'var(--bg-hover)', padding: '1px 4px', borderRadius: 3, color: 'var(--text-1)' }}>
                  {k.key_preview}
                </code>
                {k.last_used_at && <span style={{ marginLeft: 8 }}>Last used: {new Date(k.last_used_at).toLocaleDateString()}</span>}
              </div>
            </div>
            <span title="Copy the key when first created" style={{ padding: '5px 10px', fontSize: 12, color: 'var(--text-3)', cursor: 'default', userSelect: 'none' }}>••••</span>
            <button onClick={() => handleRevoke(k.id)} style={{ padding: '5px 10px', fontSize: 12, background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red)', borderRadius: 6, cursor: 'pointer' }}>Revoke</button>
          </div>
        ))}
      </div>
    </div>
  );
}
