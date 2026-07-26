import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBrandingContext } from '../branding/BrandingContext';
import { InlineError } from '@pd/ui';

interface Props {
  onConnect: (peerId: string, password: string, remember: boolean) => void;
  error?: string;
  initialPeerId?: string;
  canSave?: boolean;
}

export function ConnectForm({ onConnect, error, initialPeerId, canSave }: Props) {
  const { t } = useTranslation('connect');
  const [peerId, setPeerId] = useState(initialPeerId ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);

  useEffect(() => { setPeerId(initialPeerId ?? ''); }, [initialPeerId]);
  const { brand_name, logo_data_url } = useBrandingContext();

  const inp: React.CSSProperties = {
    padding: '10px 14px', fontSize: 15,
    borderRadius: 8, border: '1px solid var(--border-dim)',
    background: 'var(--bg-hover)', color: 'var(--text-1)',
    width: '100%', boxSizing: 'border-box' as const,
    outline: 'none', transition: 'border-color 0.2s',
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh',
      background: 'var(--bg-base)', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-dim)',
        borderRadius: 16, padding: '36px 32px',
        width: 340, boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
      }}>
        {/* Logo / Brand */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          {logo_data_url
            ? <img src={logo_data_url} alt={brand_name} style={{ height: 40, objectFit: 'contain', maxWidth: 160 }} />
            : <div style={{
                fontSize: 22, fontWeight: 700,
                background: 'linear-gradient(90deg, #67e8c8, #7dd3fc)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>{brand_name || 'PeerDesk'}</div>
          }
          <p style={{ color: 'var(--text-3)', margin: '8px 0 0', fontSize: 13 }}>
            {t('connect:subtitle')}
          </p>
        </div>

        {error && (
          <div style={{
            marginBottom: 16, padding: '10px 14px',
            background: 'var(--red-bg)', border: '1px solid rgba(248,113,113,0.3)',
            borderRadius: 8,
          }}>
            <InlineError size={13}>{error}</InlineError>
          </div>
        )}

        <form onSubmit={e => { e.preventDefault(); onConnect(peerId, password, remember); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
              {t('connect:peerIdLabel')}
            </label>
            <input
              type="text"
              placeholder={t('connect:peerIdPlaceholder')}
              value={peerId}
              onChange={e => setPeerId(e.target.value.replace(/\D/g, '').slice(0, 9))}
              style={{ ...inp, fontSize: 20, letterSpacing: 6, textAlign: 'center', fontFamily: 'monospace' }}
              maxLength={9}
              required
              autoFocus
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
              {t('connect:passwordLabel')}
            </label>
            <input
              type="password"
              placeholder={t('connect:passwordPlaceholder')}
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={inp}
              required
            />
          </div>
          {canSave && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
              {t('connect:rememberPassword')}
            </label>
          )}
          <button
            type="submit"
            disabled={peerId.length !== 9}
            style={{
              padding: '11px', fontSize: 14, borderRadius: 9, border: 'none',
              background: peerId.length === 9
                ? 'linear-gradient(135deg, var(--accent), var(--accent-2))'
                : 'var(--bg-hover)',
              color: peerId.length === 9 ? 'var(--text-1)' : 'var(--text-3)',
              fontWeight: 700, cursor: peerId.length === 9 ? 'pointer' : 'not-allowed',
              boxShadow: peerId.length === 9 ? '0 2px 12px rgba(0,200,150,0.4)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            {peerId.length === 9 ? t('connect:connect') : t('connect:enterId')}
          </button>
        </form>
      </div>
    </div>
  );
}
