import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { api, type RegistrationTokenOut, type CompanyOut } from '../api/client';
import { getConfig } from '../config';
import { CodeBlock } from '../components/CodeBlock';
import { OS_TABS, assetLabel, AGENT_ARGS, LINUX_DISTROS, AGENT_UNINSTALL_LINUX, AGENT_UNINSTALL_WINDOWS, formatSize, type OsId } from './downloads/osData';
import { buildCommand } from './downloads/commands';

interface Asset { name: string; browser_download_url: string; size: number }
interface Release { tag_name: string; html_url: string; assets: Asset[] }

function repoSlug(releasesUrl: string): string | null {
  const m = releasesUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  return m ? m[1] : null;
}

const card: React.CSSProperties = { border: '1px solid var(--border-dim)', borderRadius: 10, padding: 18, background: 'var(--bg-surface)' };
const h: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 };

export function DownloadsPage({ os, onOsChange }: { os: OsId; onOsChange: (os: OsId) => void }) {
  const { accessToken } = useAuth();
  const releasesUrl = getConfig().releasesUrl;
  const slug = repoSlug(releasesUrl);

  const [release, setRelease] = useState<Release | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [companies, setCompanies] = useState<CompanyOut[]>([]);
  const [placementCompany, setPlacementCompany] = useState('');
  const [token, setToken] = useState<RegistrationTokenOut | null>(null);
  const [generating, setGenerating] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [distro, setDistro] = useState('ubuntu');

  useEffect(() => {
    if (!slug) { setState('error'); return; }
    fetch(`https://api.github.com/repos/${slug}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Release) => { setRelease(data); setState('ok'); })
      .catch(() => setState('error'));
  }, [slug]);

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
    } catch (e) { console.error(e); }
    finally { setGenerating(false); }
  };

  const origin = window.location.origin;
  const fmt = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  const assetsFor = (m: (n: string) => boolean) => (release?.assets ?? []).filter((a) => m(a.name));

  const dl = (a: Asset) => (
    <a key={a.name} href={a.browser_download_url}
      style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--border-dim)', borderRadius: 5, textDecoration: 'none', color: 'var(--text-1)', background: 'var(--bg-hover)' }}>
      ⬇ {assetLabel(a.name)}{a.size ? ` · ${formatSize(a.size)}` : ''}
    </a>
  );

  return (
    <div style={{ padding: '24px', maxWidth: 760, background: 'var(--bg-base)', minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>Download &amp; Deploy</h2>
        {release && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'var(--green-bg)', border: '1px solid var(--green-glow)', borderRadius: 20, padding: '2px 10px' }}>
            {release.tag_name}
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-2)' }}>
        <a href={release?.html_url ?? releasesUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
          Toate versiunile pe GitHub →
        </a>
      </p>

      <div style={{ ...card, marginBottom: 16 }}>
        {!token ? (
          <>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--text-2)' }}>Token de înregistrare</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={placementCompany} onChange={e => setPlacementCompany(e.target.value)}
                style={{ flex: 1, minWidth: 180, padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-dim)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-1)' }}>
                <option value="">Fără organizare</option>
                {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
              </select>
              <button onClick={generate} disabled={generating || !accessToken}
                style={{ padding: '8px 18px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: accessToken ? 'pointer' : 'not-allowed', opacity: accessToken ? 1 : 0.5 }}>
                {generating ? 'Generez...' : 'Generează token'}
              </button>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-3)' }}>Comenzile de mai jos se completează automat cu token-ul + adresa serverului.</p>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, letterSpacing: 3, color: 'var(--green)' }}>{token.token}</div>
              <div style={{ fontSize: 12, color: 'var(--green)' }}>{secondsLeft > 0 ? `Expiră în ${fmt(secondsLeft)}` : 'EXPIRAT'} · folosit o singură dată</div>
            </div>
            <button onClick={() => setToken(null)} style={{ padding: '6px 14px', fontSize: 12, border: '1px solid var(--border-dim)', borderRadius: 6, background: 'var(--bg-hover)', cursor: 'pointer', color: 'var(--text-2)' }}>
              Alt token
            </button>
          </div>
        )}
      </div>

      {state === 'loading' && <p style={{ color: 'var(--text-2)', fontSize: 13 }}>Se încarcă ultima versiune…</p>}
      {state === 'error' && (
        <div style={card}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)' }}>
            Nu am putut încărca lista de fișiere automat.{' '}
            <a href={releasesUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Deschide releases →</a>
          </p>
        </div>
      )}

      {state === 'ok' && release && (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {OS_TABS.map(t => (
              <button key={t.id} disabled={!t.enabled} onClick={() => t.enabled && onOsChange(t.id)}
                style={{
                  padding: '6px 16px', fontSize: 13, borderRadius: 6, cursor: t.enabled ? 'pointer' : 'not-allowed',
                  background: os === t.id ? 'var(--bg-base)' : 'var(--bg-hover)',
                  color: os === t.id ? '#fff' : 'var(--text-2)',
                  border: os === t.id ? 'none' : '1px solid var(--border-dim)',
                  opacity: t.enabled ? 1 : 0.5,
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {OS_TABS.filter(t => t.id === os).map(t => {
            const assets = assetsFor(t.match);
            const isLinux = t.id === 'linux';
            const d = LINUX_DISTROS.find(x => x.id === distro) ?? LINUX_DISTROS[0];
            const viewerAsset = isLinux ? assets.find(a => d.match(a.name)) : undefined;
            const agentAssets = assets.filter(a => /peerdesk-agent-linux/i.test(a.name));
            return (
              <div key={t.id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {isLinux && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {LINUX_DISTROS.map(x => (
                      <button key={x.id} onClick={() => setDistro(x.id)}
                        style={{
                          padding: '5px 14px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                          background: distro === x.id ? 'var(--accent)' : 'var(--bg-hover)',
                          color: distro === x.id ? '#fff' : 'var(--text-2)',
                          border: distro === x.id ? 'none' : '1px solid var(--border-dim)',
                        }}>
                        {x.label}
                      </button>
                    ))}
                  </div>
                )}

                <div>
                  <div style={h}>Descarcă</div>
                  {isLinux ? (
                    viewerAsset ? (
                      <>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>{dl(viewerAsset)}</div>
                        <CodeBlock code={d.installHint.replace(/<file>/g, viewerAsset.name)} />
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Pachet indisponibil pentru {d.label} în {release.tag_name}.</div>
                    )
                  ) : assets.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Niciun fișier pentru {t.label} în {release.tag_name}.</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{assets.map(dl)}</div>
                  )}
                </div>

                {isLinux && agentAssets.length > 0 && (
                  <div>
                    <div style={h}>Agent (binar)</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{agentAssets.map(dl)}</div>
                  </div>
                )}

                {t.hasDeploy && (
                  <div>
                    <div style={h}>Deploy</div>
                    <CodeBlock code={buildCommand(t.id, { origin, token: token?.token ?? null })} empty="Generează un token mai întâi ↑" />
                  </div>
                )}

                <div>
                  <div style={h}>Dezinstalare (terminal)</div>
                  {isLinux ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {viewerAsset && (
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Client / viewer ({d.label})</div>
                          <CodeBlock code={d.uninstallHint.replace(/<file>/g, viewerAsset.name)} />
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Agent (serviciu + binar)</div>
                        <CodeBlock code={AGENT_UNINSTALL_LINUX} />
                      </div>
                    </div>
                  ) : t.id === 'windows' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Agent (PowerShell ca Administrator)</div>
                        <CodeBlock code={AGENT_UNINSTALL_WINDOWS} />
                      </div>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)' }}>Viewer-ul desktop se dezinstalează din Setări → Aplicații.</p>
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)' }}>Dezinstalează aplicația din launcher-ul Android.</p>
                  )}
                </div>

                {t.note && <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)' }}>{t.note}</p>}
              </div>
            );
          })}

          <div style={{ ...card, marginTop: 16 }}>
            <div style={h}>Argumente (agent)</div>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-2)' }}>Aceleași pe Linux și Windows. Le folosești dacă rulezi binarul manual sau în mod portabil.</p>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {AGENT_ARGS.map(a => (
                <div key={a.flag} style={{ display: 'flex', gap: 12, fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--border-dim)' }}>
                  <code style={{ minWidth: 170, fontFamily: 'monospace', color: 'var(--green)' }}>{a.flag}</code>
                  <span style={{ color: 'var(--text-2)' }}>{a.meaning}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card, marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>🌐</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>Viewer Web</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Rulează direct în browser — ești deja pe el.</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
