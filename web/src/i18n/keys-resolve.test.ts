// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import i18n from './index';

// Raw source of every component/page/hook — not the i18n infra, not test files.
const sources = import.meta.glob('../**/*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

// Match t('...') / t("...") first string-literal argument (skips dynamic/template keys).
const CALL = /\bt\(\s*(['"])([^'"]+)\1/g;

describe('i18n keys resolve', () => {
  it('every static t() key uses ns:key colon form and resolves to a translation', () => {
    const problems: string[] = [];
    for (const path in sources) {
      if (path.includes('/i18n/')) continue;
      if (/\.test\.(ts|tsx)$/.test(path)) continue;
      const src = sources[path];
      CALL.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL.exec(src))) {
        const key = m[2];
        if (!key.includes(':')) {
          problems.push(`${path}: t('${key}') is not in ns:key colon form`);
          continue;
        }
        if (i18n.t(key) === key) {
          problems.push(`${path}: t('${key}') does not resolve to a translation`);
        }
      }
    }
    expect(problems, `\n${problems.join('\n')}`).toEqual([]);
  });
});
