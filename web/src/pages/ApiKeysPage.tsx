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
    <div style={{ padding: '20px 24px', maxWidth: 700 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>API Keys</h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748b' }}>
        Reusable keys for agent deployment. One key can register many machines.
      </p>

      {/* Create form */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, padding: 16, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Key name (e.g. Production Deploy)"
          style={{ flex: 1, padding: '7px 12px', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 6 }}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569', whiteSpace: 'nowrap', cursor: 'pointer' }}>
          <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />
          Auto-approve
        </label>
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: creating || !newName.trim() ? 0.5 : 1 }}
        >
          {creating ? 'Creating...' : 'Create Key'}
        </button>
      </div>

      {/* Newly created key — show once */}
      {newKey && (
        <div style={{ marginBottom: 20, padding: 16, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#15803d' }}>
            ✓ Key created — copy it now, it won't be shown again in full.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ flex: 1, padding: '6px 10px', background: '#dcfce7', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {newKey}
            </code>
            <button onClick={() => handleCopy(newKey)} style={{ padding: '6px 12px', fontSize: 12, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={() => setNewKey(null)} style={{ padding: '6px 12px', fontSize: 12, background: '#e2e8f0', color: '#475569', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              Dismiss
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>
            Deploy: <code style={{ background: '#dcfce7', padding: '2px 4px', borderRadius: 3, fontSize: 11 }}>
              peerdesk-agent --server=YOUR_SERVER --api-key={newKey}
            </code>
          </p>
        </div>
      )}

      {loading && <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading...</p>}

      {!loading && keys.length === 0 && (
        <div style={{ padding: 32, border: '1px dashed #e2e8f0', borderRadius: 8, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
          No API keys yet. Create one above to start deploying agents.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {keys.map(k => (
          <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{k.name}</span>
                {k.auto_approve && (
                  <span style={{ fontSize: 11, padding: '2px 6px', background: '#dbeafe', color: '#1d4ed8', borderRadius: 10, fontWeight: 500 }}>Auto-approve</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>
                  {k.key_preview}
                </code>
                {k.last_used_at && <span style={{ marginLeft: 8 }}>Last used: {new Date(k.last_used_at).toLocaleDateString()}</span>}
              </div>
            </div>
            <span title="Copy the key when first created" style={{ padding: '5px 10px', fontSize: 12, color: '#94a3b8', cursor: 'default', userSelect: 'none' }}>••••</span>
            <button onClick={() => handleRevoke(k.id)} style={{ padding: '5px 10px', fontSize: 12, background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer' }}>Revoke</button>
          </div>
        ))}
      </div>
    </div>
  );
}
