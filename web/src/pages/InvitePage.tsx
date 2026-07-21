import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { useBrandingContext } from '../branding/BrandingContext';

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
  padding: 10, fontSize: 15, borderRadius: 6, background: 'var(--accent)', color: '#fff',
  border: 'none', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1,
});

export function InvitePage({ token }: Props) {
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
      // invitations exist or who was invited -- shown as-is, untranslated.
      setError(err instanceof ApiError ? err.message : 'Invitația nu a putut fi acceptată');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', gap: 16, fontFamily: 'sans-serif', background: 'var(--bg-base)', padding: 16,
    }}>
      {logo_data_url
        ? <img src={logo_data_url} alt={brand_name} style={{ height: 48, objectFit: 'contain', maxWidth: 200 }} />
        : <h1 style={{ margin: 0, color: 'var(--text-1)' }}>{brand_name}</h1>}
      <p style={{ color: 'var(--text-2)', margin: 0, textAlign: 'center', maxWidth: 320 }}>
        Ai fost invitat într-un cont PeerDesk
      </p>

      {error && (
        <p style={{ color: 'var(--red)', margin: 0, fontSize: 14, maxWidth: 320, textAlign: 'center' }}>{error}</p>
      )}

      {user ? (
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)' }}>
            Ești autentificat ca <strong style={{ color: 'var(--text-1)' }}>{user.email}</strong>. Acceptă invitația
            pentru a te alătura contului.
          </p>
          <button onClick={() => accept()} disabled={busy} style={buttonStyle(busy)}>
            {busy ? 'Se acceptă…' : 'Acceptă invitația'}
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={accept} style={cardStyle}>
            <input type="text" placeholder="Nume complet" value={name} onChange={e => setName(e.target.value)}
              style={inputStyle} required />
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
              style={inputStyle} required />
            <input type="password" placeholder="Parolă (minim 8 caractere)" value={password}
              onChange={e => setPassword(e.target.value)} minLength={8} style={inputStyle} required />
            <button type="submit" disabled={busy} style={buttonStyle(busy)}>
              {busy ? 'Se creează contul…' : 'Creează cont și acceptă'}
            </button>
          </form>
          <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0, maxWidth: 300, textAlign: 'center' }}>
            Ai deja un cont PeerDesk cu acest email?{' '}
            <button onClick={() => { window.location.href = '/login'; }}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline' }}>
              Autentifică-te
            </button>{' '}
            și deschide din nou acest link — invitația se aplică automat contului tău.
          </p>
        </>
      )}
    </div>
  );
}
