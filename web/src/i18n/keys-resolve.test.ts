// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import i18n from './index';

// Known namespaces = catalog filenames under locales/en.
const enCatalogs = import.meta.glob('./locales/en/*.json', { eager: true }) as Record<
  string,
  unknown
>;
const KNOWN_NS = new Set(
  Object.keys(enCatalogs).map((p) => /\/([^/]+)\.json$/.exec(p)![1]),
);

// Raw source of every component/page/hook — not i18n infra, not test files.
const sources = import.meta.glob('../**/*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const scannable = Object.entries(sources).filter(
  ([p]) => !p.includes('/i18n/') && !/\.test\.(ts|tsx)$/.test(p),
);

const resolves = (key: string) => i18n.t(key) !== key;

describe('i18n keys resolve', () => {
  it('every direct t() key is ns:key colon form and resolves', () => {
    const problems: string[] = [];
    const CALL = /\bt\(\s*(['"])([^'"]+)\1/g;
    for (const [path, src] of scannable) {
      CALL.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL.exec(src))) {
        const key = m[2];
        if (!key.includes(':')) problems.push(`${path}: t('${key}') is not in ns:key colon form`);
        else if (!resolves(key)) problems.push(`${path}: t('${key}') does not resolve`);
      }
    }
    expect(problems, `\n${problems.join('\n')}`).toEqual([]);
  });

  it('every namespaced key literal (incl. keys stored in data structures) resolves and uses colon form', () => {
    const problems: string[] = [];
    const LIT = /(['"])([a-zA-Z][\w-]*)([:.])([\w.:-]+)\1/g;
    for (const [path, src] of scannable) {
      LIT.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LIT.exec(src))) {
        const [, , ns, sep, rest] = m;
        if (!KNOWN_NS.has(ns)) continue;
        const colonKey = `${ns}:${rest}`;
        const real = resolves(colonKey);
        if (sep === '.') {
          // Dot form of a REAL key is the keySeparator bug. Non-keys like 'common.js'
          // (whose colon form does not resolve) are ignored to avoid false positives.
          if (real) problems.push(`${path}: '${ns}.${rest}' uses dot form of a real key — use '${ns}:${rest}'`);
        } else if (!real) {
          problems.push(`${path}: '${ns}:${rest}' does not resolve to a translation`);
        }
      }
    }
    expect(problems, `\n${problems.join('\n')}`).toEqual([]);
  });
});
