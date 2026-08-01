// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRITICAL_COMPONENT_FILES, PUBLISHED_HOOKS, RESERVED_TOKEN_PREFIX } from '@pd/ui';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** A hook written as code rather than quoted as data.
 *
 *  The preceding character matters. `[data-pd-btn] {` in a style string and a
 *  bare `data-pd-btn` JSX attribute both put a hook on the page; `'data-pd-btn'`
 *  inside PUBLISHED_HOOKS only names one. Without this distinction the file
 *  that *declares* the contract counts as carrying it, which is wrong in the
 *  one place it most needs to be right. */
const HOOK_IN_CODE = /(^|[^'"`])data-pd-[a-z-]+/m;

/** Find all files in shared/ui that carry a data-pd-* hook.
 *
 *  This is computed from the actual source, not hardcoded, so a future
 *  component that gains a hook is automatically included and doesn't require
 *  a list update. Both .tsx and .ts are scanned: a hook can be rendered from a
 *  helper in a plain .ts file just as easily as from a component.
 */
function deriveHookCarryingModules(): Set<string> {
  const sharedUiDir = resolve(repoRoot, 'shared/ui');
  const files = readdirSync(sharedUiDir).filter((f) => /\.tsx?$/.test(f));
  const hookCarrying = new Set<string>();

  for (const file of files) {
    const path = join(sharedUiDir, file);
    const source = readFileSync(path, 'utf-8');
    if (HOOK_IN_CODE.test(source)) {
      // Store the bare name (without extension) as it appears in imports.
      hookCarrying.add(file.replace(/\.tsx?$/, ''));
    }
  }

  return hookCarrying;
}

describe('theme surface', () => {
  // A theme can only restyle what it can select. Anything without a data-pd-*
  // hook is unreachable, whatever the CSS property rules allow — so this list
  // is the actual security boundary, not the property allowlist.
  it.each(CRITICAL_COMPONENT_FILES)('%s carries no direct themeable hook', (file) => {
    const source = readFileSync(resolve(repoRoot, file), 'utf-8');
    expect(source.match(/data-pd-[a-z-]+/g) ?? []).toEqual([]);
  });

  it('critical components do not import hook-carrying modules from @pd/ui', () => {
    const hookCarrying = deriveHookCarryingModules();

    // Extract the import statements from shared/ui to know which names to look for.
    for (const file of CRITICAL_COMPONENT_FILES) {
      const source = readFileSync(resolve(repoRoot, file), 'utf-8');

      // Find all imports from @pd/ui and check if any of them are hook-carrying.
      const importMatches = [...source.matchAll(/import\s+{([^}]+)}\s+from\s+['"]@pd\/ui['"]/g)];

      for (const match of importMatches) {
        const importedNames = match[1]
          .split(',')
          .map((s) => s.trim())
          .map((s) => s.split(' as ')[0]); // Handle "import { X as Y }"

        for (const name of importedNames) {
          expect(hookCarrying.has(name)).toBe(
            false,
            `${file} imports ${name} from @pd/ui, which carries a data-pd-* hook`,
          );
        }
      }
    }
  });

  it.each(CRITICAL_COMPONENT_FILES)('%s reads only reserved tokens', (file) => {
    // Selection is not the only way to reach an element. The app is
    // token-driven, so a theme that could set --text-1 would blank this
    // dialog's title without ever naming it in a selector. Every var() a
    // critical component reads must therefore be a token no theme may set.
    const source = readFileSync(resolve(repoRoot, file), 'utf-8');
    const read = [...source.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]);

    const settable = read.filter((t) => !t.startsWith(RESERVED_TOKEN_PREFIX));
    expect(settable).toEqual([]);
  });

  it('finds tokens at all, so the reserved-token check is not vacuous', () => {
    // If the regex above stopped matching, every critical component would pass
    // the check by reading nothing.
    const source = readFileSync(resolve(repoRoot, 'shared/ui/ConfirmDialog.tsx'), 'utf-8');
    const read = [...source.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]);
    expect(read.length).toBeGreaterThan(0);
    expect(read).toContain('--pd-sys-text-1');
  });

  it('does not count the contract file itself as hook-carrying', () => {
    // themeSurface.ts names every published hook as a quoted string. Counting
    // that as carrying one would make the derived set wrong in the one file
    // whose whole job is to describe the boundary.
    expect(deriveHookCarryingModules().has('themeSurface')).toBe(false);
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

  it('derives hook-carrying modules from @pd/ui source, proving the list is not vacuous', () => {
    // If deriveHookCarryingModules returns an empty set, every critical component
    // passes the import check vacuously. This test ensures the derivation actually
    // finds the hooks that exist today (Button, Input).
    const hookCarrying = deriveHookCarryingModules();
    expect(hookCarrying.size).toBeGreaterThan(0);
    expect(hookCarrying.has('Button')).toBe(true);
    expect(hookCarrying.has('Input')).toBe(true);
  });

  it('allows critical components to import non-hook exports from @pd/ui', () => {
    // Ensure we are not overly strict — importing useNotify, useConfirm, etc
    // should be fine because those do not carry hooks.
    const hookCarrying = deriveHookCarryingModules();
    expect(hookCarrying.has('useNotify')).toBe(false);
    expect(hookCarrying.has('useConfirm')).toBe(false);
  });
});
