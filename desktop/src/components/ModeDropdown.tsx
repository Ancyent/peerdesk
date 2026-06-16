import { useState } from 'react';

type AccessMode = 'full' | 'view_only' | 'no_incoming';

interface ModeDropdownProps {
  value: AccessMode;
  onChange: (m: AccessMode) => void;
}

const MODES: { value: AccessMode; label: string; desc: string }[] = [
  { value: 'full', label: 'Full Access', desc: 'Remote users can control your device' },
  { value: 'view_only', label: 'View Only / Cast', desc: 'Screen sharing without control' },
  { value: 'no_incoming', label: 'No Incoming', desc: 'Reject all connections' },
];

export function ModeDropdown({ value, onChange }: ModeDropdownProps) {
  const [open, setOpen] = useState(false);
  const current = MODES.find((m) => m.value === value) ?? MODES[0];

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          background: '#21262d',
          border: '1px solid #30363d',
          borderRadius: 6,
          padding: '7px 12px',
          fontSize: 11,
          color: '#e6ebf1',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
        }}
      >
        {current.label}
        <span style={{ color: '#93a0b2', fontSize: 10 }}>{open ? '▴' : '▾'}</span>
      </div>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9 }}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 4,
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 8,
              overflow: 'hidden',
              zIndex: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,.5)',
            }}
          >
            {MODES.map((m) => (
              <div
                key={m.value}
                onClick={() => {
                  onChange(m.value);
                  setOpen(false);
                }}
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  background: m.value === value ? '#0a2a2e' : 'transparent',
                  borderLeft:
                    m.value === value ? '2px solid #26c6da' : '2px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (m.value !== value)
                    e.currentTarget.style.background = '#1c2128';
                }}
                onMouseLeave={(e) => {
                  if (m.value !== value)
                    e.currentTarget.style.background = 'transparent';
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: m.value === value ? '#26c6da' : '#e6ebf1',
                  }}
                >
                  {m.label}
                </div>
                <div style={{ fontSize: 10, color: '#93a0b2', marginTop: 2 }}>
                  {m.desc}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
