interface ToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ value, onChange, disabled }: ToggleProps) {
  return (
    <div
      onClick={() => !disabled && onChange(!value)}
      style={{
        width: 34,
        height: 18,
        background: value ? '#26c6da' : '#21262d',
        borderRadius: 9,
        border: `1px solid ${value ? '#00acc1' : '#30363d'}`,
        cursor: disabled ? 'default' : 'pointer',
        position: 'relative',
        flexShrink: 0,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 12,
          height: 12,
          background: '#fff',
          borderRadius: '50%',
          top: 2,
          left: value ? 18 : 2,
          transition: 'left 0.15s',
        }}
      />
    </div>
  );
}
