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
}

export function DisplaySelector({ displays, current, onChange }: Props) {
  if (displays.length <= 1) return null;
  return (
    <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 5 }}>
      <select
        value={current}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          padding: '4px 10px', borderRadius: 4,
          background: 'rgba(0,0,0,0.7)', color: '#fff',
          border: '1px solid rgba(255,255,255,0.2)',
          cursor: 'pointer', fontSize: 12,
        }}
      >
        {displays.map(d => (
          <option key={d.index} value={d.index}>
            Monitor {d.index + 1} ({d.width}×{d.height}){d.is_primary ? ' ★' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
