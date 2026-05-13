interface StatusBarProps {
  approvalStatus: string;
  serverUrl: string | null;
}

export function StatusBar({ approvalStatus, serverUrl }: StatusBarProps) {
  const isPending = approvalStatus === 'pending';
  const text = isPending
    ? '⏳ Pending admin approval — check your dashboard'
    : serverUrl
      ? `Connected to ${serverUrl.replace(/^https?:\/\//, '')}`
      : 'Running in standalone mode';

  return (
    <div
      style={{
        background: isPending
          ? '#7c3a00'
          : 'linear-gradient(90deg, #005f63, #00838f)',
        padding: '4px 16px',
        fontSize: 10,
        color: isPending ? '#fed7aa' : '#b2ebf2',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          background: isPending ? '#fb923c' : '#26c6da',
          borderRadius: '50%',
          flexShrink: 0,
          animation: !isPending ? 'pulsedot 2s infinite' : undefined,
        }}
      />
      {text}
      <style>{`@keyframes pulsedot{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}
