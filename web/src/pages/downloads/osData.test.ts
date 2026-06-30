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
});

describe('AGENT_ARGS', () => {
  it('documents all nine binary flags', () => {
    const flags = AGENT_ARGS.map(a => a.flag);
    for (const f of ['--server=URL','--token=TOKEN','--password=PW','--silent','--portable','--get-id','--reset-password','--install-service','--uninstall-service']) {
      expect(flags).toContain(f);
    }
    expect(AGENT_ARGS.every(a => a.meaning.length > 0)).toBe(true);
  });
});
