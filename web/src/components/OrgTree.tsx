import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { api, type CompanyOut, type LocationOut, type GroupOut, type GrantOut } from '../api/client';
import {
  childTypeOf, renameInList, removeFromList, renameInRecord, removeFromRecord, coveredBy,
  type NodeType, type GrantNode,
} from './orgTreeOps';

export type OrgNode =
  | { type: 'all' }
  | { type: 'company';  id: string }
  | { type: 'location'; id: string }
  | { type: 'group';    id: string };

/** Lets a caller (the per-member access editor) turn OrgTree into a checkbox
 *  tree without OrgTree itself knowing anything about grants beyond the pure
 *  `coveredBy` computation. Omitting this prop entirely (the organization
 *  page's usage) renders the tree exactly as before. */
export interface OrgTreeSelectable {
  grants: GrantOut[];
  onToggle: (node: GrantNode, checked: boolean) => void;
}

interface Props {
  selected: OrgNode;
  onSelect: (node: OrgNode) => void;
  machineCounts: Record<string, number>;
  selectable?: OrgTreeSelectable;
}

// Width a checkbox (plus its margin) occupies as the row's first child, so
// the location/group indents below can be reduced by it and the tree doesn't
// visibly shift right compared to its non-selectable layout.
const CHECKBOX_OFFSET = 18;

const iconBtn: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '0 2px', color: 'var(--text-3)' };
const checkboxStyle: CSSProperties = { marginRight: 4, flexShrink: 0 };
const viaLabel: CSSProperties = { fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' };
const inputStyle: CSSProperties = { flex: 1, padding: '3px 6px', fontSize: 11, border: '1px solid var(--border-dim)', borderRadius: 4, background: 'var(--bg-hover)', color: 'var(--text-1)' };
const confirmBtn: CSSProperties = { padding: '3px 6px', fontSize: 11, background: 'var(--accent)', color: 'var(--text-1)', border: 'none', borderRadius: 4, cursor: 'pointer' };

export function OrgTree({ selected, onSelect, machineCounts, selectable }: Props) {
  const { t } = useTranslation('organization');
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

  const startAddChild = async (type: 'company' | 'location', id: string) => {
    if (accessToken) {
      if (type === 'company' && !locations[id]) {
        const locs = await api.locations.list(accessToken, id).catch(() => [] as LocationOut[]);
        setLocations(p => (p[id] ? p : { ...p, [id]: locs }));
      }
      if (type === 'location' && !groups[id]) {
        const grps = await api.groups.list(accessToken, id).catch(() => [] as GroupOut[]);
        setGroups(p => (p[id] ? p : { ...p, [id]: grps }));
      }
    }
    setAddingChild({ type, id }); setChildName(''); expand(id);
  };
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
      try {
        await api.companies.delete(accessToken, id);
        setCompanies(p => removeFromList(p, id));
        setLocations(p => { const n = { ...p }; delete n[id]; return n; });
      } catch { /* leave state intact */ }
    } else if (type === 'location') {
      try {
        await api.locations.delete(accessToken, id);
        setLocations(p => removeFromRecord(p, id));
        setGroups(p => { const n = { ...p }; delete n[id]; return n; });
      } catch { /* leave state intact */ }
    } else {
      try {
        await api.groups.delete(accessToken, id);
        setGroups(p => removeFromRecord(p, id));
      } catch { /* leave state intact */ }
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
    // Add/rename/delete are destructive tree edits. In selectable mode
    // (the per-member access editor) the caller is choosing WHAT a member
    // can see, not managing the org tree -- rendering them here would put a
    // hover-away delete button one misclick from cascading a company's
    // locations and groups while someone is just trying to grant access.
    if (selectable) return badge(id);
    if (confirmDelete && confirmDelete.type === type && confirmDelete.id === id) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 10 }} onClick={e => e.stopPropagation()}>
          <span style={{ color: 'var(--text-3)' }}>{t('organization:tree.deleteConfirm')}</span>
          <button title={t('organization:tree.confirmDelete')} aria-label={t('organization:tree.confirmDelete')} style={{ ...iconBtn, color: 'var(--red)' }} onClick={() => doDelete(type, id)}>✓</button>
          <button title={t('organization:tree.cancel')} aria-label={t('organization:tree.cancel')} style={iconBtn} onClick={() => setConfirmDelete(null)}>✕</button>
        </span>
      );
    }
    if (hovered === id && !(editing && editing.id === id)) {
      const child = childTypeOf(type);
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }} onClick={e => e.stopPropagation()}>
          {child && (
            <button title={child === 'location' ? t('organization:tree.addLocation') : t('organization:tree.addGroup')} aria-label={child === 'location' ? t('organization:tree.addLocation') : t('organization:tree.addGroup')}
              style={iconBtn} onClick={() => startAddChild(type as 'company' | 'location', id)}>＋</button>
          )}
          <button title={t('organization:tree.rename')} aria-label={t('organization:tree.rename')} style={iconBtn} onClick={() => startEdit(type, id, name)}>✏️</button>
          <button title={t('organization:tree.delete')} aria-label={t('organization:tree.delete')} style={iconBtn} onClick={() => setConfirmDelete({ type, id })}>🗑️</button>
        </span>
      );
    }
    return badge(id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{t('organization:tree.title')}</span>
        <button onClick={() => setAdding(true)} title={t('organization:tree.addCompany')} aria-label={t('organization:tree.addCompany')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>+</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        <div style={{ ...ns({ type: 'all' }), marginBottom: 4 }} onClick={() => onSelect({ type: 'all' })}>
          <span>📋</span><span>{t('organization:tree.all')}</span>
        </div>
        {companies.map(co => {
          const companyCov = selectable ? coveredBy(selectable.grants, { type: 'company', id: co.id }) : null;
          return (
          <div key={co.id}>
            <div style={{ ...ns({ type: 'company', id: co.id }) }}
              onMouseEnter={() => setHovered(co.id)} onMouseLeave={() => setHovered(h => h === co.id ? null : h)}
              onClick={() => { onSelect({ type: 'company', id: co.id }); toggle(co.id, 'company'); }}>
              {selectable && (
                <input type="checkbox" checked={companyCov!.checked} disabled={companyCov!.via !== null}
                  aria-label={t('organization:tree.accessTo', { name: co.name })}
                  onClick={e => e.stopPropagation()}
                  onChange={e => selectable.onToggle({ type: 'company', id: co.id }, e.target.checked)}
                  style={checkboxStyle} />
              )}
              <span style={{ fontSize: 9, width: 10, color: 'var(--text-3)' }}>{expanded.has(co.id) ? '▼' : '▶'}</span>
              <span>🏢</span>
              {nameCell('company', co.id, co.name)}
              {/* A company has no ancestor in this tree, so companyCov.via is always null
                  -- there's nothing to label here, unlike location/group below. */}
              {trailing('company', co.id, co.name)}
            </div>
            {expanded.has(co.id) && (
              <>
                {(locations[co.id] ?? []).map(loc => {
                  const locationCov = selectable
                    ? coveredBy(selectable.grants, { type: 'location', id: loc.id, companyId: co.id })
                    : null;
                  return (
                  <div key={loc.id}>
                    <div style={{ ...ns({ type: 'location', id: loc.id }), paddingLeft: selectable ? 20 - CHECKBOX_OFFSET : 20 }}
                      onMouseEnter={() => setHovered(loc.id)} onMouseLeave={() => setHovered(h => h === loc.id ? null : h)}
                      onClick={() => { onSelect({ type: 'location', id: loc.id }); toggle(loc.id, 'location'); }}>
                      {selectable && (
                        <input type="checkbox" checked={locationCov!.checked} disabled={locationCov!.via !== null}
                          aria-label={t('organization:tree.accessTo', { name: loc.name })}
                          onClick={e => e.stopPropagation()}
                          onChange={e => selectable.onToggle({ type: 'location', id: loc.id, companyId: co.id }, e.target.checked)}
                          style={checkboxStyle} />
                      )}
                      <span style={{ fontSize: 9, width: 10, color: 'var(--text-3)' }}>{expanded.has(loc.id) ? '▼' : '▶'}</span>
                      <span>📍</span>
                      {nameCell('location', loc.id, loc.name)}
                      {/* The only possible ancestor of a location is its company, already in scope. */}
                      {selectable && locationCov!.via !== null && <span style={viaLabel}>{t('organization:tree.via', { name: co.name })}</span>}
                      {trailing('location', loc.id, loc.name)}
                    </div>
                    {expanded.has(loc.id) && (
                      <>
                        {(groups[loc.id] ?? []).map(grp => {
                          const groupCov = selectable
                            ? coveredBy(selectable.grants, { type: 'group', id: grp.id, companyId: co.id, locationId: loc.id })
                            : null;
                          return (
                          <div key={grp.id} style={{ ...ns({ type: 'group', id: grp.id }), paddingLeft: selectable ? 34 - CHECKBOX_OFFSET : 34 }}
                            onMouseEnter={() => setHovered(grp.id)} onMouseLeave={() => setHovered(h => h === grp.id ? null : h)}
                            onClick={() => onSelect({ type: 'group', id: grp.id })}>
                            {selectable && (
                              <input type="checkbox" checked={groupCov!.checked} disabled={groupCov!.via !== null}
                                aria-label={t('organization:tree.accessTo', { name: grp.name })}
                                onClick={e => e.stopPropagation()}
                                onChange={e => selectable.onToggle(
                                  { type: 'group', id: grp.id, companyId: co.id, locationId: loc.id }, e.target.checked,
                                )}
                                style={checkboxStyle} />
                            )}
                            <span>📁</span>
                            {nameCell('group', grp.id, grp.name)}
                            {/* The only possible ancestors of a group are its location (nearest) and company. */}
                            {selectable && groupCov!.via !== null && (
                              <span style={viaLabel}>{t('organization:tree.via', { name: groupCov!.via === loc.id ? loc.name : co.name })}</span>
                            )}
                            {trailing('group', grp.id, grp.name)}
                          </div>
                          );
                        })}
                        {addingChild && addingChild.type === 'location' && addingChild.id === loc.id && (
                          <div style={{ display: 'flex', gap: 4, paddingLeft: 34, marginTop: 4 }}>
                            <input autoFocus value={childName} onChange={e => setChildName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') commitAddChild(); if (e.key === 'Escape') cancelAddChild(); }}
                              placeholder={t('organization:tree.groupNamePlaceholder')} style={inputStyle} />
                            <button title={t('organization:tree.confirm')} aria-label={t('organization:tree.confirm')} style={confirmBtn} onClick={commitAddChild}>✓</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  );
                })}
                {addingChild && addingChild.type === 'company' && addingChild.id === co.id && (
                  <div style={{ display: 'flex', gap: 4, paddingLeft: 20, marginTop: 4 }}>
                    <input autoFocus value={childName} onChange={e => setChildName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commitAddChild(); if (e.key === 'Escape') cancelAddChild(); }}
                      placeholder={t('organization:tree.locationNamePlaceholder')} style={inputStyle} />
                    <button title={t('organization:tree.confirm')} aria-label={t('organization:tree.confirm')} style={confirmBtn} onClick={commitAddChild}>✓</button>
                  </div>
                )}
              </>
            )}
          </div>
          );
        })}
        {adding && (
          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCompany(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
              placeholder={t('organization:tree.companyNamePlaceholder')} style={inputStyle} />
            <button onClick={addCompany} title={t('organization:tree.confirm')} aria-label={t('organization:tree.confirm')} style={confirmBtn}>✓</button>
          </div>
        )}
      </div>
    </div>
  );
}
