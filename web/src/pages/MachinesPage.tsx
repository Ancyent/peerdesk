import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { api, type MachineOut } from '../api/client';
import { MachineCard } from '../components/MachineCard';

interface Props {
  onConnect: (peerId: string) => void;
}

export function MachinesPage({ onConnect }: Props) {
  const { accessToken } = useAuth();
  const [machines, setMachines] = useState<MachineOut[]>([]);
  const [pending, setPending] = useState<MachineOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'active' | 'pending'>('active');

  const load = () => {
    if (!accessToken) return;
    Promise.all([
      api.machines.list(accessToken),
      api.machines.listByStatus(accessToken, 'pending'),
    ])
      .then(([all, pend]) => {
        setMachines(all.filter(m => m.approval_status !== 'pending'));
        setPending(pend);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [accessToken]);

  const handleApprove = async (id: string) => {
    if (!accessToken) return;
    await api.machines.approve(accessToken, id);
    load();
  };

  const handleDeny = async (id: string) => {
    if (!accessToken) return;
    await api.machines.deny(accessToken, id);
    load();
  };

  const filtered = machines
    .filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.peer_id.includes(search))
    .sort((a, b) => Number(b.is_online) - Number(a.is_online));

  return (
    <div style={{ padding: '20px 24px', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>Mașini</h2>
        <span style={{ fontSize: 12, color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: 10 }}>
          {machines.filter(m => m.is_online).length} online
        </span>
        {pending.length > 0 && (
          <span style={{ fontSize: 12, color: '#d97706', background: '#fef3c7', padding: '2px 8px', borderRadius: 10, cursor: 'pointer' }} onClick={() => setTab('pending')}>
            {pending.length} pending approval
          </span>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Caută..." style={{ padding: '6px 12px', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 6, width: 200 }} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #e2e8f0' }}>
        {(['active', 'pending'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 600 : 400, color: tab === t ? '#2563eb' : '#64748b', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent', cursor: 'pointer' }}>
            {t === 'active' ? 'Active' : `Pending${pending.length > 0 ? ` (${pending.length})` : ''}`}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#9ca3af' }}>Se încarcă...</p>}

      {/* Active tab */}
      {!loading && tab === 'active' && (
        <>
          {filtered.length === 0 && (
            <div style={{ padding: 32, border: '1px dashed #e2e8f0', borderRadius: 8, textAlign: 'center', color: '#9ca3af' }}>
              {search ? 'Nicio mașinărie găsită.' : 'Nicio mașinărie înregistrată. Folosește secțiunea Instalare Agent.'}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(m => <MachineCard key={m.id} machine={m} onConnect={onConnect} />)}
          </div>
        </>
      )}

      {/* Pending tab */}
      {!loading && tab === 'pending' && (
        <>
          {pending.length === 0 && (
            <div style={{ padding: 32, border: '1px dashed #e2e8f0', borderRadius: 8, textAlign: 'center', color: '#9ca3af' }}>
              No machines pending approval.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pending.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    ID: {m.peer_id} · {m.os ?? 'Unknown OS'} · {new Date(m.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button onClick={() => handleApprove(m.id)} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                  Approve
                </button>
                <button onClick={() => handleDeny(m.id)} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                  Deny
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
