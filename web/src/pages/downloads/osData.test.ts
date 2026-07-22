import { describe, it, expect } from 'vitest';
import { OS_TABS, assetLabel, AGENT_ARGS } from './osData';

const find = (id: string) => OS_TABS.find(t => t.id === id)!;

describe('OS_TABS matchers', () => {
  it('classifies linux assets', () => {
    expect(find('linux').match('peerdesk-agent-linux-x86_64')).toBe(true);
    expect(find('linux').match('peerdesk-viewer_0.4.27_amd64.deb')).toBe(true);
    expect(find('linux').match('peerdesk-viewer_0.4.27.AppImage')).toBe(true);
    expect(find('linux').match('peerdesk-agent-windows-x86_64.exe')).toBe(false);
  });
  it('classifies windows assets', () => {
    expect(find('windows').match('peerdesk-agent-windows-x86_64.exe')).toBe(true);
    expect(find('windows').match('peerdesk-viewer_0.4.27_x64.msi')).toBe(true);
    expect(find('windows').match('peerdesk-viewer_0.4.27.AppImage')).toBe(false);
  });
  it('classifies android assets', () => {
    expect(find('android').match('peerdesk-viewer.apk')).toBe(true);
    expect(find('android').match('peerdesk-agent-linux-x86_64')).toBe(false);
  });
  it('macos tab is disabled and has no deploy', () => {
    expect(find('macos').enabled).toBe(false);
    expect(find('macos').hasDeploy).toBe(false);
  });
  it('linux and windows have deploy, android does not', () => {
    expect(find('linux').hasDeploy).toBe(true);
    expect(find('windows').hasDeploy).toBe(true);
    expect(find('android').hasDeploy).toBe(false);
  });
});

describe('assetLabel', () => {
  it('labels by extension', () => {
    expect(assetLabel('x_amd64.deb')).toBe('.deb');
    expect(assetLabel('x.msi')).toBe('.msi');
    expect(assetLabel('x.apk')).toBe('.apk');
  });
  it('labels the portable windows viewer distinctly from setup and agent', () => {
    expect(assetLabel('peerdesk-viewer-windows-0.4.28-portable.exe')).toBe('downloads:assetLabel.portableExe');
    expect(assetLabel('peerdesk-viewer-windows-0.4.28-x64-setup.exe')).toBe('downloads:assetLabel.installerExe');
    expect(assetLabel('peerdesk-agent-windows-x86_64-v0.4.28.exe')).toBe('downloads:assetLabel.agentExe');
  });
});

import { AGENT_UNINSTALL_LINUX } from './osData';

describe('uninstall hints', () => {
  it('every distro has install + uninstall hints', () => {
    for (const d of LINUX_DISTROS) {
      expect(d.installHint.length).toBeGreaterThan(0);
      expect(d.uninstallHint.length).toBeGreaterThan(0);
    }
  });
  it('deb/rpm uninstall targets the real package name peer-desk', () => {
    for (const id of ['ubuntu', 'fedora', 'opensuse']) {
      const d = LINUX_DISTROS.find(x => x.id === id)!;
      expect(d.uninstallHint).toContain('peer-desk');
    }
    // AppImage isn't a package — uninstall is just deleting the file.
    expect(LINUX_DISTROS.find(x => x.id === 'arch')!.uninstallHint).toContain('rm ');
  });
  it('agent uninstall removes the service, the binary, and the config', () => {
    expect(AGENT_UNINSTALL_LINUX).toContain('--uninstall-service');
    expect(AGENT_UNINSTALL_LINUX).toContain('/usr/local/bin/peerdesk-agent');
    expect(AGENT_UNINSTALL_LINUX).toContain('/root/.config/peerdesk');
  });
});

describe('AGENT_ARGS', () => {
  it('documents all nine binary flags', () => {
    const flags = AGENT_ARGS.map(a => a.flag);
    for (const f of ['--server=URL','--api-key=TOKEN','--password=PW','--silent','--portable','--get-id','--reset-password','--install-service','--uninstall-service']) {
      expect(flags).toContain(f);
    }
    expect(AGENT_ARGS.every(a => a.meaning.length > 0)).toBe(true);
  });
});

import { coerceOs } from './osData';

describe('coerceOs', () => {
  it('returns the matching enabled os id', () => {
    expect(coerceOs('windows')).toBe('windows');
    expect(coerceOs('android')).toBe('android');
  });
  it('null / unknown / disabled → linux', () => {
    expect(coerceOs(null)).toBe('linux');
    expect(coerceOs('bogus')).toBe('linux');
    expect(coerceOs('macos')).toBe('linux'); // macos tab is disabled
  });
});

import { LINUX_DISTROS, formatSize } from './osData';

describe('linux tab matches rpm', () => {
  it('classifies an rpm as a linux asset', () => {
    expect(find('linux').match('peerdesk-viewer-linux-v0.4.30-x86_64.rpm')).toBe(true);
  });
});

describe('assetLabel rpm', () => {
  it('labels rpm', () => {
    expect(assetLabel('peerdesk-viewer-linux-v0.4.30-x86_64.rpm')).toBe('.rpm');
  });
});

describe('LINUX_DISTROS', () => {
  const byId = (id: string) => LINUX_DISTROS.find(d => d.id === id)!;
  it('has ubuntu/fedora/opensuse/arch with non-empty hints', () => {
    for (const id of ['ubuntu', 'fedora', 'opensuse', 'arch']) {
      expect(byId(id).installHint.length).toBeGreaterThan(0);
    }
  });
  it('ubuntu picks the .deb, fedora + opensuse pick the .rpm, arch picks the AppImage', () => {
    const deb = 'peerdesk-viewer-linux-v0.4.30-amd64.deb';
    const rpm = 'peerdesk-viewer-linux-v0.4.30-x86_64.rpm';
    const app = 'peerdesk-viewer-linux-v0.4.30.AppImage';
    expect(byId('ubuntu').match(deb)).toBe(true);
    expect(byId('ubuntu').match(rpm)).toBe(false);
    expect(byId('fedora').match(rpm)).toBe(true);
    expect(byId('opensuse').match(rpm)).toBe(true);
    expect(byId('arch').match(app)).toBe(true);
    expect(byId('arch').match(deb)).toBe(false);
  });
  it('fedora and opensuse resolve to the same rpm but different hints', () => {
    expect(byId('fedora').pkg).toBe('rpm');
    expect(byId('opensuse').pkg).toBe('rpm');
    expect(byId('fedora').installHint).not.toBe(byId('opensuse').installHint);
  });
});

describe('formatSize', () => {
  it('formats MB and KB and guards non-positive', () => {
    expect(formatSize(23_700_000)).toBe('22.6 MB');
    expect(formatSize(500_000)).toBe('488 KB');
    expect(formatSize(0)).toBe('');
    expect(formatSize(NaN)).toBe('');
  });
});
