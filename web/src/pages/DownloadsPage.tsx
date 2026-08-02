import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNotify } from '@pd/ui';
import { useAuth } from '../auth/useAuth';
import { api, ApiError, type RegistrationTokenOut, type Release, type ReleaseAsset } from '../api/client';
import { localizeError } from '../api/errors';
import { getConfig } from '../config';
import { CodeBlock } from '../components/CodeBlock';
import { TreePicker } from '../components/TreePicker';
import { placementFor, type PickerNode } from '../components/treePicker';
import { OS_TABS, assetLabel, AGENT_ARGS, LINUX_DISTROS, AGENT_UNINSTALL_LINUX, AGENT_UNINSTALL_WINDOWS, formatSize, uninstallHint, type OsId } from './downloads/osData';
import { buildCommand, type InstallMode } from './downloads/commands';

type Asset = ReleaseAsset;

const card: React.CSSProperties = { border: '1px solid var(--border-dim)', borderRadius: 10, padding: 18, background: 'var(--bg-surface)' };
const h: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 };

export function DownloadsPage({ os, onOsChange }: { os: OsId; onOsChange: (os: OsId) => void }) {
  const { t } = useTranslation('downloads');
  const { accessToken } = useAuth();
  const { notify } = useNotify();
  const releasesUrl = getConfig().releasesUrl;

  const [release, setRelease] = useState<Release | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [placement, setPlacement] = useState<PickerNode | null>(null);
  const [token, setToken] = useState<RegistrationTokenOut | null>(null);
  const [generating, setGenerating] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [distro, setDistro] = useState('ubuntu');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<InstallMode>('auto');
  const [machineName, setMachineName] = useState('');

  useEffect(() => {
    // Our own API mirrors GitHub releases. Calling api.github.com from the
    // browser capped everyone behind one NAT at 60 requests/hour and broke
    // outright for clients with no route to GitHub.
    api.releases
      .latest()
      .then((data) => { setRelease(data); setState('ok'); })
      .catch((e) => {
        setErrorMessage(e instanceof ApiError ? localizeError(e) : '');
        setState('error');
      });
  }, []);

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
      const tok = await api.tokens.create(accessToken, {
        ...(placement ? placementFor(placement) : {}),
        ...(machineName.trim() ? { name: machineName.trim() } : {}),
      });
      setToken(tok);
    } catch (e) {
      notify.error(t('notify:downloads.tokenFailed'), { detail: localizeError(e) });
    }
    finally { setGenerating(false); }
  };

  const origin = window.location.origin;
  const fmt = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  const assetsFor = (m: (n: string) => boolean) => (release?.assets ?? []).filter((a) => m(a.name));

  // assetLabel() returns either a `downloads:assetLabel.*` key or a plain
  // string (technical extension label or, as a last resort, the raw
  // filename) — only resolve the former through t().
  const assetDisplayLabel = (name: string) => {
    const raw = assetLabel(name);
    return raw.startsWith('downloads:') ? t(raw) : raw;
  };

  const dl = (a: Asset) => (
    <a key={a.name} href={a.browser_download_url}
      style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--border-dim)', borderRadius: 5, textDecoration: 'none', color: 'var(--text-1)', background: 'var(--bg-hover)' }}>
      ⬇ {assetDisplayLabel(a.name)}{a.size ? ` · ${formatSize(a.size)}` : ''}
    </a>
  );

  return (
    <div style={{ padding: '24px', maxWidth: 760, minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{t('downloads:page.title')}</h2>
        {release && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'var(--green-bg)', border: '1px solid var(--green-glow)', borderRadius: 20, padding: '2px 10px' }}>
            {release.tag_name}
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-2)' }}>
        {/* `||`, not `??`: a manifest can carry html_url as an empty string, not
            just as a missing key. A locally built release has no release page at
            all, and even the GitHub mirror stores `rel.get("html_url", "")`. `??`
            passes "" straight through and renders href="", which reloads the
            current page instead of opening the releases list. */}
        <a href={release?.html_url || releasesUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
          {t('downloads:page.allReleasesLink')}
        </a>
      </p>

      <div style={{ ...card, marginBottom: 16 }}>
        {!token ? (
          <>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--text-2)' }}>{t('downloads:page.tokenLabel')}</label>
            <input value={machineName} onChange={e => setMachineName(e.target.value)}
              placeholder={t('downloads:page.machineNamePlaceholder')}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8, padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-dim)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-1)', outline: 'none' }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <TreePicker value={placement} onChange={setPlacement} disabled={!accessToken} />
              <button onClick={generate} disabled={generating || !accessToken}
                style={{ padding: '8px 18px', background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: accessToken ? 'pointer' : 'not-allowed', opacity: accessToken ? 1 : 0.5 }}>
                {generating ? t('downloads:page.generating') : t('downloads:page.generateToken')}
              </button>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-3)' }}>{t('downloads:page.tokenHint')}</p>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, letterSpacing: 3, color: 'var(--green)' }}>{token.token}</div>
              <div style={{ fontSize: 12, color: 'var(--green)' }}>{secondsLeft > 0 ? t('downloads:page.expiresIn', { time: fmt(secondsLeft) }) : t('downloads:page.expired')} · {t('downloads:page.usedOnce')}</div>
            </div>
            <button onClick={() => setToken(null)} style={{ padding: '6px 14px', fontSize: 12, border: '1px solid var(--border-dim)', borderRadius: 6, background: 'var(--bg-hover)', cursor: 'pointer', color: 'var(--text-2)' }}>
              {t('downloads:page.anotherToken')}
            </button>
          </div>
        )}
      </div>

      {state === 'loading' && <p style={{ color: 'var(--text-2)', fontSize: 13 }}>{t('downloads:page.loadingRelease')}</p>}
      {state === 'error' && (
        <div style={card}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)' }}>
            {t('downloads:page.loadError')}{' '}
            {errorMessage && <span>({errorMessage}){' '}</span>}
            <a href={releasesUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{t('downloads:page.openReleases')}</a>
          </p>
        </div>
      )}

      {state === 'ok' && release && (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {OS_TABS.map(tab => (
              <button key={tab.id} disabled={!tab.enabled} onClick={() => tab.enabled && onOsChange(tab.id)}
                style={{
                  padding: '6px 16px', fontSize: 13, borderRadius: 6, cursor: tab.enabled ? 'pointer' : 'not-allowed',
                  background: os === tab.id ? 'var(--bg-base)' : 'var(--bg-hover)',
                  color: os === tab.id ? '#fff' : 'var(--text-2)',
                  border: os === tab.id ? 'none' : '1px solid var(--border-dim)',
                  opacity: tab.enabled ? 1 : 0.5,
                }}>
                {t(tab.label)}
              </button>
            ))}
          </div>

          {OS_TABS.filter(tab => tab.id === os).map(tab => {
            const assets = assetsFor(tab.match);
            const isLinux = tab.id === 'linux';
            const d = LINUX_DISTROS.find(x => x.id === distro) ?? LINUX_DISTROS[0];
            const viewerAsset = isLinux ? assets.find(a => d.match(a.name)) : undefined;
            const agentAssets = assets.filter(a => /peerdesk-agent-linux/i.test(a.name));
            return (
              <div key={tab.id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                        {t(x.label)}
                      </button>
                    ))}
                  </div>
                )}

                <div>
                  <div style={h}>{t('downloads:page.download')}</div>
                  {isLinux ? (
                    viewerAsset ? (
                      <>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>{dl(viewerAsset)}</div>
                        <CodeBlock code={d.installHint.replace(/<file>/g, viewerAsset.name)} />
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('downloads:page.noPackageForDistro', { distro: t(d.label), tag: release.tag_name })}</div>
                    )
                  ) : assets.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('downloads:page.noFileForOs', { os: t(tab.label), tag: release.tag_name })}</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{assets.map(dl)}</div>
                  )}
                </div>

                {isLinux && agentAssets.length > 0 && (
                  <div>
                    <div style={h}>{t('downloads:page.agentBinary')}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{agentAssets.map(dl)}</div>
                  </div>
                )}

                {tab.hasDeploy && (
                  <div>
                    <div style={h}>{t('downloads:page.deploy')}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                      <input
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                        placeholder={t('downloads:page.passwordPlaceholder')}
                        style={{ flex: '1 1 200px', minWidth: 160, padding: '7px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-dim)', background: 'var(--bg-hover)', color: 'var(--text-1)', outline: 'none' }}
                      />
                      {isLinux && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          {(['auto', 'headless', 'gui'] as const).map((mo) => (
                            <button key={mo} type="button" onClick={() => setMode(mo)}
                              title={mo === 'auto' ? t('downloads:page.modeAutoTitle') : mo === 'headless' ? t('downloads:page.modeHeadlessTitle') : t('downloads:page.modeGuiTitle')}
                              style={{
                                padding: '6px 12px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                                background: mode === mo ? 'var(--accent)' : 'var(--bg-hover)',
                                color: mode === mo ? '#fff' : 'var(--text-2)',
                                border: mode === mo ? 'none' : '1px solid var(--border-dim)',
                              }}>
                              {mo === 'auto' ? t('downloads:page.modeAuto') : mo === 'headless' ? t('downloads:page.modeHeadless') : t('downloads:page.modeGui')}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <CodeBlock code={buildCommand(tab.id, { origin, token: token?.token ?? null, password: pw.trim() || undefined, mode: isLinux ? mode : undefined })} empty={t('downloads:page.generateTokenFirst')} />
                  </div>
                )}

                <div>
                  <div style={h}>{t('downloads:page.uninstallTerminal')}</div>
                  {isLinux ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-2)', background: 'var(--bg-hover)', border: '1px solid var(--border-dim)', borderRadius: 6, padding: '8px 10px', lineHeight: 1.5 }}>
                        ℹ️ <Trans
                          i18nKey="downloads:page.uninstallInfo"
                          components={{
                            agentBold: <b />,
                            notPackageBold: <b />,
                            installCmd: <code>curl … | bash</code>,
                            uninstallCmd: <code>apt/dnf/zypper remove peer-desk</code>,
                            extCmd: <code>.deb/.rpm</code>,
                          }}
                        />
                      </div>
                      {viewerAsset && (
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{t('downloads:page.clientViewerLabel', { distro: t(d.label) })}</div>
                          <CodeBlock code={uninstallHint(d, release.linux_package).replace(/<file>/g, viewerAsset.name)} />
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{t('downloads:page.agentUninstallLabel')}</div>
                        <CodeBlock code={AGENT_UNINSTALL_LINUX} />
                      </div>
                    </div>
                  ) : tab.id === 'windows' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{t('downloads:page.agentUninstallLabelWindows')}</div>
                        <CodeBlock code={AGENT_UNINSTALL_WINDOWS} />
                      </div>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)' }}>{t('downloads:page.viewerUninstallWindows')}</p>
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)' }}>{t('downloads:page.uninstallAndroid')}</p>
                  )}
                </div>

                {tab.note && <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)' }}>{t(tab.note)}</p>}
              </div>
            );
          })}

          <div style={{ ...card, marginTop: 16 }}>
            <div style={h}>{t('downloads:page.agentArgsTitle')}</div>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-2)' }}>{t('downloads:page.agentArgsSubtitle')}</p>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {AGENT_ARGS.map(a => (
                <div key={a.flag} style={{ display: 'flex', gap: 12, fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--border-dim)' }}>
                  <code style={{ minWidth: 170, fontFamily: 'monospace', color: 'var(--green)' }}>{a.flag}</code>
                  <span style={{ color: 'var(--text-2)' }}>{t(a.meaning)}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card, marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>🌐</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{t('downloads:page.webViewerTitle')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{t('downloads:page.webViewerSubtitle')}</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
