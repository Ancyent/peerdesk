import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';
import { api, ApiError } from '../api/client';

export function SettingsPage() {
  const { user, accessToken } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');
  const [pwErr, setPwErr] = useState('');

  const saveProfile = async () => {
    if (!accessToken) return;
    setProfileMsg(''); setProfileErr('');
    try {
      await api.users.update(accessToken, { name, email });
      setProfileMsg('Salvat!'); setTimeout(() => setProfileMsg(''), 2500);
    } catch (e) { setProfileErr(e instanceof ApiError ? e.message : 'Eroare'); }
  };

  const changePw = async () => {
    if (!accessToken) return;
    setPwMsg(''); setPwErr('');
    if (newPw !== confPw) { setPwErr('Parolele nu coincid'); return; }
    if (newPw.length < 8) { setPwErr('Minim 8 caractere'); return; }
    try {
      await api.users.changePassword(accessToken, curPw, newPw);
      setPwMsg('Parolă schimbată!'); setCurPw(''); setNewPw(''); setConfPw('');
      setTimeout(() => setPwMsg(''), 2500);
    } catch (e) { setPwErr(e instanceof ApiError ? e.message : 'Eroare'); }
  };

  const inp: CSSProperties = { padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-dim)', borderRadius: 6, width: '100%', boxSizing: 'border-box', background: 'var(--bg-hover)', color: 'var(--text-1)' };

  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <div style={{ border: '1px solid var(--border-dim)', borderRadius: 10, padding: 20, marginBottom: 16, background: 'var(--bg-surface)' }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{title}</h3>
      {children}
    </div>
  );

  return (
    <div style={{ padding: '24px', maxWidth: 500, background: 'var(--bg-base)', minHeight: '100%' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>Setări</h2>
      <Section title="Profil">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Nume</label><input style={inp} value={name} onChange={e => setName(e.target.value)} /></div>
          <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Email</label><input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
          {profileErr && <p style={{ color: 'var(--red)', fontSize: 12, margin: 0 }}>{profileErr}</p>}
          {profileMsg && <p style={{ color: 'var(--green)', fontSize: 12, margin: 0 }}>{profileMsg}</p>}
          <button onClick={saveProfile} style={{ padding: 8, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Salvează</button>
        </div>
      </Section>
      <Section title="Schimbă parola">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Parola curentă</label><input style={inp} type="password" value={curPw} onChange={e => setCurPw(e.target.value)} /></div>
          <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Parola nouă</label><input style={inp} type="password" value={newPw} onChange={e => setNewPw(e.target.value)} /></div>
          <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Confirmă</label><input style={inp} type="password" value={confPw} onChange={e => setConfPw(e.target.value)} /></div>
          {pwErr && <p style={{ color: 'var(--red)', fontSize: 12, margin: 0 }}>{pwErr}</p>}
          {pwMsg && <p style={{ color: 'var(--green)', fontSize: 12, margin: 0 }}>{pwMsg}</p>}
          <button onClick={changePw} style={{ padding: 8, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Schimbă parola</button>
        </div>
      </Section>
    </div>
  );
}
