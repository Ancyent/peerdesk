import { useState, useEffect } from 'react';
import { useAuth } from '../auth/useAuth';
import { api, type RegistrationTokenOut, type CompanyOut } from '../api/client';
import { getConfig } from '../config';

type Platform = 'linux' | 'windows' | 'macos';

export function AgentInstallPage() {
  const { accessToken } = useAuth();
  const [companies, setCompanies] = useState<CompanyOut[]>([]);
  const [placementCompany, setPlacementCompany] = useState('');
  const [token, setToken] = useState<RegistrationTokenOut | null>(null);
  const [platform, setPlatform] = useState<Platform>('linux');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    api.companies.list(accessToken).then(setCompanies).catch(console.error);
  }, [accessToken]);

  useEffect(() => {
    if (!token) return;
    const expiry = new Date(token.expires_at).getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.floor((expiry - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [token]);

  const generate = async () => {
    if (!accessToken) return;
    setGenerating(true);
    try {
      const t = await api.tokens.create(accessToken, placementCompany ? { company_id: placementCompany } : undefined);
      setToken(t);
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  const origin = window.location.origin;
  const rawSig = getConfig().signalingUrl;
  const sigUrl = rawSig.startsWith('/') ? `${origin.replace(/^http/, 'ws')}/ws` : rawSig;

  const commands: Record<Platform, string> = {
    linux:   token ? `curl -fsSL ${origin}/install-agent.sh | PEERDESK_TOKEN=${token.token} PEERDESK_SERVER=${sigUrl} bash` : '',
    windows: token ? `$env:PEERDESK_TOKEN="${token.token}"; $env:PEERDESK_SERVER="${sigUrl}"; iwr ${origin}/install-agent.ps1 | iex` : '',
    macos:   token ? `curl -fsSL ${origin}/install-agent.sh | PEERDESK_TOKEN=${token.token} PEERDESK_SERVER=${sigUrl} bash` : '',
  };

  const copyCmd = () => {
    navigator.clipboard.writeText(commands[platform]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fmt = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

  return (
    <div style={{ padding: '24px', maxWidth: 640 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>Instalare Agent</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: '#64748b' }}>
        Generează un token de înregistrare și rulează comanda pe mașina pe care vrei să o controlezi.
      </p>

      {!token ? (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: '#374151' }}>Plasare (opțional)</label>
          <select value={placementCompany} onChange={e => setPlacementCompany(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 16 }}>
            <option value="">Fără organizare</option>
            {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
          </select>
          <button onClick={generate} disabled={generating}
            style={{ width: '100%', padding: 10, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
            {generating ? 'Generez...' : 'Generează token de înregistrare'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ border: '1px solid #bbf7d0', borderRadius: 10, padding: 20, background: '#f0fdf4', textAlign: 'center' }}>
            <div style={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 700, letterSpacing: 4, color: '#15803d', marginBottom: 6 }}>{token.token}</div>
            <div style={{ fontSize: 12, color: '#16a34a' }}>
              {secondsLeft > 0 ? `Expiră în ${fmt(secondsLeft)}` : 'EXPIRAT'} · folosit o singură dată
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {(['linux', 'windows', 'macos'] as Platform[]).map(p => (
                <button key={p} onClick={() => setPlatform(p)} style={{
                  padding: '5px 14px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                  background: platform === p ? '#0f172a' : '#f1f5f9',
                  color: platform === p ? '#fff' : '#64748b',
                  border: platform === p ? 'none' : '1px solid #e2e8f0',
                }}>
                  {p === 'linux' ? 'Linux' : p === 'windows' ? 'Windows' : 'macOS'}
                </button>
              ))}
            </div>
            <div style={{ background: '#0f172a', borderRadius: 8, padding: '12px 14px', fontFamily: 'monospace', fontSize: 11, color: '#e2e8f0', lineHeight: 1.6, wordBreak: 'break-all' }}>
              {commands[platform]}
            </div>
            <button onClick={copyCmd} style={{ marginTop: 8, padding: '6px 16px', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 5, background: '#fff', cursor: 'pointer', color: copied ? '#16a34a' : '#475569' }}>
              {copied ? '✓ Copiat' : '📋 Copiază comanda'}
            </button>
          </div>

          <button onClick={() => setToken(null)} style={{ padding: 8, fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#64748b' }}>
            Generează alt token
          </button>
        </div>
      )}
    </div>
  );
}
