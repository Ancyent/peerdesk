import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { api, ApiError } from '../api/client';
import type { MachineOut } from '../api/client';

interface Props {
  onConnect: (peerId: string) => void;
}

export function DashboardPage({ onConnect }: Props) {
  const { user, accessToken, logout } = useAuth();
  const [machines, setMachines] = useState<MachineOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!accessToken) return;
    api.machines.list(accessToken)
      .then(setMachines)
      .catch(err => setError(err instanceof ApiError ? err.message : 'Failed to load machines'))
      .finally(() => setLoading(false));
  }, [accessToken]);

  return (
    <div style={{ fontFamily:'sans-serif', maxWidth:800, margin:'0 auto', padding:'24px 16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24, paddingBottom:16, borderBottom:'1px solid #e5e7eb' }}>
        <h1 style={{ margin:0, fontSize:22 }}>PeerDesk</h1>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ color:'#666', fontSize:14 }}>{user?.name}</span>
          <button onClick={logout}
            style={{ padding:'6px 14px', borderRadius:6, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontSize:14 }}>
            Logout
          </button>
        </div>
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ margin:0, fontSize:16, fontWeight:600 }}>My Machines</h2>
      </div>

      {loading && <p style={{ color:'#9ca3af', textAlign:'center', padding:32 }}>Loading…</p>}
      {error && <p style={{ color:'red' }}>{error}</p>}

      {!loading && !error && machines.length === 0 && (
        <div style={{ padding:32, border:'1px dashed #d1d5db', borderRadius:8, textAlign:'center', color:'#6b7280' }}>
          <p style={{ margin:'0 0 8px', fontWeight:500 }}>No machines registered yet</p>
          <p style={{ margin:0, fontSize:13 }}>
            Start the PeerDesk agent on a machine with your API token to register it here.
          </p>
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {machines.map(m => (
          <div key={m.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>
            <div>
              <div style={{ fontWeight:600, fontSize:15 }}>{m.name}</div>
              <div style={{ color:'#6b7280', fontSize:13, marginTop:2 }}>
                ID: <code style={{ fontFamily:'monospace', background:'#f3f4f6', padding:'1px 5px', borderRadius:3 }}>{m.peer_id}</code>
                {m.os && <span> · {m.os}</span>}
              </div>
              <div style={{ fontSize:12, marginTop:6, display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background: m.is_online ? '#22c55e' : '#9ca3af' }} />
                <span style={{ color: m.is_online ? '#16a34a' : '#9ca3af' }}>
                  {m.is_online ? 'Online' : 'Offline'}
                </span>
                {m.last_seen_at && !m.is_online && (
                  <span style={{ color:'#d1d5db' }}>· last seen {new Date(m.last_seen_at).toLocaleString()}</span>
                )}
              </div>
            </div>
            <button
              onClick={() => onConnect(m.peer_id)}
              style={{
                padding:'8px 20px', borderRadius:6, fontSize:14, fontWeight:500, border:'none',
                background: m.is_online ? 'var(--accent)' : '#f3f4f6',
                color: m.is_online ? '#fff' : '#9ca3af',
                cursor: m.is_online ? 'pointer' : 'default',
              }}
            >
              Connect
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
