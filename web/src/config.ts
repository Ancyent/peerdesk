export interface AppConfig {
  apiUrl: string;
  signalingUrl: string;
  releasesUrl: string;
}

const DEFAULTS: AppConfig = {
  apiUrl: '/api',
  signalingUrl: '/ws',
  releasesUrl: 'https://github.com/Ancyent/peerdesk/releases/latest',
};

let _config: AppConfig = {
  ...DEFAULTS,
  signalingUrl: resolveWsUrl(DEFAULTS.signalingUrl),
};

function resolveWsUrl(url: string): string {
  if (url.startsWith('/')) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${url}`;
  }
  return url;
}

export async function initConfig(): Promise<void> {
  try {
    const res = await fetch('/config.json', { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      _config = {
        apiUrl: data.apiUrl ?? DEFAULTS.apiUrl,
        signalingUrl: resolveWsUrl(data.signalingUrl ?? DEFAULTS.signalingUrl),
        releasesUrl: data.releasesUrl ?? DEFAULTS.releasesUrl,
      };
    }
  } catch {
    // network error — keep defaults
  }
}

export function getConfig(): AppConfig {
  return _config;
}
