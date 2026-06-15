interface StatusBarProps {
  approvalStatus: 'pending' | 'approved' | 'denied' | 'standalone';
  serverUrl: string | null;
}

export function StatusBar({ approvalStatus, serverUrl }: StatusBarProps) {
  const isPending = approvalStatus === 'pending';
  const isDenied = approvalStatus === 'denied';

  const text = isDenied
    ? '⛔ Access denied — your device was rejected by the admin'
    : isPending
      ? '⏳ Pending admin approval — check your dashboard'
      : serverUrl
        ? `Connected to ${serverUrl.replace(/^https?:\/\//, '')}`
        : 'Running in standalone mode';

  const background = isDenied
    ? '#5c1010'
    : isPending
      ? '#7c3a00'
      : 'linear-gradient(90deg, #005f63, #00838f)';

  const color = isDenied ? '#fca5a5' : isPending ? '#fed7aa' : '#b2ebf2';
  const dot = isDenied ? '#f85149' : isPending ? '#fb923c' : '#26c6da';

  return (
    <div
      style={{
        background,
        padding: '4px 16px',
        fontSize: 10,
        color,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          background: dot,
          borderRadius: '50%',
          flexShrink: 0,
          animation: !isPending && !isDenied ? 'pulsedot 2s infinite' : undefined,
        }}
      />
      {text}
      <style>{`@keyframes pulsedot{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}
