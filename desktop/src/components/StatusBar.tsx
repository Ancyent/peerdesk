import { useTranslation } from 'react-i18next';

interface StatusBarProps {
  approvalStatus: 'pending' | 'approved' | 'denied' | 'standalone';
  serverUrl: string | null;
}

export function StatusBar({ approvalStatus, serverUrl }: StatusBarProps) {
  const { t } = useTranslation('app');
  const isPending = approvalStatus === 'pending';
  const isDenied = approvalStatus === 'denied';

  const text = isDenied
    ? t('app:statusbar.accessDenied')
    : isPending
      ? t('app:statusbar.pendingApproval')
      : serverUrl
        ? t('app:statusbar.connectedTo', { host: serverUrl.replace(/^https?:\/\//, '') })
        : t('app:statusbar.standalone');

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
