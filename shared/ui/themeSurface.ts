/** What a theme may reach, and what it must never reach.
 *
 *  The theme system's boundary has two halves, and this file is one of them.
 *  A theme can only restyle what it can *select*, and an element with no
 *  data-pd-* hook cannot be selected — that is the half enforced here. The
 *  other half lives on the server: a theme can also reach an element it never
 *  selected, by declaring the custom property that element reads. The
 *  validator therefore also allowlists token names, and security-critical UI
 *  renders through --pd-sys-* tokens no theme may declare (SETTABLE_TOKENS and
 *  RESERVED_TOKEN_PREFIX in server/api/themes/surface.py). Neither half is
 *  sufficient alone; the CSS property allowlist is neither, since colour and
 *  typography are exactly what a theme must be able to change.
 *
 *  The files below must never gain a hook. The trap is real and dated: the
 *  pending "convert the remaining pages to primitives" work would, done
 *  mechanically, drop <Button> into ApprovalDialog and make the session
 *  approval prompt themeable with nobody noticing. Modal.tsx is listed because
 *  ConfirmDialog renders through it; if Modal ever gained a hook, ConfirmDialog
 *  would become implicitly themeable.
 *
 *  What themeSurface.test.ts actually catches, stated exactly, because it is
 *  narrower than "either directly or through composition" and a docstring that
 *  overstates a guard is worse than no docstring:
 *
 *    Caught  - a data-pd-* attribute written in one of the files below;
 *            - a named import of a hook-carrying @pd/ui module into one of
 *              them, e.g. `import { Button } from '@pd/ui'`.
 *
 *    Not caught - a namespace import (`import * as ui from '@pd/ui'`);
 *               - a deep import (`from '@pd/ui/Button'`);
 *               - a default-style import;
 *               - an indirect one, where a critical file imports a local
 *                 wrapper that re-exports a hook-carrying component.
 *
 *  Those are deliberately out of scope: the threat this guard exists for is a
 *  mechanical migration adding an ordinary named import, not an author routing
 *  around a check on purpose. Anyone doing the latter can also delete the test.
 *
 *  Kept in step by hand with PUBLISHED_SELECTORS in server/api/themes/surface.py.
 */
export const CRITICAL_COMPONENT_FILES = [
  'desktop/src/components/ApprovalDialog.tsx',
  'desktop/src/components/SecurityCodeBanner.tsx',
  'shared/ui/ConfirmDialog.tsx',
  'shared/ui/Modal.tsx',
] as const;

/** Tokens carrying this prefix are the other half of the boundary: the server
 *  validator rejects any theme that declares one, so a component styled purely
 *  through them cannot be reached by an uploaded theme at all. Must match
 *  RESERVED_TOKEN_PREFIX in server/api/themes/surface.py. */
export const RESERVED_TOKEN_PREFIX = '--pd-sys-';

/** The attribute names a theme may select. Must match the server's list. */
export const PUBLISHED_HOOKS = [
  'data-pd-btn',
  'data-pd-input',
  'data-pd-machine',
] as const;
