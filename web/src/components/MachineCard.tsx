import type { MachineOut } from '../api/client';

interface Props {
  machine: MachineOut;
  onConnect: (peerId: string) => void;
  onDelete?: (id: string) => void;
}

function getOsConfig(os: string | null): { icon: string; bg: string } {
  const s = os?.toLowerCase() ?? '';
  if (s.includes('windows')) return { icon: '🪟', bg: 'linear-gradient(135deg,#1a2540,#1e2d4a)' };
  if (s.includes('mac'))     return { icon: '🍎', bg: 'linear-gradient(135deg,#1a2030,#202838)' };
  return { icon: '🐧', bg: 'linear-gradient(135deg,#182538,#1c2e42)' };
}

function formatLastSeen(ts: string | null): string {
  if (!ts) return '';
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return 'acum';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}z`;
}

export function MachineCard({ machine: m, onConnect, onDelete }: Props) {
  const { icon, bg } = getOsConfig(m.os);
  const online = m.is_online;

  return (
    <div
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-dim)', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', opacity: online ? 1 : 0.55, transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1), border-color 0.25s, box-shadow 0.25s' }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = 'translateY(-3px)'; el.style.borderColor = online ? 'rgba(0,200,150,0.35)' : 'rgba(0,168,255,0.25)'; el.style.boxShadow = '0 12px 32px rgba(0,200,150,0.10)'; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = ''; el.style.borderColor = ''; el.style.boxShadow = ''; }}
    >
      {/* Thumbnail */}
      <div style={{ height: 110, background: bg, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 46, opacity: 0.15 }}>{icon}</div>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 30%, var(--bg-surface) 100%)' }} />
        {online && (
          <div style={{ position: 'absolute', left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(0,200,150,0.5), transparent)', animation: 'scan-line 4s linear infinite' }} />
        )}
        <div style={{ position: 'absolute', top: 10, left: 12, background: 'rgba(17,24,36,0.8)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, padding: '3px 10px', fontSize: 10, fontWeight: 600, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: online ? 'var(--green)' : 'var(--text-3)', boxShadow: online ? '0 0 5px var(--green)' : 'none', animation: online ? 'pulse-dot 2s infinite' : 'none' }} />
          {online ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '13px 15px 15px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 22 }}>{icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'monospace', marginTop: 2, letterSpacing: 1 }}>
              {m.peer_id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 · $2 · $3')}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 11 }}>
          {m.os ?? 'Linux'}{!online && m.last_seen_at ? ` · offline ${formatLastSeen(m.last_seen_at)}` : online ? ' · ultima activitate: acum' : ''}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={!online} onClick={() => online && onConnect(m.peer_id)} style={{ flex: 1, padding: '8px 0', background: online ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--bg-hover)', border: 'none', borderRadius: 8, color: online ? 'var(--text-1)' : 'var(--text-3)', fontSize: 12, fontWeight: 700, cursor: online ? 'pointer' : 'default', boxShadow: online ? '0 2px 12px rgba(0,200,150,0.38)' : 'none', transition: 'all 0.2s' }}>
            {online ? '⚡ Conectează' : 'Offline'}
          </button>
          {onDelete && (
            <button onClick={() => onDelete(m.id)} title="Șterge mașina" aria-label="Șterge mașina" style={{ padding: '8px 12px', background: 'var(--bg-hover)', border: '1px solid var(--border-dim)', borderRadius: 8, color: 'var(--text-2)', fontSize: 12, cursor: 'pointer', transition: 'all 0.18s' }}>···</button>
          )}
        </div>
      </div>
    </div>
  );
}
