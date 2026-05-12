import { useState } from 'react';
import { HostMode } from './HostMode';
import { ViewerMode } from './ViewerMode';

type Mode = 'select' | 'host' | 'viewer';

export default function App() {
  const [mode, setMode] = useState<Mode>('select');

  if (mode === 'host') return <HostMode onBack={() => setMode('select')} />;
  if (mode === 'viewer') return <ViewerMode onBack={() => setMode('select')} />;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', gap: 24,
      fontFamily: 'system-ui, sans-serif', background: '#f9fafb',
      userSelect: 'none',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 32, fontWeight: 700, color: '#111827' }}>PeerDesk</h1>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 15 }}>Remote desktop for everyone</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 280 }}>
        <button
          onClick={() => setMode('host')}
          style={{
            padding: '16px 24px', fontSize: 15, fontWeight: 600, borderRadius: 8,
            background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}
        >
          <span style={{ fontSize: 20 }}>🖥</span>
          Host This PC
        </button>

        <button
          onClick={() => setMode('viewer')}
          style={{
            padding: '16px 24px', fontSize: 15, fontWeight: 600, borderRadius: 8,
            background: '#fff', color: '#2563eb',
            border: '2px solid #2563eb', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}
        >
          <span style={{ fontSize: 20 }}>🔗</span>
          Connect to PC
        </button>
      </div>

      <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>v0.1.2</p>
    </div>
  );
}
