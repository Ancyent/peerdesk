/** What a theme may reach, and what it must never reach.
 *
 *  The security boundary of the theme system is this list, not the CSS property
 *  allowlist on the server. Colour and typography are exactly what a theme must
 *  be able to change, so no property rule can stop a theme making a component it
 *  was given unreadable. What does hold is that an element with no data-pd-*
 *  hook cannot be selected at all.
 *
 *  These files must therefore never gain one. The trap is real and dated: the
 *  pending "convert the remaining pages to primitives" work would, done
 *  mechanically, drop <Button> into ApprovalDialog and make the session approval
 *  prompt themeable with nobody noticing. themeSurface.test.ts fails if it does.
 *
 *  Kept in step by hand with PUBLISHED_SELECTORS in server/api/themes/surface.py.
 */
export const CRITICAL_COMPONENT_FILES = [
  'desktop/src/components/ApprovalDialog.tsx',
  'desktop/src/components/SecurityCodeBanner.tsx',
  'shared/ui/ConfirmDialog.tsx',
] as const;

/** The attribute names a theme may select. Must match the server's list. */
export const PUBLISHED_HOOKS = [
  'data-pd-btn',
  'data-pd-input',
  'data-pd-machine',
] as const;
