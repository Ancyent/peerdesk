import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAuth } from '../auth/useAuth';
import { api, type CompanyOut, type LocationOut, type GroupOut } from '../api/client';
import {
  childTypeOf, renameInList, removeFromList, renameInRecord, removeFromRecord, type NodeType,
} from './orgTreeOps';

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

const iconBtn: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '0 2px', color: 'var(--text-3)' };
const inputStyle: CSSProperties = { flex: 1, padding: '3px 6px', fontSize: 11, border: '1px solid var(--border-dim)', borderRadius: 4, background: 'var(--bg-hover)', color: 'var(--text-1)' };
const confirmBtn: CSSProperties = { padding: '3px 6px', fontSize: 11, background: 'var(--accent)', color: 'var(--text-1)', border: 'none', borderRadius: 4, cursor: 'pointer' };

export function OrgTree({ selected, onSelect, machineCounts }: Props) {
  const { accessToken } = useAuth();
  const [companies, setCompanies] = useState<CompanyOut[]>([]);
  const [locations, setLocations] = useState<Record<string, LocationOut[]>>({});
  const [groups, setGroups] = useState<Record<string, GroupOut[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ type: NodeType; id: string } | null>(null);
  const [editName, setEditName] = useState('');
  const [addingChild, setAddingChild] = useState<{ type: 'company' | 'location'; id: string } | null>(null);
  const [childName, setChildName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ type: NodeType; id: string } | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    api.companies.list(accessToken).then(setCompanies).catch(console.error);
  }, [accessToken]);

  const expand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.add(id); return n; });

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

  const startEdit = (type: NodeType, id: string, name: string) => { setEditing({ type, id }); setEditName(name); };
  const cancelEdit = () => { setEditing(null); setEditName(''); };
  const commitEdit = async () => {
    if (!accessToken || !editing || !editName.trim()) { cancelEdit(); return; }
    const { type, id } = editing; const name = editName.trim();
    if (type === 'company') { const r = await api.companies.update(accessToken, id, name).catch(() => null); if (r) setCompanies(p => renameInList(p, id, name)); }
    else if (type === 'location') { const r = await api.locations.update(accessToken, id, name).catch(() => null); if (r) setLocations(p => renameInRecord(p, id, name)); }
    else { const r = await api.groups.update(accessToken, id, name).catch(() => null); if (r) setGroups(p => renameInRecord(p, id, name)); }
    cancelEdit();
  };

  const startAddChild = (type: 'company' | 'location', id: string) => { setAddingChild({ type, id }); setChildName(''); expand(id); };
  const cancelAddChild = () => { setAddingChild(null); setChildName(''); };
  const commitAddChild = async () => {
    if (!accessToken || !addingChild || !childName.trim()) { cancelAddChild(); return; }
    const { type, id } = addingChild; const name = childName.trim();
    if (type === 'company') { const loc = await api.locations.create(accessToken, id, name).catch(() => null); if (loc) setLocations(p => ({ ...p, [id]: [...(p[id] ?? []), loc] })); }
    else { const grp = await api.groups.create(accessToken, id, name).catch(() => null); if (grp) setGroups(p => ({ ...p, [id]: [...(p[id] ?? []), grp] })); }
    cancelAddChild();
  };

  const doDelete = async (type: NodeType, id: string) => {
    if (!accessToken) { setConfirmDelete(null); return; }
    if (type === 'company') {
      await api.companies.delete(accessToken, id).catch(() => {});
      setCompanies(p => removeFromList(p, id));
      setLocations(p => { const n = { ...p }; delete n[id]; return n; });
    } else if (type === 'location') {
      await api.locations.delete(accessToken, id).catch(() => {});
      setLocations(p => removeFromRecord(p, id));
      setGroups(p => { const n = { ...p }; delete n[id]; return n; });
    } else {
      await api.groups.delete(accessToken, id).catch(() => {});
      setGroups(p => removeFromRecord(p, id));
    }
    setConfirmDelete(null);
  };

  const isSelected = (node: OrgNode) => {
    if (selected.type !== node.type) return false;
    if (node.type === 'all') return true;
    return (selected as { id: string }).id === (node as { id: string }).id;
  };

  const ns = (node: OrgNode): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 5,
    cursor: 'pointer', fontSize: 12, userSelect: 'none',
    background: isSelected(node) ? 'var(--bg-active)' : 'transparent',
    color: isSelected(node) ? 'var(--accent)' : 'var(--text-2)',
    fontWeight: isSelected(node) ? 500 : 400,
  });

  const badge = (id: string) => machineCounts[id]
    ? <span style={{ marginLeft: 'auto', background: 'var(--bg-hover)', borderRadius: 10, padding: '1px 5px', fontSize: 10 }}>{machineCounts[id]}</span>
    : null;

  const nameCell = (type: NodeType, id: string, name: string) =>
    editing && editing.type === type && editing.id === id ? (
      <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
        style={inputStyle} />
    ) : (
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    );

  const trailing = (type: NodeType, id: string, name: string) => {
    if (confirmDelete && confirmDelete.type === type && confirmDelete.id === id) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 10 }} onClick={e => e.stopPropagation()}>
          <span style={{ color: 'var(--text-3)' }}>Șterge?</span>
          <button title="Confirmă ștergerea" aria-label="Confirmă ștergerea" style={{ ...iconBtn, color: 'var(--red)' }} onClick={() => doDelete(type, id)}>✓</button>
          <button title="Anulează" aria-label="Anulează" style={iconBtn} onClick={() => setConfirmDelete(null)}>✕</button>
        </span>
      );
    }
    if (hovered === id && !(editing && editing.id === id)) {
      const child = childTypeOf(type);
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }} onClick={e => e.stopPropagation()}>
          {child && (
            <button title={child === 'location' ? 'Adaugă locație' : 'Adaugă grup'} aria-label={child === 'location' ? 'Adaugă locație' : 'Adaugă grup'}
              style={iconBtn} onClick={() => startAddChild(type as 'company' | 'location', id)}>＋</button>
          )}
          <button title="Redenumește" aria-label="Redenumește" style={iconBtn} onClick={() => startEdit(type, id, name)}>✏️</button>
          <button title="Șterge" aria-label="Șterge" style={iconBtn} onClick={() => setConfirmDelete({ type, id })}>🗑️</button>
        </span>
      );
    }
    return badge(id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>Organizare</span>
        <button onClick={() => setAdding(true)} title="Adaugă companie" aria-label="Adaugă companie" style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>+</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        <div style={{ ...ns({ type: 'all' }), marginBottom: 4 }} onClick={() => onSelect({ type: 'all' })}>
          <span>📋</span><span>Toate</span>
        </div>
        {companies.map(co => (
          <div key={co.id}>
            <div style={{ ...ns({ type: 'company', id: co.id }) }}
              onMouseEnter={() => setHovered(co.id)} onMouseLeave={() => setHovered(h => h === co.id ? null : h)}
              onClick={() => { onSelect({ type: 'company', id: co.id }); toggle(co.id, 'company'); }}>
              <span style={{ fontSize: 9, width: 10, color: 'var(--text-3)' }}>{expanded.has(co.id) ? '▼' : '▶'}</span>
              <span>🏢</span>
              {nameCell('company', co.id, co.name)}
              {trailing('company', co.id, co.name)}
            </div>
            {expanded.has(co.id) && (
              <>
                {(locations[co.id] ?? []).map(loc => (
                  <div key={loc.id}>
                    <div style={{ ...ns({ type: 'location', id: loc.id }), paddingLeft: 20 }}
                      onMouseEnter={() => setHovered(loc.id)} onMouseLeave={() => setHovered(h => h === loc.id ? null : h)}
                      onClick={() => { onSelect({ type: 'location', id: loc.id }); toggle(loc.id, 'location'); }}>
                      <span style={{ fontSize: 9, width: 10, color: 'var(--text-3)' }}>{expanded.has(loc.id) ? '▼' : '▶'}</span>
                      <span>📍</span>
                      {nameCell('location', loc.id, loc.name)}
                      {trailing('location', loc.id, loc.name)}
                    </div>
                    {expanded.has(loc.id) && (
                      <>
                        {(groups[loc.id] ?? []).map(grp => (
                          <div key={grp.id} style={{ ...ns({ type: 'group', id: grp.id }), paddingLeft: 34 }}
                            onMouseEnter={() => setHovered(grp.id)} onMouseLeave={() => setHovered(h => h === grp.id ? null : h)}
                            onClick={() => onSelect({ type: 'group', id: grp.id })}>
                            <span>📁</span>
                            {nameCell('group', grp.id, grp.name)}
                            {trailing('group', grp.id, grp.name)}
                          </div>
                        ))}
                        {addingChild && addingChild.type === 'location' && addingChild.id === loc.id && (
                          <div style={{ display: 'flex', gap: 4, paddingLeft: 34, marginTop: 4 }}>
                            <input autoFocus value={childName} onChange={e => setChildName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') commitAddChild(); if (e.key === 'Escape') cancelAddChild(); }}
                              placeholder="Nume grup" style={inputStyle} />
                            <button title="Confirmă" aria-label="Confirmă" style={confirmBtn} onClick={commitAddChild}>✓</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {addingChild && addingChild.type === 'company' && addingChild.id === co.id && (
                  <div style={{ display: 'flex', gap: 4, paddingLeft: 20, marginTop: 4 }}>
                    <input autoFocus value={childName} onChange={e => setChildName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commitAddChild(); if (e.key === 'Escape') cancelAddChild(); }}
                      placeholder="Nume locație" style={inputStyle} />
                    <button title="Confirmă" aria-label="Confirmă" style={confirmBtn} onClick={commitAddChild}>✓</button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {adding && (
          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCompany(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
              placeholder="Nume companie" style={inputStyle} />
            <button onClick={addCompany} title="Confirmă" aria-label="Confirmă" style={confirmBtn}>✓</button>
          </div>
        )}
      </div>
    </div>
  );
}
