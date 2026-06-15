// localStorage-backed list of recently connected peer IDs.

export interface RecentConnection {
  peerId: string;
  lastConnected: number;
}

const KEY = 'pd_recent_connections';
const MAX = 8;

export function getRecents(): RecentConnection[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentConnection[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(r => typeof r?.peerId === 'string');
  } catch {
    return [];
  }
}

export function addRecent(peerId: string): RecentConnection[] {
  const next: RecentConnection[] = [
    { peerId, lastConnected: Date.now() },
    ...getRecents().filter(r => r.peerId !== peerId),
  ].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / unavailable */
  }
  return next;
}
