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
