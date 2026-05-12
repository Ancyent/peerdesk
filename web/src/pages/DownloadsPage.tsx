import { getConfig } from '../config';

// suffix: filename in GitHub releases | null: not yet available
const CLIENTS: { title: string; icon: string; desc: string; platforms: { label: string; suffix: string | null }[] }[] = [
  { title: 'Agent (mașina controlată)', icon: '🖥', desc: 'Rulează pe mașina la care vrei acces remote.',
    platforms: [
      { label: 'Linux x86_64',   suffix: 'peerdesk-agent-linux-x86_64' },
      { label: 'Linux .deb',     suffix: null },
      { label: 'Windows .exe',   suffix: null },
      { label: 'macOS .dmg',     suffix: null },
    ]},
  { title: 'Viewer Desktop (Tauri)', icon: '👁', desc: 'Aplicație nativă pentru control remote.',
    platforms: [
      { label: 'Linux',   suffix: null },
      { label: 'Windows', suffix: null },
      { label: 'macOS',   suffix: null },
    ]},
  { title: 'Android', icon: '📱', desc: 'Viewer pe telefon sau tabletă.',
    platforms: [{ label: 'Android .apk', suffix: null }]},
];

export function DownloadsPage() {
  const releasesUrl = getConfig().releasesUrl;
  const base = releasesUrl.replace('/latest', '/latest/download');

  return (
    <div style={{ padding: '24px', maxWidth: 720 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>Download</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: '#64748b' }}>
        <a href={releasesUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
          Toate versiunile pe GitHub →
        </a>
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {CLIENTS.map(item => (
          <div key={item.title} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 24 }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{item.title}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{item.desc}</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {item.platforms.map(p => p.suffix ? (
                <a key={p.label} href={`${base}/${p.suffix}`}
                  style={{ padding: '5px 14px', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 5, textDecoration: 'none', color: '#475569', background: '#f8fafc' }}>
                  ⬇️ {p.label}
                </a>
              ) : (
                <span key={p.label}
                  style={{ padding: '5px 14px', fontSize: 12, border: '1px dashed #e2e8f0', borderRadius: 5, color: '#cbd5e1', background: '#f8fafc' }}>
                  {p.label} — în curând
                </span>
              ))}
            </div>
          </div>
        ))}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>🌐</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Viewer Web</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>Rulează direct în browser, fără instalare.</div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <span style={{ padding: '5px 14px', fontSize: 12, border: '1px solid #bbf7d0', borderRadius: 5, color: '#16a34a', background: '#f0fdf4' }}>
              ✓ Ești deja pe el
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
