export type Quality = 'auto' | 'high' | 'medium' | 'low';

const LABELS: Record<Quality, string> = {
  auto: 'Auto',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

interface Props {
  value: Quality;
  onChange: (value: Quality) => void;
}

export function QualitySelector({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as Quality)}
      style={{
        background: '#21262d',
        border: '1px solid #30363d',
        color: '#8b949e',
        fontSize: 11,
        padding: '3px 8px',
        borderRadius: 4,
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      {(Object.keys(LABELS) as Quality[]).map(q => (
        <option key={q} value={q}>{LABELS[q]}</option>
      ))}
    </select>
  );
}
