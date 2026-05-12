import { useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { ApiError } from '../api/client';

interface Props {
  onGoLogin: () => void;
}

export function RegisterPage({ onGoLogin }: Props) {
  const { register } = useAuth();
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
      await register(email, name, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:16, fontFamily:'sans-serif' }}>
      <h1 style={{ margin:0 }}>PeerDesk</h1>
      <p style={{ color:'#666', margin:0 }}>Create your account</p>
      {error && <p style={{ color:'red', margin:0, fontSize:14 }}>{error}</p>}
      <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:12, width:300 }}>
        <input type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)}
          style={{ padding:'10px 12px', fontSize:15, borderRadius:6, border:'1px solid #ccc' }} required />
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
          style={{ padding:'10px 12px', fontSize:15, borderRadius:6, border:'1px solid #ccc' }} required />
        <input type="password" placeholder="Password (min 8 chars)" value={password} onChange={e => setPassword(e.target.value)}
          style={{ padding:'10px 12px', fontSize:15, borderRadius:6, border:'1px solid #ccc' }} minLength={8} required />
        <button type="submit" disabled={loading}
          style={{ padding:10, fontSize:15, borderRadius:6, background:'#2563eb', color:'#fff', border:'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Creating account…' : 'Create Account'}
        </button>
      </form>
      <p style={{ color:'#666', fontSize:14, margin:0 }}>
        Already have an account?{' '}
        <button onClick={onGoLogin} style={{ background:'none', border:'none', color:'#2563eb', cursor:'pointer', fontSize:14, padding:0 }}>
          Sign in
        </button>
      </p>
    </div>
  );
}
