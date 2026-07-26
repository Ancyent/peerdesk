import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotify } from '@pd/ui';
import { useAuth } from '../auth/useAuth';
import { api, type MachineOut } from '../api/client';
import { localizeError } from '../api/errors';
import { type OrgNode } from '../components/OrgTree';
import { MachineCard } from '../components/MachineCard';

interface Props {
  onConnect: (machine: MachineOut) => void;
  orgNode: OrgNode;
}

export function OrganizationPage({ onConnect, orgNode }: Props) {
  const { t } = useTranslation('organization');
  const { accessToken } = useAuth();
  const { notify } = useNotify();
  const [machines, setMachines] = useState<MachineOut[]>([]);

  const load = () => {
    if (!accessToken) return;
    api.machines.list(accessToken)
      .then(setMachines)
      .catch((e) => notify.error(t('notify:loadFailed'), { detail: localizeError(e) }));
  };

  useEffect(() => { load(); }, [accessToken]);

  const handleForget = async (m: MachineOut) => {
    if (!accessToken) return;
    try {
      await api.machines.clearSavedPassword(accessToken, m.id);
      notify.success(t('notify:machines.forgotten'));
    } catch (e) {
      notify.error(t('notify:machines.forgetFailed'), { detail: localizeError(e) });
    }
    load();
  };

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
    <div style={{ padding: '20px 24px', maxWidth: 900, background: 'var(--bg-base)', minHeight: '100%' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>
        {orgNode.type === 'all' ? t('organization:page.allMachines') : t('organization:page.machinesCount', { count: filtered.length })}
      </h2>
      {filtered.length === 0 ? (
        <div style={{ padding: 32, border: '1px dashed var(--border)', borderRadius: 8, textAlign: 'center', color: 'var(--text-3)' }}>
          {t('organization:page.empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(m => <MachineCard key={m.id} machine={m} onConnect={onConnect} onForget={handleForget} />)}
        </div>
      )}
    </div>
  );
}
