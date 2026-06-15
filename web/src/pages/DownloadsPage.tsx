import { useEffect, useState } from 'react';
import { getConfig } from '../config';

interface Asset { name: string; browser_download_url: string }
interface Release { tag_name: string; html_url: string; assets: Asset[] }

/** Parse "Ancyent/peerdesk" out of the configured releases URL. */
function repoSlug(releasesUrl: string): string | null {
  const m = releasesUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  return m ? m[1] : null;
}

type Group = { title: string; icon: string; desc: string; match: (name: string) => boolean };

const GROUPS: Group[] = [
  { title: 'Agent (mașina controlată)', icon: '🖥', desc: 'Rulează pe mașina la care vrei acces remote.',
    match: (n) => /agent/i.test(n) },
  { title: 'Client Desktop (Tauri)', icon: '🖱', desc: 'Aplicație nativă — e și viewer, și agent (host) în același timp.',
    match: (n) => /viewer|\.msi$|\.dmg$|\.deb$|\.AppImage$|setup\.exe$/i.test(n) && !/agent|android/i.test(n) },
  { title: 'Android', icon: '📱', desc: 'Viewer pe telefon sau tabletă.',
    match: (n) => /android|\.apk$/i.test(n) },
];

/** Human label for an asset filename. */
function label(name: string): string {
  if (/\.AppImage$/i.test(name)) return 'Linux .AppImage';
  if (/\.deb$/i.test(name)) return 'Linux .deb';
  if (/\.msi$/i.test(name)) return 'Windows .msi';
  if (/setup\.exe$/i.test(name)) return 'Windows installer (.exe)';
  if (/\.exe$/i.test(name)) return 'Windows .exe';
  if (/\.dmg$/i.test(name)) return 'macOS .dmg';
  if (/\.apk$/i.test(name)) return 'Android .apk';
  if (/linux/i.test(name)) return 'Linux x86_64';
  return name;
}

export function DownloadsPage() {
  const releasesUrl = getConfig().releasesUrl;
  const slug = repoSlug(releasesUrl);
  const [release, setRelease] = useState<Release | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    if (!slug) { setState('error'); return; }
    fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Release) => { setRelease(data); setState('ok'); })
      .catch(() => setState('error'));
  }, [slug]);

  const card: React.CSSProperties = { border: '1px solid var(--border-dim)', borderRadius: 10, padding: 18, background: 'var(--bg-surface)' };

  return (
    <div style={{ padding: '24px', maxWidth: 720, background: 'var(--bg-base)', minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>Download</h2>
        {release && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'var(--green-bg)', border: '1px solid var(--green-glow)', borderRadius: 20, padding: '2px 10px' }}>
            {release.tag_name}
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--text-2)' }}>
        <a href={release?.html_url ?? releasesUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
          Toate versiunile pe GitHub →
        </a>
      </p>

      {state === 'loading' && <p style={{ color: 'var(--text-2)', fontSize: 13 }}>Se încarcă ultima versiune…</p>}

      {state === 'error' && (
        <div style={card}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)' }}>
            Nu am putut încărca lista de fișiere automat.{' '}
            <a href={releasesUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
              Deschide pagina de releases →
            </a>
          </p>
        </div>
      )}

      {state === 'ok' && release && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {GROUPS.map((g) => {
            const assets = release.assets.filter((a) => g.match(a.name));
            if (assets.length === 0) return null;
            return (
              <div key={g.title} style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 24 }}>{g.icon}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{g.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{g.desc}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {assets.map((a) => (
                    <a key={a.name} href={a.browser_download_url}
                      style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--border-dim)', borderRadius: 5, textDecoration: 'none', color: 'var(--text-1)', background: 'var(--bg-hover)' }}>
                      ⬇ {label(a.name)}
                    </a>
                  ))}
                </div>
              </div>
            );
          })}

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 24 }}>🌐</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>Viewer Web</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Rulează direct în browser, fără instalare.</div>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <span style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--green-glow)', borderRadius: 5, color: 'var(--green)', background: 'var(--green-bg)' }}>
                ✓ Ești deja pe el
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
