// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotifyProvider, ConfirmProvider } from '@pd/ui';

const latest = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    releases: { latest: (...a: unknown[]) => latest(...a) },
    tokens: { create: vi.fn() },
    companies: { list: vi.fn(async () => []) },
    locations: { list: vi.fn(async () => []) },
    groups: { list: vi.fn(async () => []) },
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ accessToken: null }) }));
vi.mock('../config', () => ({ getConfig: () => ({ releasesUrl: 'https://example.test/releases' }) }));

import { DownloadsPage } from './DownloadsPage';

let container: HTMLDivElement;
let root: Root;

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NotifyProvider><ConfirmProvider>
        <DownloadsPage os="linux" onOsChange={() => {}} />
      </ConfirmProvider></NotifyProvider>,
    );
  });
}

/** The "all releases" link is the only anchor pointing outside the API. */
function releaseLinkHrefs(): string[] {
  return [...container.querySelectorAll('a')]
    .map((a) => a.getAttribute('href') ?? '')
    .filter((h) => !h.startsWith('/api/'));
}

beforeEach(() => latest.mockReset());
afterEach(() => act(() => root.unmount()));

describe('DownloadsPage "all releases" link', () => {
  it('falls back to the configured releases URL when html_url is an EMPTY STRING', async () => {
    // What a locally built release carries: write_manifest.py has no release
    // page to point at, and release_cache's GitHub path stores "" too when the
    // API omits the field. `??` would let "" through and render href="",
    // which reloads the current page instead of opening anything.
    latest.mockResolvedValue({ tag_name: 'v9.9.9', html_url: '', assets: [] });
    await render();
    const hrefs = releaseLinkHrefs();
    expect(hrefs).toContain('https://example.test/releases');
    expect(hrefs).not.toContain('');
  });

  it('falls back when html_url is missing entirely', async () => {
    latest.mockResolvedValue({ tag_name: 'v9.9.9', assets: [] });
    await render();
    expect(releaseLinkHrefs()).toContain('https://example.test/releases');
  });

  it('uses the release page when the mirror supplies one', async () => {
    latest.mockResolvedValue({
      tag_name: 'v9.9.9',
      html_url: 'https://github.com/owner/repo/releases/tag/v9.9.9',
      assets: [],
    });
    await render();
    expect(releaseLinkHrefs()).toContain('https://github.com/owner/repo/releases/tag/v9.9.9');
  });
});
