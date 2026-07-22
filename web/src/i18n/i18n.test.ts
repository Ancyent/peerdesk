import { describe, it, expect } from 'vitest';

const modules = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

// Collect fully-qualified dotted keys for deep objects.
function keysOf(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? keysOf(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

// Build { ns: { lng: keys[] } }
const byNs: Record<string, Record<string, string[]>> = {};
for (const path in modules) {
  const m = /\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path)!;
  const [, lng, ns] = m;
  (byNs[ns] ??= {})[lng] = keysOf(modules[path].default).sort();
}

describe('locale catalog parity', () => {
  it('every namespace has identical keys in en and ro', () => {
    expect(Object.keys(byNs).length, 'at least one namespace must exist').toBeGreaterThan(0);
    for (const ns in byNs) {
      const langs = byNs[ns];
      expect(Object.keys(langs).sort(), `${ns}: both locales present`).toEqual(['en', 'ro']);
      expect(langs.ro, `${ns}: ro keys match en`).toEqual(langs.en);
    }
  });
});
