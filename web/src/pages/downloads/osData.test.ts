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
    expect(assetLabel('peerdesk-viewer-windows-0.4.28-portable.exe')).toBe('portabil (.exe)');
    expect(assetLabel('peerdesk-viewer-windows-0.4.28-x64-setup.exe')).toBe('installer (.exe)');
    expect(assetLabel('peerdesk-agent-windows-x86_64-v0.4.28.exe')).toBe('agent .exe');
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
