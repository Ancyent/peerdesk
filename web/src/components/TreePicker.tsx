import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotify } from '@pd/ui';
import { useAuth } from '../auth/useAuth';
import { api, type CompanyOut, type LocationOut, type GroupOut } from '../api/client';
import { localizeError } from '../api/errors';
import { buildPickerNodes, filterNodes, type PickerNode } from './treePicker';

interface Props {
  /** The currently selected node, or null for "no placement". */
  value: PickerNode | null;
  onChange: (node: PickerNode | null) => void;
  /** Disables the trigger (e.g. while there is no auth token yet). */
  disabled?: boolean;
}

const field: CSSProperties = {
  width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center',
  justifyContent: 'space-between', gap: 8, padding: '8px 12px', fontSize: 13,
  border: '1px solid var(--border-dim)', borderRadius: 6,
  background: 'var(--bg-surface)', color: 'var(--text-1)', cursor: 'pointer',
  textAlign: 'left',
};
const searchInput: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: 12,
  border: '1px solid var(--border-dim)', borderRadius: 5,
  background: 'var(--bg-surface)', color: 'var(--text-1)', outline: 'none',
};
const icon: Record<PickerNode['type'], string> = { company: '🏢', location: '📍', group: '📁' };

export function TreePicker({ value, onChange, disabled }: Props) {
  const { t } = useTranslation('organization');
  const { accessToken } = useAuth();
  const { notify } = useNotify();
  const [open, setOpen] = useState(false);
  const [nodes, setNodes] = useState<PickerNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  // Shared by every load below so a failed request always tells the user
  // something went wrong instead of quietly rendering an empty tree, which
  // reads as "this company has no locations" -- the same failure mode
  // OrgTree's notifyLoadFailed was introduced to fix (web/src/components/OrgTree.tsx).
  const notifyLoadFailed = (e: unknown) => notify.error(t('notify:loadFailed'), { detail: localizeError(e) });

  // Eager-load the whole visible tree the first time the popover opens. The tree
  // is small and everything comes through the account-filtered list endpoints,
  // so loading it all up front is what lets search filter correctly without ever
  // surfacing a node the caller could not otherwise see.
  useEffect(() => {
    if (!open || loaded || !accessToken) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const companies = await api.companies.list(accessToken).catch((e) => { notifyLoadFailed(e); return [] as CompanyOut[]; });
      const locsByCo: Record<string, LocationOut[]> = {};
      const grpsByLoc: Record<string, GroupOut[]> = {};
      await Promise.all(companies.map(async co => {
        const locs = await api.locations.list(accessToken, co.id).catch((e) => { notifyLoadFailed(e); return [] as LocationOut[]; });
        locsByCo[co.id] = locs;
        await Promise.all(locs.map(async loc => {
          grpsByLoc[loc.id] = await api.groups.list(accessToken, loc.id).catch((e) => { notifyLoadFailed(e); return [] as GroupOut[]; });
        }));
      }));
      if (cancelled) return;
      setNodes(buildPickerNodes(companies, locsByCo, grpsByLoc));
      setLoaded(true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, loaded, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on click outside and on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (node: PickerNode | null) => { onChange(node); setOpen(false); setQuery(''); };

  const shown = filterNodes(nodes, query);
  const label = value ? value.path.join(' / ') : t('organization:picker.noPlacement');

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, minWidth: 180 }}>
      <button type="button" onClick={() => !disabled && setOpen(o => !o)} disabled={disabled}
        style={{ ...field, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: value ? 'var(--text-1)' : 'var(--text-3)' }}>{label}</span>
        <span style={{ color: 'var(--text-3)', fontSize: 10, flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20,
          background: 'var(--bg-surface)', border: '1px solid var(--border-dim)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', overflow: 'hidden',
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--border-dim)' }}>
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder={t('organization:picker.search')} style={searchInput} />
          </div>
          <div style={{ maxHeight: 260, overflow: 'auto', padding: 4 }}>
            <div onClick={() => pick(null)}
              style={{ padding: '6px 10px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                color: value === null ? 'var(--accent)' : 'var(--text-2)',
                background: value === null ? 'var(--bg-active)' : 'transparent' }}>
              {t('organization:picker.noPlacement')}
            </div>
            {loading && <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-3)' }}>{t('organization:picker.loading')}</div>}
            {!loading && loaded && nodes.length === 0 && (
              <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-3)' }}>{t('organization:picker.noOrganizations')}</div>
            )}
            {nodes.filter(n => shown.has(n.key)).map(n => {
              const selected = value?.key === n.key;
              return (
                <div key={n.key} onClick={() => pick(n)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', paddingLeft: 10 + n.depth * 16, fontSize: 12,
                    borderRadius: 5, cursor: 'pointer',
                    color: selected ? 'var(--accent)' : 'var(--text-2)',
                    fontWeight: selected ? 500 : 400,
                    background: selected ? 'var(--bg-active)' : 'transparent' }}>
                  <span style={{ flexShrink: 0 }}>{icon[n.type]}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                </div>
              );
            })}
            {!loading && loaded && query.trim() && !nodes.some(n => shown.has(n.key)) && (
              <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-3)' }}>{t('organization:picker.noResults')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
