import type { CSSProperties, ReactNode } from 'react';

export type SurfaceKind = 'card' | 'panel' | 'chrome';

const GEOMETRY: Record<SurfaceKind, CSSProperties> = {
  card: { borderRadius: 'var(--radius)', padding: 16 },
  panel: { borderRadius: 'var(--radius)', padding: 20 },
  chrome: { borderRadius: 0, padding: 0 },
};

/** Reads the surface recipe straight off the token set, which is what lets the
 *  same component render as glass on web and as an opaque panel on desktop with
 *  no prop, no branch and no build flag - desktop simply declares
 *  --surface-blur: none.
 *
 *  -webkit-backdrop-filter is not redundant. Nothing in this toolchain adds
 *  vendor prefixes (there is no autoprefixer), and WebKitGTK - the engine
 *  behind the Tauri window - ships the property prefixed. */
export function surfaceStyle(kind: SurfaceKind = 'card'): CSSProperties {
  const blur = kind === 'chrome' ? 'var(--chrome-blur)' : 'var(--surface-blur)';
  return {
    ...GEOMETRY[kind],
    background: kind === 'chrome' ? 'var(--chrome-bg)' : 'var(--surface-bg)',
    border: kind === 'chrome' ? undefined : 'var(--surface-border)',
    boxShadow: kind === 'chrome' ? undefined : 'var(--surface-shadow)',
    backdropFilter: blur,
    WebkitBackdropFilter: blur,
  };
}

interface Props {
  kind?: SurfaceKind;
  children: ReactNode;
  style?: CSSProperties;
}

export function Surface({ kind = 'card', children, style }: Props) {
  return <div style={{ ...surfaceStyle(kind), ...style }}>{children}</div>;
}
