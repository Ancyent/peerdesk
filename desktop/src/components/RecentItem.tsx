interface RecentItemProps {
  name?: string;
  peerId: string;
  online?: boolean;
  onConnect: (peerId: string) => void;
}

export function RecentItem({ name, peerId, online = false, onConnect }: RecentItemProps) {
  const label = name ?? peerId.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  return (
    <div
      onClick={() => onConnect(peerId)}
      style={{
        background: '#21262d',
        borderRadius: 6,
        padding: '7px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 5,
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#2d333b')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '#21262d')}
    >
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          flexShrink: 0,
          background: online ? '#56d364' : '#484f58',
        }}
      />
      <div style={{ flex: 1, fontSize: 11, color: '#c9d1d9' }}>{label}</div>
      <div style={{ fontSize: 10, color: '#484f58', fontFamily: 'monospace' }}>
        {peerId.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')}
      </div>
    </div>
  );
}
