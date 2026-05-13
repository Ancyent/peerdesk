import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';
import { useBrandingContext } from '../branding/BrandingContext';

export type AppPage = 'machines' | 'organization' | 'agent-install' | 'api-keys' | 'downloads' | 'branding' | 'settings';

interface Props {
  page: AppPage;
  onNavigate: (page: AppPage) => void;
  contextPanel?: ReactNode;
  children: ReactNode;
}

const NAV: { page: AppPage; icon: string; label: string }[] = [
  { page: 'machines',      icon: '💻', label: 'Mașini' },
  { page: 'organization',  icon: '🏢', label: 'Organizare' },
  { page: 'agent-install', icon: '⬇️', label: 'Instalare Agent' },
  { page: 'api-keys',      icon: '🔑', label: 'API Keys' },
  { page: 'downloads',     icon: '📦', label: 'Download' },
];

const ADMIN: { page: AppPage; icon: string; label: string }[] = [
  { page: 'branding',  icon: '🎨', label: 'Branding' },
  { page: 'settings',  icon: '⚙️', label: 'Setări' },
];

export function AppShell({ page, onNavigate, contextPanel, children }: Props) {
  const { user, logout } = useAuth();
  const { brand_name, logo_data_url } = useBrandingContext();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const iconBtn = (p: AppPage, icon: string, label: string) => (
    <button
      key={p}
      title={label}
      onClick={() => onNavigate(p)}
      style={{
        width: 40, height: 40, borderRadius: 8, border: 'none', cursor: 'pointer',
        background: page === p ? '#1e3a5f' : 'transparent',
        color: page === p ? '#60a5fa' : '#94a3b8',
        fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {icon}
    </button>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
      {/* Icon bar */}
      <div style={{ width: 56, background: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 4, flexShrink: 0 }}>
        <div style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => onNavigate('machines')}>
          {logo_data_url
            ? <img src={logo_data_url} alt={brand_name} style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4 }} />
            : <span style={{ color: '#fff', fontSize: 20 }}>🖥</span>
          }
        </div>
        {NAV.map(n => iconBtn(n.page, n.icon, n.label))}
        <div style={{ flex: 1 }} />
        {ADMIN.map(n => iconBtn(n.page, n.icon, n.label))}
        {/* Avatar dropdown */}
        <div ref={dropdownRef} style={{ position: 'relative', marginTop: 8 }}>
          <button
            onClick={() => setDropdownOpen(o => !o)}
            style={{ width: 32, height: 32, borderRadius: '50%', background: '#3b82f6', border: 'none', cursor: 'pointer', color: '#fff', fontWeight: 600, fontSize: 12 }}
          >
            {user?.name?.[0]?.toUpperCase() ?? 'U'}
          </button>
          {dropdownOpen && (
            <div style={{ position: 'absolute', bottom: 40, left: 44, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, minWidth: 160, boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 100 }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.name}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{user?.email}</div>
              </div>
              <button onClick={() => { setDropdownOpen(false); onNavigate('settings'); }}
                style={{ width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#475569' }}>
                ⚙️ Setări
              </button>
              <button onClick={logout}
                style={{ width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#dc2626', borderTop: '1px solid #e2e8f0' }}>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Context panel (shown only when provided) */}
      {contextPanel && (
        <div style={{ width: 210, background: '#f8fafc', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
          {contextPanel}
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
        {children}
      </div>
    </div>
  );
}
