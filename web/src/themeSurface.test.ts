// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRITICAL_COMPONENT_FILES, PUBLISHED_HOOKS } from '@pd/ui';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('theme surface', () => {
  // A theme can only restyle what it can select. Anything without a data-pd-*
  // hook is unreachable, whatever the CSS property rules allow — so this list
  // is the actual security boundary, not the property allowlist.
  it.each(CRITICAL_COMPONENT_FILES)('%s carries no themeable hook', (file) => {
    const source = readFileSync(resolve(repoRoot, file), 'utf-8');
    expect(source.match(/data-pd-[a-z-]+/g) ?? []).toEqual([]);
  });

  it('publishes exactly the three hooks the server validator allows', () => {
    // Kept in step with server/api/themes/surface.py by hand. If they drift, a
    // theme the server accepts styles nothing, or vice versa.
    expect([...PUBLISHED_HOOKS].sort()).toEqual(
      ['data-pd-btn', 'data-pd-input', 'data-pd-machine'],
    );
  });

  it('lists files that exist, so a rename cannot silently empty the guard', () => {
    for (const file of CRITICAL_COMPONENT_FILES) {
      expect(() => readFileSync(resolve(repoRoot, file), 'utf-8')).not.toThrow();
    }
  });
});
