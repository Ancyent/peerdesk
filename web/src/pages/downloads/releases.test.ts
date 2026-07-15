import { describe, it, expect, vi, afterEach } from 'vitest';

// config.ts accesses bare `location` at module-load time (browser global);
// stub it away so this test can run under the node test environment, same
// approach as src/api/client.refresh.test.ts.
vi.mock('../../config', () => ({ getConfig: () => ({ apiUrl: '' }) }));

const { api } = await import('../../api/client');

afterEach(() => vi.unstubAllGlobals());

describe('api.releases.latest', () => {
  it('fetches the manifest from our own API, never from GitHub', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v0.4.32', html_url: '', assets: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.releases.latest();

    // Assert on every call made (not just the first) and the exact count, so
    // a broken implementation that hits our API *and* still calls GitHub
    // (e.g. as a fallback) cannot slip through this test.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('api.github.com');
    }
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/releases/latest');
  });

  it('surfaces a 503 (nothing cached) as an error the page can show', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'No release cached yet' }),
    }));

    await expect(api.releases.latest()).rejects.toThrow();
  });
});
