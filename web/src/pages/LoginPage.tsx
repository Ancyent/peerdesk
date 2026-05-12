import { useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { ApiError } from '../api/client';
import { useBrandingContext } from '../branding/BrandingContext';

interface Props {
  onGoRegister: () => void;
}

export function LoginPage({ onGoRegister }: Props) {
  const { login } = useAuth();
  const { brand_name, logo_data_url } = useBrandingContext();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:16, fontFamily:'sans-serif' }}>
      {logo_data_url
        ? <img src={logo_data_url} alt={brand_name} style={{ height: 48, objectFit: 'contain', maxWidth: 200 }} />
        : <h1 style={{ margin:0 }}>{brand_name}</h1>
      }
      <p style={{ color:'#666', margin:0 }}>Sign in to your account</p>
      {error && <p style={{ color:'red', margin:0, fontSize:14 }}>{error}</p>}
      <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:12, width:300 }}>
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
          style={{ padding:'10px 12px', fontSize:15, borderRadius:6, border:'1px solid #ccc' }} required />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
          style={{ padding:'10px 12px', fontSize:15, borderRadius:6, border:'1px solid #ccc' }} required />
        <button type="submit" disabled={loading}
          style={{ padding:10, fontSize:15, borderRadius:6, background:'var(--accent)', color:'#fff', border:'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
      <p style={{ color:'#666', fontSize:14, margin:0 }}>
        No account?{' '}
        <button onClick={onGoRegister} style={{ background:'none', border:'none', color:'var(--accent)', cursor:'pointer', fontSize:14, padding:0 }}>
          Register
        </button>
      </p>
    </div>
  );
}
