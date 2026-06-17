import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-shell';

const RELEASES_API = 'https://api.github.com/repos/Ancyent/peerdesk/releases/latest';
const RELEASES_PAGE = 'https://github.com/Ancyent/peerdesk/releases/latest';

/** -1 if a<b, 0 if equal, 1 if a>b (numeric dotted versions). */
function cmpVer(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** Bottom-right version badge; checks GitHub for a newer release and offers a
 *  one-click jump to the download page when one is available. */
export function UpdateBadge() {
  const [current, setCurrent] = useState('');
  const [latest, setLatest] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const goToRelease = async () => {
    try {
      await open(RELEASES_PAGE);
    } catch {
      // shell open not permitted — copy the link so the user can paste it
      try {
        await navigator.clipboard.writeText(RELEASES_PAGE);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch { /* ignore */ }
    }
  };

  useEffect(() => {
    getVersion().then(setCurrent).catch(() => {});
    fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.tag_name) setLatest(String(d.tag_name).replace(/^v/, '')); })
      .catch(() => {});
  }, []);

  const updateAvailable = !!current && !!latest && cmpVer(latest!, current) > 0;

  return (
    <div style={{ position: 'fixed', right: 10, bottom: 7, zIndex: 500, userSelect: 'none' }}>
      {updateAvailable ? (
        <button
          onClick={goToRelease}
          title={`Update available: v${latest} — click to download`}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(38,198,218,0.12)', border: '1px solid rgba(38,198,218,0.45)',
            borderRadius: 20, padding: '3px 10px', cursor: 'pointer',
            fontSize: 10.5, fontWeight: 600, color: '#26c6da',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#26c6da', boxShadow: '0 0 6px #26c6da', animation: 'pulsedot 2s infinite' }} />
          {copied ? 'Link copied — open in browser' : `Update available · v${latest}`}
        </button>
      ) : (
        <span style={{ fontSize: 10, color: '#5b6675', padding: '3px 8px' }}>
          v{current || '—'}{latest && current ? ' · up to date' : ''}
        </span>
      )}
      <style>{`@keyframes pulsedot{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
    </div>
  );
}
