import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { localizeError } from '../api/errors';
import { useBrandingContext } from '../branding/BrandingContext';
import { InlineError } from '@pd/ui';

interface Props {
  onGoLogin: () => void;
}

export function RegisterPage({ onGoLogin }: Props) {
  const { t } = useTranslation('auth');
  const { register } = useAuth();
  const { brand_name, logo_data_url } = useBrandingContext();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(email, name, password, true);
    } catch (err) {
      setError(localizeError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', gap:16, fontFamily:'sans-serif' }}>
      {logo_data_url
        ? <img src={logo_data_url} alt={brand_name} style={{ height: 48, objectFit: 'contain', maxWidth: 200 }} />
        : <h1 style={{ margin:0, color:'var(--text-1)' }}>{brand_name}</h1>
      }
      <p style={{ color:'var(--text-2)', margin:0 }}>{t('auth:register.subtitle')}</p>
      <InlineError>{error}</InlineError>
      <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:12, width:300, background:'var(--bg-surface)', padding:24, borderRadius:10, border:'1px solid var(--border-dim)' }}>
        <input type="text" placeholder={t('auth:fields.fullName')} value={name} onChange={e => setName(e.target.value)}
          style={{ padding:'10px 12px', fontSize:15, borderRadius:6, border:'1px solid var(--border-dim)', background:'var(--bg-surface)', color:'var(--text-1)' }} required />
        <input type="email" placeholder={t('auth:fields.email')} value={email} onChange={e => setEmail(e.target.value)}
          style={{ padding:'10px 12px', fontSize:15, borderRadius:6, border:'1px solid var(--border-dim)', background:'var(--bg-surface)', color:'var(--text-1)' }} required />
        <input type="password" placeholder={t('auth:fields.passwordMin')} value={password} onChange={e => setPassword(e.target.value)}
          style={{ padding:'10px 12px', fontSize:15, borderRadius:6, border:'1px solid var(--border-dim)', background:'var(--bg-surface)', color:'var(--text-1)' }} minLength={8} required />
        <button type="submit" disabled={loading}
          style={{ padding:10, fontSize:15, borderRadius:6, background:'var(--accent)', color: 'var(--accent-ink)', border:'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? t('auth:register.submitting') : t('auth:register.submit')}
        </button>
      </form>
      <p style={{ color:'var(--text-2)', fontSize:14, margin:0 }}>
        {t('auth:register.haveAccount')}{' '}
        <button onClick={onGoLogin} style={{ background:'none', border:'none', color:'var(--accent)', cursor:'pointer', fontSize:14, padding:0 }}>
          {t('auth:register.signInLink')}
        </button>
      </p>
    </div>
  );
}
