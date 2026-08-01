// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRITICAL_COMPONENT_FILES, PUBLISHED_HOOKS } from '@pd/ui';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Find all files in shared/ui that carry a data-pd-* hook.
 *
 *  This is computed from the actual source, not hardcoded, so a future
 *  component that gains a hook is automatically included and doesn't require
 *  a list update.
 */
function deriveHookCarryingModules(): Set<string> {
  const sharedUiDir = resolve(repoRoot, 'shared/ui');
  const files = readdirSync(sharedUiDir).filter((f) => f.endsWith('.tsx'));
  const hookCarrying = new Set<string>();

  for (const file of files) {
    const path = join(sharedUiDir, file);
    const source = readFileSync(path, 'utf-8');
    if (/data-pd-[a-z-]+/.test(source)) {
      // Export the bare name (without .tsx) as it appears in import statements.
      hookCarrying.add(file.replace(/\.tsx$/, ''));
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
