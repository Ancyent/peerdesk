import type { Session } from '../types';

interface Props {
  sessions: Session[];
  activeTab: string;
  onTabSelect: (tab: string) => void;
  onTabClose: (id: string) => void;
  onSettings: () => void;
}

export function TabBar({ sessions, activeTab, onTabSelect, onTabClose, onSettings }: Props) {
  const tabStyle = (id: string): React.CSSProperties => ({
    background: 'none',
    border: 'none',
    borderBottom: activeTab === id ? '2px solid #26c6da' : '2px solid transparent',
    color: activeTab === id ? '#26c6da' : '#8b949e',
    padding: '8px 14px',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  });

  return (
    <div style={{ background: '#161b22', padding: '0 8px', display: 'flex', alignItems: 'center', borderBottom: '1px solid #21262d', flexShrink: 0, overflowX: 'auto' }}>
      <button style={tabStyle('home')} onClick={() => onTabSelect('home')}>
        Home
      </button>

      {sessions.map(s => (
        <button key={s.id} style={tabStyle(s.id)} onClick={() => onTabSelect(s.id)}>
          {s.id}
          <span
            onClick={e => { e.stopPropagation(); onTabClose(s.id); }}
            style={{ opacity: 0.5, fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
            title="Close session"
          >
            ×
          </span>
        </button>
      ))}

      <button
        style={{ background: 'none', border: 'none', color: '#484f58', fontSize: 11, padding: '8px 10px', cursor: 'default', opacity: 0.3 }}
        disabled
        title="Sessions open from Home only"
      >
        +
      </button>

      <div style={{ flex: 1 }} />

      <button
        onClick={onSettings}
        style={{ background: 'none', border: 'none', color: '#484f58', cursor: 'pointer', fontSize: 16, padding: '4px 8px', flexShrink: 0 }}
        title="Settings"
      >
        ⚙
      </button>
    </div>
  );
}
