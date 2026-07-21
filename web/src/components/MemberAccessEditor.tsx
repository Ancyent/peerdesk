import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { api, ApiError, type GrantOut, type GrantIn } from '../api/client';
import { OrgTree, type OrgNode } from './OrgTree';
import type { GrantNode } from './orgTreeOps';

interface Props {
  membershipId: string;
}

function matchesNode(g: GrantOut, node: GrantNode): boolean {
  if (node.type === 'company')  return g.company_id  === node.id;
  if (node.type === 'location') return g.location_id === node.id;
  if (node.type === 'group')    return g.group_id    === node.id;
  return g.machine_id === node.id;
}

function toGrantIn(g: GrantOut): GrantIn {
  return { company_id: g.company_id, location_id: g.location_id, group_id: g.group_id, machine_id: g.machine_id };
}

export function MemberAccessEditor({ membershipId }: Props) {
  const { accessToken } = useAuth();
  const [grants, setGrants] = useState<GrantOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OrgNode>({ type: 'all' });

  const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    api.team.grants(accessToken, membershipId)
      .then(g => { setGrants(g); setDirty(false); })
      .catch(e => setError(errorMessage(e, 'Nu am putut încărca accesul')))
      .finally(() => setLoading(false));
  }, [accessToken, membershipId]);

  // Checking a node adds a direct grant on it; unchecking drops the direct
  // grant on it. A node covered only by inheritance renders `disabled` in
  // OrgTree, so this is only ever reached for a node's own grant.
  const handleToggle = (node: GrantNode, checked: boolean) => {
    setGrants(prev => {
      if (checked) {
        if (prev.some(g => matchesNode(g, node))) return prev;
        const added: GrantOut = {
          id: `pending-${node.type}-${node.id}`,
          company_id: node.type === 'company' ? node.id : null,
          location_id: node.type === 'location' ? node.id : null,
          group_id: node.type === 'group' ? node.id : null,
          machine_id: node.type === 'machine' ? node.id : null,
          created_at: '',
        };
        return [...prev, added];
      }
      return prev.filter(g => !matchesNode(g, node));
    });
    setDirty(true);
  };

  const save = async () => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.team.setGrants(accessToken, membershipId, grants.map(toGrantIn));
      setGrants(updated);
      setDirty(false);
    } catch (e) {
      setError(errorMessage(e, 'Nu am putut salva accesul'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>Se încarcă accesul...</p>;

  return (
    <div>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-3)' }}>
        Bifează companiile, locațiile sau grupurile la care acest membru are acces. Un nod bifat
        și dezactivat este inclus printr-un acces acordat mai sus în arbore (etichetat „via").
      </p>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-3)' }}>
        Acest acces controlează ce vede și ce poate deschide membrul din dashboard — nu împiedică
        o conexiune directă către o mașină a cărei parolă o cunoaște deja dintr-o altă sursă.
      </p>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          marginBottom: 8, padding: '8px 10px', background: 'var(--red-bg)',
          border: '1px solid var(--red)', borderRadius: 6,
        }}>
          <span style={{ fontSize: 12, color: 'var(--red)' }}>{error}</span>
          <button onClick={() => setError(null)} title="Închide" aria-label="Închide"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 12 }}>✕</button>
        </div>
      )}

      <div style={{ height: 260, border: '1px solid var(--border-dim)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-surface)' }}>
        <OrgTree
          selected={selected}
          onSelect={setSelected}
          machineCounts={{}}
          selectable={{ grants, onToggle: handleToggle }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
        {dirty && <span style={{ fontSize: 11, color: 'var(--yellow)' }}>Modificări nesalvate</span>}
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={{
            padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6,
            background: 'var(--accent)', color: '#fff', cursor: dirty && !saving ? 'pointer' : 'default',
            opacity: dirty && !saving ? 1 : 0.5,
          }}
        >
          {saving ? 'Se salvează...' : 'Salvează accesul'}
        </button>
      </div>
    </div>
  );
}
