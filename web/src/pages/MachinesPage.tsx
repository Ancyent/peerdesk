import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { api, type MachineOut } from '../api/client';
import { MachineCard } from '../components/MachineCard';

interface Props {
  onConnect: (machine: MachineOut) => void;
}

export function MachinesPage({ onConnect }: Props) {
  const { t } = useTranslation('machines');
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

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    const m = machines.find(x => x.id === id);
    if (!window.confirm(t('machines:page.deleteConfirm', { name: m?.name ?? '', peerId: m?.peer_id ?? '' }))) return;
    try {
      await api.machines.remove(accessToken, id);
    } catch (e) {
      console.error(e);
    }
    load();
  };

  const handleForget = async (m: MachineOut) => {
    if (!accessToken) return;
    try {
      await api.machines.clearSavedPassword(accessToken, m.id);
    } catch (e) {
      console.error(e);
    }
    load();
  };

  const filtered = machines
    .filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.peer_id.includes(search))
    .sort((a, b) => Number(b.is_online) - Number(a.is_online));

  return (
    <div style={{ padding: '20px 24px', maxWidth: 900, background: 'var(--bg-base)', minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{t('machines:page.title')}</h2>
        <span style={{ fontSize: 12, color: 'var(--green)', background: 'var(--green-bg)', border: '1px solid var(--green-glow)', padding: '2px 8px', borderRadius: 10 }}>
          {t('machines:page.onlineCount', { count: machines.filter(m => m.is_online).length })}
        </span>
        {pending.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--yellow)', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', padding: '2px 8px', borderRadius: 10, cursor: 'pointer' }} onClick={() => setTab('pending')}>
            {t('machines:page.pendingApproval', { count: pending.length })}
          </span>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('machines:page.search')} style={{ padding: '6px 12px', fontSize: 13, border: '1px solid var(--border-dim)', borderRadius: 6, width: 200, background: 'var(--bg-surface)', color: 'var(--text-1)', outline: 'none' }} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid var(--border-dim)' }}>
        {(['active', 'pending'] as const).map(tabKey => (
          <button key={tabKey} onClick={() => setTab(tabKey)} style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === tabKey ? 600 : 400, color: tab === tabKey ? 'var(--accent-2)' : 'var(--text-2)', background: 'none', border: 'none', borderBottom: tab === tabKey ? '2px solid var(--accent-2)' : '2px solid transparent', cursor: 'pointer' }}>
            {tabKey === 'active' ? t('machines:page.tabs.active') : `${t('machines:page.tabs.pending')}${pending.length > 0 ? ` (${pending.length})` : ''}`}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--text-3)' }}>{t('machines:page.loading')}</p>}

      {/* Active tab */}
      {!loading && tab === 'active' && (
        <>
          {filtered.length === 0 && (
            <div style={{ padding: 32, border: '1px dashed var(--border)', borderRadius: 8, textAlign: 'center', color: 'var(--text-3)' }}>
              {search ? t('machines:page.emptySearch') : t('machines:page.emptyNone')}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(265px, 1fr))', gap: 14 }}>
            {filtered.map(m => <MachineCard key={m.id} machine={m} onConnect={onConnect} onDelete={handleDelete} onForget={handleForget} />)}
          </div>
        </>
      )}

      {/* Pending tab */}
      {!loading && tab === 'pending' && (
        <>
          {pending.length === 0 && (
            <div style={{ padding: 32, border: '1px dashed var(--border)', borderRadius: 8, textAlign: 'center', color: 'var(--text-3)' }}>
              {t('machines:page.noPending')}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pending.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{m.name}</div>
                    {m.approval_status === 'pending' && (
                      <span style={{
                        fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-hover)',
                        border: '1px solid var(--border-dim)', borderRadius: 10, padding: '1px 8px',
                      }}>
                        {t('machines:page.pendingBadge')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                    {t('machines:page.idLine', { peerId: m.peer_id, os: m.os ?? t('machines:page.unknownOs'), date: new Date(m.created_at).toLocaleDateString() })}
                  </div>
                </div>
                <button onClick={() => handleApprove(m.id)} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, background: 'var(--green)', color: 'var(--text-1)', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                  {t('machines:page.approve')}
                </button>
                <button onClick={() => handleDeny(m.id)} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, background: 'var(--red)', color: 'var(--text-1)', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                  {t('machines:page.deny')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
