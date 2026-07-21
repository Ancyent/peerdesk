import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';
import { useBrandingContext } from '../branding/BrandingContext';
import { AccountSwitcher } from './AccountSwitcher';

export type AppPage = 'machines' | 'organization' | 'api-keys' | 'downloads' | 'branding' | 'settings' | 'team';

interface Props {
  page: AppPage;
  onNavigate: (page: AppPage) => void;
  contextPanel?: ReactNode;
  children: ReactNode;
}

const NAV: { page: AppPage; icon: string; label: string }[] = [
  { page: 'machines',      icon: '💻', label: 'Mașini' },
  { page: 'organization',  icon: '🏢', label: 'Organizare' },
  { page: 'api-keys',      icon: '🔑', label: 'API Keys' },
  { page: 'downloads',     icon: '📦', label: 'Download & Deploy' },
  { page: 'settings',      icon: '⚙️', label: 'Setări' },
];

const ADMIN: { page: AppPage; icon: string; label: string }[] = [
  { page: 'branding', icon: '🎨', label: 'Branding' },
  { page: 'team',     icon: '👥', label: 'Echipă' },
];

export function AppShell({ page, onNavigate, contextPanel, children }: Props) {
  const { user, logout, role } = useAuth();
  const isAdmin = role === 'admin';
  const { brand_name, logo_data_url } = useBrandingContext();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { localStorage.setItem('sidebar-collapsed', String(collapsed)); }, [collapsed]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const navItem = (p: AppPage, icon: string, label: string) => {
    const active = page === p;
    return (
      <div key={p} onClick={() => onNavigate(p)} style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
        position: 'relative', overflow: 'hidden',
        background: active ? 'var(--bg-active)' : 'transparent',
        transition: 'background 0.18s',
      }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        <div style={{
          position: 'absolute', left: 0, top: '22%', bottom: '22%', width: 3,
          borderRadius: '0 3px 3px 0',
          background: 'linear-gradient(180deg, var(--accent), var(--accent-2))',
          opacity: active ? 1 : 0, transition: 'opacity 0.18s',
        }} />
        <span style={{ fontSize: 17, width: 22, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
        <span style={{
          fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
          color: active ? 'var(--text-1)' : 'var(--text-2)',
          opacity: collapsed ? 0 : 1,
          transform: collapsed ? 'translateX(-8px)' : 'translateX(0)',
          transition: 'opacity 0.2s, transform 0.3s, color 0.18s',
        }}>{label}</span>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'system-ui, sans-serif', background: 'var(--bg-base)' }}>
      {/* Sidebar wrapper — overflow:visible so toggle isn't clipped */}
      <div style={{ width: collapsed ? 64 : 220, flexShrink: 0, position: 'relative', transition: 'width 0.35s cubic-bezier(0.4,0,0.2,1)' }}>
        {/* Toggle button outside overflow:hidden */}
        <button onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Extinde bara laterală' : 'Restrânge bara laterală'} aria-label={collapsed ? 'Extinde bara laterală' : 'Restrânge bara laterală'} style={{
          position: 'absolute', top: 19, right: -13, zIndex: 30,
          width: 26, height: 26, borderRadius: '50%',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          color: 'var(--accent)', fontSize: 9, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.2s',
        }}>{collapsed ? '▶' : '◀'}</button>
        {/* Inner sidebar with overflow:hidden to clip labels */}
        <div style={{
          width: '100%', height: '100%',
          background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-dim)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '4px 0 24px rgba(0,0,0,0.2)',
        }}>

        {/* Logo */}
        <div style={{ padding: '18px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border-dim)', minHeight: 64 }}>
          <div style={{
            width: 34, height: 34, flexShrink: 0, borderRadius: 10,
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, boxShadow: '0 0 22px rgba(0,200,150,0.45)',
          }}>
            {logo_data_url
              ? <img src={logo_data_url} alt={brand_name} style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 4 }} />
              : '🖥'}
          </div>
          <span style={{
            fontSize: 16, fontWeight: 700, letterSpacing: -0.3, whiteSpace: 'nowrap',
            background: 'linear-gradient(90deg, #67e8c8, #7dd3fc)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            opacity: collapsed ? 0 : 1,
            transform: collapsed ? 'translateX(-12px)' : 'translateX(0)',
            transition: 'opacity 0.2s, transform 0.3s',
          }}>{brand_name || 'PeerDesk'}</span>
        </div>

        {/* Account switcher — only rendered above one membership */}
        <div style={{ padding: '10px 8px 0' }}>
          <AccountSwitcher />
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {NAV.map(n => navItem(n.page, n.icon, n.label))}
          {isAdmin && <div style={{ height: 1, background: 'var(--border-dim)', margin: '8px 0' }} />}
          {isAdmin && ADMIN.map(n => navItem(n.page, n.icon, n.label))}
        </nav>

        {/* Avatar */}
        <div style={{ padding: '10px 8px', borderTop: '1px solid var(--border-dim)' }}>
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <div onClick={() => setDropdownOpen(o => !o)} style={{
              display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden', whiteSpace: 'nowrap',
              padding: '8px 12px', borderRadius: 10, cursor: 'pointer', transition: 'background 0.18s',
            }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
            >
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 13, color: '#111',
                boxShadow: '0 0 12px rgba(0,200,150,0.4)',
              }}>{user?.name?.[0]?.toUpperCase() ?? 'U'}</div>
              <div style={{ opacity: collapsed ? 0 : 1, transform: collapsed ? 'translateX(-8px)' : 'translateX(0)', transition: 'opacity 0.2s, transform 0.3s' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{user?.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{user?.email}</div>
              </div>
            </div>
            {dropdownOpen && (
              <div style={{
                position: 'absolute', bottom: 44, left: collapsed ? 48 : 12,
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 10, minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                zIndex: 100, animation: 'slide-in 0.15s ease',
              }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-dim)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{user?.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{user?.email}</div>
                </div>
                <button onClick={() => { setDropdownOpen(false); onNavigate('settings'); }} style={{ width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-2)' }}>⚙️ Setări</button>
                <button onClick={logout} style={{ width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--red)', borderTop: '1px solid var(--border-dim)' }}>Logout</button>
              </div>
            )}
          </div>
        </div>
        </div>{/* end inner sidebar */}
      </div>{/* end sidebar wrapper */}

      {/* Context panel */}
      {contextPanel && (
        <div style={{ width: 210, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1px solid var(--border-dim)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {contextPanel}
        </div>
      )}

      {/* Main */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg-base)' }}>
        {children}
      </div>
    </div>
  );
}
