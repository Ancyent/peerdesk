import { pickerItemColors } from '../lib/pickerColors';

interface DisplayInfo {
  index: number;
  width: number;
  height: number;
  is_primary: boolean;
}

interface Props {
  displays: DisplayInfo[];
  current: number;
  onChange: (index: number) => void;
  // When true, render as a plain inline row (no absolute overlay positioning) so
  // a parent (e.g. the controls panel) can place it.
  inline?: boolean;
}

// Show the primary (Default) monitor first so it is numbered 1; others follow in
// xcap order. The button still switches by the real `index`, only the displayed
// number is the friendly position.
function ordered(displays: DisplayInfo[]): DisplayInfo[] {
  return [...displays].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.index - b.index,
  );
}

export function DisplaySelector({ displays, current, onChange, inline = false }: Props) {
  if (displays.length <= 1) return null;
  const wrap = inline
    ? { display: 'flex', gap: 6 }
    : { position: 'absolute' as const, top: 8, left: 8, zIndex: 5, display: 'flex', gap: 6 };
  return (
    <div style={wrap}>
      {ordered(displays).map((d, pos) => {
        const c = pickerItemColors(d.is_primary, d.index === current);
        return (
          <button
            key={d.index}
            onClick={() => onChange(d.index)}
            title={`Monitor ${pos + 1} (${d.width}×${d.height})${d.is_primary ? ' — Default' : ''}`}
            aria-label={`Monitor ${pos + 1} (${d.width}×${d.height})${d.is_primary ? ' — Default' : ''}`}
            style={{
              position: 'relative',
              width: 46,
              height: 38,
              padding: 0,
              cursor: 'pointer',
              background: c.background,
              border: `2px solid ${c.border}`,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* monitor glyph */}
            <svg width="26" height="22" viewBox="0 0 26 22" aria-hidden="true">
              <rect x="1" y="1" width="24" height="16" rx="2" fill="none" stroke={c.border} strokeWidth="1.5" />
              <rect x="9" y="18" width="8" height="2" rx="1" fill={c.border} />
            </svg>
            <span
              style={{
                position: 'absolute',
                top: 3,
                left: 0,
                right: 0,
                textAlign: 'center',
                fontSize: 11,
                fontWeight: 700,
                lineHeight: '16px',
                color: c.number,
                pointerEvents: 'none',
              }}
            >
              {pos + 1}
            </span>
            {c.showDefaultBadge && (
              <span
                style={{
                  position: 'absolute',
                  bottom: -4,
                  right: -4,
                  background: '#f59e0b',
                  color: '#1a1f29',
                  fontSize: 9,
                  fontWeight: 800,
                  borderRadius: 3,
                  padding: '0 3px',
                  lineHeight: '12px',
                }}
              >
                D
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
