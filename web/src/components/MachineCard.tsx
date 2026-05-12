import type { MachineOut } from '../api/client';

interface Props {
  machine: MachineOut;
  onConnect: (peerId: string) => void;
  onDelete?: (id: string) => void;
}

export function MachineCard({ machine: m, onConnect, onDelete }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 7, background: '#fff', opacity: m.is_online ? 1 : 0.65 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginRight: 12, background: m.is_online ? '#22c55e' : '#d1d5db' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
          {m.os && <span>{m.os} · </span>}
          <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>{m.peer_id}</code>
          {!m.is_online && m.last_seen_at && <span> · offline {new Date(m.last_seen_at).toLocaleString()}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginLeft: 10, flexShrink: 0 }}>
        <button
          onClick={() => m.is_online && onConnect(m.peer_id)}
          disabled={!m.is_online}
          style={{ padding: '4px 14px', fontSize: 12, fontWeight: 500, border: 'none', borderRadius: 5, background: m.is_online ? 'var(--accent)' : '#f3f4f6', color: m.is_online ? '#fff' : '#d1d5db', cursor: m.is_online ? 'pointer' : 'default' }}
        >
          Connect
        </button>
        {onDelete && (
          <button onClick={() => onDelete(m.id)} style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 5, background: '#fff', color: '#9ca3af', cursor: 'pointer' }}>
            ···
          </button>
        )}
      </div>
    </div>
  );
}
