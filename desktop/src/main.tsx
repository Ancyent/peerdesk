import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>PeerDesk</h1>
      <p style={{ color: '#6b7280', marginBottom: 32 }}>Native desktop client</p>

      <div style={{ padding: 24, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Host Mode</h2>
        <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
          Allow others to connect to this machine.
        </p>
      </div>

      <div style={{ padding: 24, border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>View Mode</h2>
        <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
          Connect to a remote machine.
        </p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
