import type { GrantOut } from '../api/client';

export type NodeType = 'company' | 'location' | 'group';

export function childTypeOf(type: NodeType): 'location' | 'group' | null {
  if (type === 'company') return 'location';
  if (type === 'location') return 'group';
  return null;
}

export function renameInList<T extends { id: string; name: string }>(list: T[], id: string, name: string): T[] {
  return list.map((x) => (x.id === id ? { ...x, name } : x));
}

export function removeFromList<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((x) => x.id !== id);
}

export function renameInRecord<T extends { id: string; name: string }>(
  rec: Record<string, T[]>, id: string, name: string,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const k of Object.keys(rec)) out[k] = renameInList(rec[k], id, name);
  return out;
}

export function removeFromRecord<T extends { id: string }>(
  rec: Record<string, T[]>, id: string,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const k of Object.keys(rec)) out[k] = removeFromList(rec[k], id);
  return out;
}

export type GrantNode =
  | { type: 'company';  id: string }
  | { type: 'location'; id: string; companyId: string }
  | { type: 'group';    id: string; companyId: string; locationId: string }
  | { type: 'machine';  id: string; companyId: string | null;
      locationId: string | null; groupId: string | null };

export interface Coverage {
  checked: boolean;
  /** The id of the ancestor grant covering this node, or null when the node is
   *  granted directly. A non-null `via` must render the checkbox disabled: the
   *  grant is not on this node, so unchecking it here would change nothing. */
  via: string | null;
}

export function coveredBy(grants: GrantOut[], node: GrantNode): Coverage {
  const direct = grants.some(g => {
    if (node.type === 'company')  return g.company_id  === node.id;
    if (node.type === 'location') return g.location_id === node.id;
    if (node.type === 'group')    return g.group_id    === node.id;
    return g.machine_id === node.id;
  });
  if (direct) return { checked: true, via: null };

  // Ancestors, nearest first, so `via` names the closest grant rather than an
  // arbitrary one when several apply.
  const ancestors: string[] = [];
  if (node.type === 'location') ancestors.push(node.companyId);
  if (node.type === 'group')    ancestors.push(node.locationId, node.companyId);
  if (node.type === 'machine') {
    for (const a of [node.groupId, node.locationId, node.companyId]) {
      if (a) ancestors.push(a);
    }
  }

  for (const ancestorId of ancestors) {
    const covered = grants.some(g =>
      g.company_id === ancestorId || g.location_id === ancestorId || g.group_id === ancestorId
    );
    if (covered) return { checked: true, via: ancestorId };
  }

  return { checked: false, via: null };
}
