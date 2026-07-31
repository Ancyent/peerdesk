import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { localizeError } from '../api/errors';
import { useAuth } from '../auth/useAuth';
import { useBrandingContext } from '../branding/BrandingContext';
import { InlineError } from '@pd/ui';

interface Props {
  token: string;
}

const inputStyle = {
  padding: '10px 12px', fontSize: 15, borderRadius: 6,
  border: '1px solid var(--border-dim)', background: 'var(--bg-surface)', color: 'var(--text-1)',
};

const cardStyle = {
  display: 'flex' as const, flexDirection: 'column' as const, gap: 12, width: 300,
  background: 'var(--bg-surface)', padding: 24, borderRadius: 10, border: '1px solid var(--border-dim)',
};

const buttonStyle = (busy: boolean) => ({
  padding: 10, fontSize: 15, borderRadius: 6, background: 'var(--accent)', color: 'var(--accent-ink)',
  border: 'none', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1,
});

export function InvitePage({ token }: Props) {
  const { t } = useTranslation('invite');
  const { user, accessToken, applyTokens } = useAuth();
  const { brand_name, logo_data_url } = useBrandingContext();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accept = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Signed in: the membership attaches to the caller and the body's
      // email is ignored server-side -- send the access token so the server
      // recognizes them as authenticated rather than treating this as a
      // brand-new registration. Signed out: this is registration-only, see
      // the notice rendered below the form.
      const res = user
        ? await api.auth.acceptInvite({ token, email: user.email }, accessToken ?? undefined)
        : await api.auth.acceptInvite({ token, email, name, password });
      await applyTokens(res.access_token, res.refresh_token, true);
      window.location.href = '/machines';
    } catch (err) {
      // The server returns one message for expired, already-used, forged,
      // and email-mismatched invitations, so it is not an oracle for which
      // invitations exist or who was invited -- localized like any other
      // known server message (translating it adds no information the raw
      // English text didn't already carry).
      setError(localizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', gap: 16, fontFamily: 'sans-serif', padding: 16,
    }}>
      {logo_data_url
        ? <img src={logo_data_url} alt={brand_name} style={{ height: 48, objectFit: 'contain', maxWidth: 200 }} />
        : <h1 style={{ margin: 0, color: 'var(--text-1)' }}>{brand_name}</h1>}
      <p style={{ color: 'var(--text-2)', margin: 0, textAlign: 'center', maxWidth: 320 }}>
        {t('invite:subtitle')}
      </p>

      {error && (
        <div style={{ maxWidth: 320, textAlign: 'center' }}>
          <InlineError>{error}</InlineError>
        </div>
      )}

      {user ? (
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)' }}>
            {t('invite:signedInAsPrefix')} <strong style={{ color: 'var(--text-1)' }}>{user.email}</strong>
            {t('invite:signedInAsSuffix')}
          </p>
          <button onClick={() => accept()} disabled={busy} style={buttonStyle(busy)}>
            {busy ? t('invite:accept.submitting') : t('invite:accept.submit')}
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={accept} style={cardStyle}>
            <input type="text" placeholder={t('invite:fields.fullName')} value={name} onChange={e => setName(e.target.value)}
              style={inputStyle} required />
            <input type="email" placeholder={t('invite:fields.email')} value={email} onChange={e => setEmail(e.target.value)}
              style={inputStyle} required />
            <input type="password" placeholder={t('invite:fields.passwordMin')} value={password}
              onChange={e => setPassword(e.target.value)} minLength={8} style={inputStyle} required />
            <button type="submit" disabled={busy} style={buttonStyle(busy)}>
              {busy ? t('invite:form.submitting') : t('invite:form.submit')}
            </button>
          </form>
          <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0, maxWidth: 300, textAlign: 'center' }}>
            {t('invite:haveAccountPrefix')}{' '}
            <button onClick={() => { window.location.href = '/login'; }}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline' }}>
              {t('invite:signInLink')}
            </button>{' '}
            {t('invite:reopenLink')}
          </p>
        </>
      )}
    </div>
  );
}
