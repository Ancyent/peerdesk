// web/src/components/ConnectForm.tsx
import { useState } from 'react';

interface Props {
  onConnect: (peerId: string, password: string) => void;
  error?: string;
}

export function ConnectForm({ onConnect, error }: Props) {
  const [peerId, setPeerId] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', gap: 16, fontFamily: 'sans-serif'
    }}>
      <h1 style={{ margin: 0 }}>PeerDesk</h1>
      <p style={{ color: '#666', margin: 0 }}>Enter the remote machine ID</p>
      {error && <p style={{ color: 'red', margin: 0 }}>{error}</p>}
      <form
        onSubmit={(e) => { e.preventDefault(); onConnect(peerId, password); }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 280 }}
      >
        <input
          type="text"
          placeholder="9-digit ID"
          value={peerId}
          onChange={(e) => setPeerId(e.target.value.replace(/\D/g, '').slice(0, 9))}
          style={{
            padding: '10px 12px', fontSize: 18, letterSpacing: 4,
            borderRadius: 6, border: '1px solid #ccc', textAlign: 'center'
          }}
          maxLength={9}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: '10px 12px', fontSize: 16, borderRadius: 6, border: '1px solid #ccc' }}
          required
        />
        <button
          type="submit"
          disabled={peerId.length !== 9}
          style={{
            padding: 10, fontSize: 16, borderRadius: 6,
            background: '#2563eb', color: '#fff', border: 'none',
            cursor: peerId.length === 9 ? 'pointer' : 'not-allowed',
            opacity: peerId.length === 9 ? 1 : 0.6
          }}
        >
          Connect
        </button>
      </form>
    </div>
  );
}
