import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from '../types';

interface Props {
  sessions: Session[];
  activeTab: string;
  onTabSelect: (tab: string) => void;
  onTabClose: (id: string) => void;
  onSettings: () => void;
}

export function TabBar({ sessions, activeTab, onTabSelect, onTabClose, onSettings }: Props) {
  const { t } = useTranslation('app');
  const tabStyle = (id: string): CSSProperties => ({
    background: 'none',
    border: 'none',
    borderBottom: activeTab === id ? '2px solid #26c6da' : '2px solid transparent',
    color: activeTab === id ? '#26c6da' : '#b3bdca',
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
        {t('app:tabbar.home')}
      </button>

      {sessions.map(s => (
        <div
          key={s.id}
          role="tab"
          tabIndex={0}
          onClick={() => onTabSelect(s.id)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onTabSelect(s.id); }}
          style={tabStyle(s.id)}
        >
          {s.id}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onTabClose(s.id); }}
            style={{ background: 'none', border: 'none', opacity: 0.5, fontSize: 14, lineHeight: 1, cursor: 'pointer', padding: 0 }}
            aria-label={t('app:tabbar.closeSession', { id: s.id })}
          >
            ×
          </button>
        </div>
      ))}

      <button
        style={{ background: 'none', border: 'none', color: '#93a0b2', fontSize: 11, padding: '8px 10px', cursor: 'default', opacity: 0.3 }}
        disabled
        title={t('app:tabbar.sessionsHint')}
      >
        +
      </button>

      <div style={{ flex: 1 }} />

      <button
        onClick={onSettings}
        style={{ background: 'none', border: 'none', color: '#93a0b2', cursor: 'pointer', fontSize: 16, padding: '4px 8px', flexShrink: 0 }}
        title={t('app:tabbar.settings')}
      >
        ⚙
      </button>
    </div>
  );
}
