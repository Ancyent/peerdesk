import { getConfig } from '../config';

const CLIENTS = [
  { title: 'Agent (mașina controlată)', icon: '🖥', desc: 'Rulează pe mașina la care vrei acces remote.',
    platforms: [
      { label: 'Linux .deb',     suffix: 'peerdesk-agent-linux-amd64.deb' },
      { label: 'Linux .AppImage',suffix: 'peerdesk-agent-linux-x86_64.AppImage' },
      { label: 'Windows .exe',   suffix: 'peerdesk-agent-windows-x86_64.exe' },
      { label: 'macOS .dmg',     suffix: 'peerdesk-agent-macos-universal.dmg' },
    ]},
  { title: 'Viewer Desktop (Tauri)', icon: '👁', desc: 'Aplicație nativă pentru control remote.',
    platforms: [
      { label: 'Linux .deb',  suffix: 'peerdesk-viewer-linux-amd64.deb' },
      { label: 'Windows .msi',suffix: 'peerdesk-viewer-windows.msi' },
      { label: 'macOS .dmg',  suffix: 'peerdesk-viewer-macos-universal.dmg' },
    ]},
  { title: 'Android', icon: '📱', desc: 'Viewer pe telefon sau tabletă.',
    platforms: [{ label: 'Android .apk', suffix: 'peerdesk-android.apk' }]},
];

export function DownloadsPage() {
  const releasesUrl = getConfig().releasesUrl;
  const base = releasesUrl.replace('/latest', '/latest/download');

  return (
    <div style={{ padding: '24px', maxWidth: 720 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>Download</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: '#64748b' }}>
        <a href={releasesUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Toate versiunile pe GitHub →</a>
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
              {item.platforms.map(p => (
                <a key={p.suffix} href={`${base}/${p.suffix}`} style={{ padding: '5px 14px', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 5, textDecoration: 'none', color: '#475569', background: '#f8fafc' }}>
                  ⬇️ {p.label}
                </a>
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
            <span style={{ padding: '5px 14px', fontSize: 12, border: '1px solid #bbf7d0', borderRadius: 5, color: '#16a34a', background: '#f0fdf4' }}>✓ Ești deja pe el</span>
          </div>
        </div>
      </div>
    </div>
  );
}
