import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { api, type MachineOut } from '../api/client';
import { type OrgNode } from '../components/OrgTree';
import { MachineCard } from '../components/MachineCard';

interface Props {
  onConnect: (peerId: string) => void;
  orgNode: OrgNode;
}

export function OrganizationPage({ onConnect, orgNode }: Props) {
  const { accessToken } = useAuth();
  const [machines, setMachines] = useState<MachineOut[]>([]);

  useEffect(() => {
    if (!accessToken) return;
    api.machines.list(accessToken).then(setMachines).catch(console.error);
  }, [accessToken]);

  const filtered = machines
    .filter(m => {
      if (orgNode.type === 'all') return true;
      if (orgNode.type === 'company')  return m.company_id  === orgNode.id;
      if (orgNode.type === 'location') return m.location_id === orgNode.id;
      if (orgNode.type === 'group')    return m.group_id    === orgNode.id;
      return false;
    })
    .sort((a, b) => Number(b.is_online) - Number(a.is_online));

  return (
    <div style={{ padding: '20px 24px', maxWidth: 900 }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
        {orgNode.type === 'all' ? 'Toate mașinile' : `Mașini (${filtered.length})`}
      </h2>
      {filtered.length === 0 ? (
        <div style={{ padding: 32, border: '1px dashed #e2e8f0', borderRadius: 8, textAlign: 'center', color: '#9ca3af' }}>
          Nicio mașinărie în această secțiune.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(m => <MachineCard key={m.id} machine={m} onConnect={onConnect} />)}
        </div>
      )}
    </div>
  );
}
