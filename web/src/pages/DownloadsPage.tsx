import { getConfig } from '../config';

const LATEST = 'v0.3.9';

const CLIENTS: { title: string; icon: string; desc: string; platforms: { label: string; suffix: string | null }[] }[] = [
  { title: 'Agent (mașina controlată)', icon: '🖥', desc: 'Rulează pe mașina la care vrei acces remote.',
    platforms: [
      { label: 'Linux x86_64',    suffix: `peerdesk-agent-linux-x86_64-${LATEST}` },
      { label: 'Windows .exe',    suffix: `peerdesk-agent-windows-x86_64-${LATEST}.exe` },
      { label: 'macOS .dmg',      suffix: null },
    ]},
  { title: 'Viewer Desktop (Tauri)', icon: '👁', desc: 'Aplicație nativă pentru control remote.',
    platforms: [
      { label: 'Linux .deb',      suffix: `peerdesk-viewer-linux-${LATEST}-amd64.deb` },
      { label: 'Linux .AppImage', suffix: `peerdesk-viewer-linux-${LATEST}.AppImage` },
      { label: 'Windows .msi',    suffix: `peerdesk-viewer-windows-${LATEST}-x64.msi` },
      { label: 'Windows .exe',    suffix: `peerdesk-viewer-windows-${LATEST}-x64-setup.exe` },
      { label: 'macOS',           suffix: null },
    ]},
  { title: 'Android', icon: '📱', desc: 'Viewer pe telefon sau tabletă.',
    platforms: [{ label: 'Android .apk', suffix: `peerdesk-android-${LATEST}.apk` }]},
];

export function DownloadsPage() {
  const releasesUrl = getConfig().releasesUrl;
  const base = releasesUrl.replace('/latest', '/latest/download');

  return (
    <div style={{ padding: '24px', maxWidth: 720, background: 'var(--bg-base)', minHeight: '100%' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>Download</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--text-2)' }}>
        <a href={releasesUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
          Toate versiunile pe GitHub →
        </a>
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {CLIENTS.map(item => (
          <div key={item.title} style={{ border: '1px solid var(--border-dim)', borderRadius: 10, padding: 18, background: 'var(--bg-surface)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 24 }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{item.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{item.desc}</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {item.platforms.map(p => p.suffix ? (
                <a key={p.label} href={`${base}/${p.suffix}`}
                  style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--border-dim)', borderRadius: 5, textDecoration: 'none', color: 'var(--text-2)', background: 'var(--bg-hover)' }}>
                  ⬇️ {p.label}
                </a>
              ) : (
                <span key={p.label}
                  style={{ padding: '5px 14px', fontSize: 12, border: '1px dashed var(--border)', borderRadius: 5, color: 'var(--text-3)', background: 'var(--bg-hover)' }}>
                  {p.label} — în curând
                </span>
              ))}
            </div>
          </div>
        ))}
        <div style={{ border: '1px solid var(--border-dim)', borderRadius: 10, padding: 18, background: 'var(--bg-surface)' }}>
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
    </div>
  );
}
