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
    <div style={{ padding: '24px', maxWidth: 640, background: 'var(--bg-base)', minHeight: '100%' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>Instalare Agent</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--text-2)' }}>
        Generează un token de înregistrare și rulează comanda pe mașina pe care vrei să o controlezi.
      </p>

      {!token ? (
        <div style={{ border: '1px solid var(--border-dim)', borderRadius: 10, padding: 20, background: 'var(--bg-surface)' }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--text-2)' }}>Plasare (opțional)</label>
          <select value={placementCompany} onChange={e => setPlacementCompany(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-dim)', borderRadius: 6, marginBottom: 16, background: 'var(--bg-surface)', color: 'var(--text-1)' }}>
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
          <div style={{ border: '1px solid var(--green-glow)', borderRadius: 10, padding: 20, background: 'var(--green-bg)', textAlign: 'center' }}>
            <div style={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 700, letterSpacing: 4, color: 'var(--green)', marginBottom: 6 }}>{token.token}</div>
            <div style={{ fontSize: 12, color: 'var(--green)' }}>
              {secondsLeft > 0 ? `Expiră în ${fmt(secondsLeft)}` : 'EXPIRAT'} · folosit o singură dată
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {(['linux', 'windows', 'macos'] as Platform[]).map(p => (
                <button key={p} onClick={() => setPlatform(p)} style={{
                  padding: '5px 14px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                  background: platform === p ? 'var(--bg-base)' : 'var(--bg-hover)',
                  color: platform === p ? '#fff' : 'var(--text-2)',
                  border: platform === p ? 'none' : '1px solid var(--border-dim)',
                }}>
                  {p === 'linux' ? 'Linux' : p === 'windows' ? 'Windows' : 'macOS'}
                </button>
              ))}
            </div>
            <div style={{ background: 'var(--bg-base)', borderRadius: 8, padding: '12px 14px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-1)', lineHeight: 1.6, wordBreak: 'break-all', border: '1px solid var(--border-dim)' }}>
              {commands[platform]}
            </div>
            <button onClick={copyCmd} style={{ marginTop: 8, padding: '6px 16px', fontSize: 12, border: '1px solid var(--border-dim)', borderRadius: 5, background: 'var(--bg-hover)', cursor: 'pointer', color: copied ? 'var(--green)' : 'var(--text-2)' }}>
              {copied ? '✓ Copiat' : '📋 Copiază comanda'}
            </button>
          </div>

          <button onClick={() => setToken(null)} style={{ padding: 8, fontSize: 12, border: '1px solid var(--border-dim)', borderRadius: 6, background: 'var(--bg-hover)', cursor: 'pointer', color: 'var(--text-2)' }}>
            Generează alt token
          </button>
        </div>
      )}
    </div>
  );
}
