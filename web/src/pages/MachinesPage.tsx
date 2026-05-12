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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!accessToken) return;
    api.machines.list(accessToken).then(setMachines).catch(console.error).finally(() => setLoading(false));
  }, [accessToken]);

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
        <div style={{ marginLeft: 'auto' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Caută..." style={{ padding: '6px 12px', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 6, width: 200 }} />
        </div>
      </div>
      {loading && <p style={{ color: '#9ca3af' }}>Se încarcă...</p>}
      {!loading && filtered.length === 0 && (
        <div style={{ padding: 32, border: '1px dashed #e2e8f0', borderRadius: 8, textAlign: 'center', color: '#9ca3af' }}>
          {search ? 'Nicio mașinărie găsită.' : 'Nicio mașinărie înregistrată. Folosește secțiunea Instalare Agent.'}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map(m => <MachineCard key={m.id} machine={m} onConnect={onConnect} />)}
      </div>
    </div>
  );
}
