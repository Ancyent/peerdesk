import { useState, useEffect, useCallback } from 'react';
import { useTauriAgent } from './hooks/useTauriAgent';

interface Props { onBack: () => void; }

export function HostMode({ onBack }: Props) {
  const { status, loading, error, start, stop, refresh } = useTauriAgent();
  const [password, setPassword] = useState('');
  const [signalingUrl, setSignalingUrl] = useState(
    localStorage.getItem('pd_signaling_url') ?? 'ws://localhost:8001/ws'
  );
  const [showPwd, setShowPwd] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!status.running) return;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [status.running, refresh]);

  const handleStart = useCallback(() => {
    if (!password.trim()) return;
    localStorage.setItem('pd_signaling_url', signalingUrl);
    start(password, signalingUrl);
  }, [password, signalingUrl, start]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(status.peer_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [status.peer_id]);

  const inp: React.CSSProperties = {
    padding: '10px 12px', fontSize: 14, borderRadius: 6,
    border: '1px solid #d1d5db', width: '100%', boxSizing: 'border-box',
    outline: 'none',
  };

  const formatId = (id: string) =>
    id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 460, margin: '0 auto', padding: '28px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 22, lineHeight: 1 }}>←</button>
        <h2 style={{ margin: 0, fontSize: 20 }}>Host This PC</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: status.running ? '#22c55e' : '#d1d5db' }} />
          <span style={{ fontSize: 12, color: status.running ? '#16a34a' : '#9ca3af' }}>
            {status.running ? 'Running' : 'Stopped'}
          </span>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
          {error}
        </div>
      )}

      {status.running ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '24px 20px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 6px', fontSize: 12, color: '#15803d', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Your ID</p>
            <p style={{ margin: '0 0 14px', fontSize: 38, fontWeight: 700, letterSpacing: 8, fontFamily: 'monospace', color: '#111827' }}>
              {formatId(status.peer_id)}
            </p>
            <button onClick={handleCopy} style={{
              padding: '7px 18px', borderRadius: 6, border: '1px solid #86efac',
              background: '#fff', color: '#15803d', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            }}>
              {copied ? '✓ Copied!' : 'Copy ID'}
            </button>
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Password</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 5 }}>
              <input type={showPwd ? 'text' : 'password'} value={status.password} readOnly
                style={{ ...inp, flex: 1, fontFamily: 'monospace', background: '#f9fafb' }} />
              <button onClick={() => setShowPwd(s => !s)}
                style={{ padding: '0 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 16 }}>
                {showPwd ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          <button onClick={stop} disabled={loading} style={{
            padding: '11px 0', background: '#dc2626', color: '#fff', border: 'none',
            borderRadius: 6, fontSize: 14, cursor: 'pointer', fontWeight: 600,
            opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Stopping…' : 'Stop Hosting'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleStart()}
              placeholder="Set a password for viewers" style={inp} autoFocus />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Signaling Server</label>
            <input type="text" value={signalingUrl} onChange={e => setSignalingUrl(e.target.value)}
              placeholder="ws://your-server/ws" style={inp} />
          </div>
          <button onClick={handleStart} disabled={loading || !password.trim()} style={{
            padding: '11px 0', background: '#2563eb', color: '#fff', border: 'none',
            borderRadius: 6, fontSize: 14, cursor: 'pointer', fontWeight: 600,
            opacity: (!password.trim() || loading) ? 0.6 : 1,
          }}>
            {loading ? 'Starting…' : 'Start Hosting'}
          </button>
        </div>
      )}
    </div>
  );
}
