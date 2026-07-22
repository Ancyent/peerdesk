import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { ApiError } from '../api/client';
import { useBrandingContext } from '../branding/BrandingContext';

interface Props {
  onGoRegister: () => void;
}

export function LoginPage({ onGoRegister }: Props) {
  const { t } = useTranslation('auth');
  const { login } = useAuth();
  const { brand_name, logo_data_url } = useBrandingContext();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password, remember);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth:login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', gap:16, fontFamily:'sans-serif', background:'var(--bg-base)' }}>
      {logo_data_url
        ? <img src={logo_data_url} alt={brand_name} style={{ height: 48, objectFit: 'contain', maxWidth: 200 }} />
        : <h1 style={{ margin:0, color:'var(--text-1)' }}>{brand_name}</h1>
      }
      <p style={{ color:'var(--text-2)', margin:0 }}>{t('auth:login.subtitle')}</p>
      {error && <p style={{ color:'var(--red)', margin:0, fontSize:14 }}>{error}</p>}
      <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:12, width:300, background:'var(--bg-surface)', padding:24, borderRadius:10, border:'1px solid var(--border-dim)' }}>
        <input type="email" placeholder={t('auth:fields.email')} value={email} onChange={e => setEmail(e.target.value)}
          style={{ padding:'10px 12px', fontSize:15, borderRadius:6, border:'1px solid var(--border-dim)', background:'var(--bg-surface)', color:'var(--text-1)' }} required />
        <input type="password" placeholder={t('auth:fields.password')} value={password} onChange={e => setPassword(e.target.value)}
          style={{ padding:'10px 12px', fontSize:15, borderRadius:6, border:'1px solid var(--border-dim)', background:'var(--bg-surface)', color:'var(--text-1)' }} required />
        <label style={{ display:'flex', alignItems:'center', gap:8, color:'var(--text-2)', fontSize:14, cursor:'pointer' }}>
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
          {t('auth:login.rememberMe')}
        </label>
        <button type="submit" disabled={loading}
          style={{ padding:10, fontSize:15, borderRadius:6, background:'var(--accent)', color:'#fff', border:'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? t('auth:login.submitting') : t('auth:login.submit')}
        </button>
      </form>
      <p style={{ color:'var(--text-2)', fontSize:14, margin:0 }}>
        {t('auth:login.noAccount')}{' '}
        <button onClick={onGoRegister} style={{ background:'none', border:'none', color:'var(--accent)', cursor:'pointer', fontSize:14, padding:0 }}>
          {t('auth:login.registerLink')}
        </button>
      </p>
    </div>
  );
}
