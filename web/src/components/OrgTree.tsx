import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAuth } from '../auth/useAuth';
import { api, type CompanyOut, type LocationOut, type GroupOut } from '../api/client';

export type OrgNode =
  | { type: 'all' }
  | { type: 'company';  id: string }
  | { type: 'location'; id: string }
  | { type: 'group';    id: string };

interface Props {
  selected: OrgNode;
  onSelect: (node: OrgNode) => void;
  machineCounts: Record<string, number>;
}

export function OrgTree({ selected, onSelect, machineCounts }: Props) {
  const { accessToken } = useAuth();
  const [companies, setCompanies] = useState<CompanyOut[]>([]);
  const [locations, setLocations] = useState<Record<string, LocationOut[]>>({});
  const [groups, setGroups] = useState<Record<string, GroupOut[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!accessToken) return;
    api.companies.list(accessToken).then(setCompanies).catch(console.error);
  }, [accessToken]);

  const toggle = async (id: string, type: 'company' | 'location') => {
    const next = new Set(expanded);
    if (next.has(id)) { next.delete(id); setExpanded(next); return; }
    next.add(id); setExpanded(next);
    if (!accessToken) return;
    if (type === 'company' && !locations[id]) {
      const locs = await api.locations.list(accessToken, id).catch(() => [] as LocationOut[]);
      setLocations(p => ({ ...p, [id]: locs }));
    }
    if (type === 'location' && !groups[id]) {
      const grps = await api.groups.list(accessToken, id).catch(() => [] as GroupOut[]);
      setGroups(p => ({ ...p, [id]: grps }));
    }
  };

  const addCompany = async () => {
    if (!accessToken || !newName.trim()) return;
    const co = await api.companies.create(accessToken, newName.trim()).catch(() => null);
    if (co) { setCompanies(p => [...p, co]); setNewName(''); setAdding(false); }
  };

  const isSelected = (node: OrgNode) => {
    if (selected.type !== node.type) return false;
    if (node.type === 'all') return true;
    return (selected as { id: string }).id === (node as { id: string }).id;
  };

  const ns = (node: OrgNode): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 5,
    cursor: 'pointer', fontSize: 12, userSelect: 'none',
    background: isSelected(node) ? '#dbeafe' : 'transparent',
    color: isSelected(node) ? '#1d4ed8' : '#475569',
    fontWeight: isSelected(node) ? 500 : 400,
  });

  const badge = (id: string) => machineCounts[id]
    ? <span style={{ marginLeft: 'auto', background: '#f1f5f9', borderRadius: 10, padding: '1px 5px', fontSize: 10 }}>{machineCounts[id]}</span>
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>Organizare</span>
        <button onClick={() => setAdding(true)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>+</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        <div style={{ ...ns({ type: 'all' }), marginBottom: 4 }} onClick={() => onSelect({ type: 'all' })}>
          <span>📋</span><span>Toate</span>
        </div>
        {companies.map(co => (
          <div key={co.id}>
            <div style={{ ...ns({ type: 'company', id: co.id }) }}
              onClick={() => { onSelect({ type: 'company', id: co.id }); toggle(co.id, 'company'); }}>
              <span style={{ fontSize: 9, width: 10, color: '#94a3b8' }}>{expanded.has(co.id) ? '▼' : '▶'}</span>
              <span>🏢</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{co.name}</span>
              {badge(co.id)}
            </div>
            {expanded.has(co.id) && (locations[co.id] ?? []).map(loc => (
              <div key={loc.id}>
                <div style={{ ...ns({ type: 'location', id: loc.id }), paddingLeft: 20 }}
                  onClick={() => { onSelect({ type: 'location', id: loc.id }); toggle(loc.id, 'location'); }}>
                  <span style={{ fontSize: 9, width: 10, color: '#94a3b8' }}>{expanded.has(loc.id) ? '▼' : '▶'}</span>
                  <span>📍</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc.name}</span>
                  {badge(loc.id)}
                </div>
                {expanded.has(loc.id) && (groups[loc.id] ?? []).map(grp => (
                  <div key={grp.id} style={{ ...ns({ type: 'group', id: grp.id }), paddingLeft: 34 }}
                    onClick={() => onSelect({ type: 'group', id: grp.id })}>
                    <span>📁</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{grp.name}</span>
                    {badge(grp.id)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        {adding && (
          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCompany(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
              placeholder="Nume companie"
              style={{ flex: 1, padding: '4px 8px', fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 4 }} />
            <button onClick={addCompany} style={{ padding: '4px 8px', fontSize: 11, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✓</button>
          </div>
        )}
      </div>
    </div>
  );
}
