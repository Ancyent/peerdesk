import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { api } from '../api/client';
import { localizeError } from '../api/errors';
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from '../i18n/languages';

// Defined at module level — NOT inside SettingsPage — to avoid focus loss on re-render
const inp: CSSProperties = {
  padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-dim)',
  borderRadius: 6, width: '100%', boxSizing: 'border-box',
  background: 'var(--bg-hover)', color: 'var(--text-1)',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border-dim)', borderRadius: 10, padding: 20, marginBottom: 16, background: 'var(--bg-surface)' }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{title}</h3>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const { t, i18n } = useTranslation(['settings', 'common']);
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
      setProfileMsg(t('settings:profile.saved')); setTimeout(() => setProfileMsg(''), 2500);
    } catch (e) { setProfileErr(localizeError(e)); }
  };

  const changePw = async () => {
    if (!accessToken) return;
    setPwMsg(''); setPwErr('');
    if (newPw !== confPw) { setPwErr(t('settings:password.mismatch')); return; }
    if (newPw.length < 8) { setPwErr(t('settings:password.tooShort')); return; }
    try {
      await api.users.changePassword(accessToken, curPw, newPw);
      setPwMsg(t('settings:password.changed')); setCurPw(''); setNewPw(''); setConfPw('');
      setTimeout(() => setPwMsg(''), 2500);
    } catch (e) { setPwErr(localizeError(e)); }
  };

  return (
    <div style={{ padding: '24px', maxWidth: 500, background: 'var(--bg-base)', minHeight: '100%' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{t('settings:title')}</h2>
      <Section title={t('settings:language.title')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{t('settings:language.label')}</label>
            <select
              style={inp}
              value={i18n.language.split('-')[0]}
              onChange={e => {
                const value = e.target.value;
                i18n.changeLanguage(value);
                if (accessToken) api.users.update(accessToken, { language: value }).catch(() => {});
              }}
            >
              {SUPPORTED_LANGUAGES.map(lng => (
                <option key={lng} value={lng}>{LANGUAGE_NAMES[lng]}</option>
              ))}
            </select>
          </div>
        </div>
      </Section>
      <Section title={t('settings:profile.title')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{t('settings:profile.name')}</label><input style={inp} value={name} onChange={e => setName(e.target.value)} /></div>
          <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{t('settings:profile.email')}</label><input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
          {profileErr && <p style={{ color: 'var(--red)', fontSize: 12, margin: 0 }}>{profileErr}</p>}
          {profileMsg && <p style={{ color: 'var(--green)', fontSize: 12, margin: 0 }}>{profileMsg}</p>}
          <button onClick={saveProfile} style={{ padding: 8, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>{t('common:save')}</button>
        </div>
      </Section>
      <Section title={t('settings:password.title')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{t('settings:password.current')}</label><input style={inp} type="password" value={curPw} onChange={e => setCurPw(e.target.value)} /></div>
          <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{t('settings:password.new')}</label><input style={inp} type="password" value={newPw} onChange={e => setNewPw(e.target.value)} /></div>
          <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{t('settings:password.confirm')}</label><input style={inp} type="password" value={confPw} onChange={e => setConfPw(e.target.value)} /></div>
          {pwErr && <p style={{ color: 'var(--red)', fontSize: 12, margin: 0 }}>{pwErr}</p>}
          {pwMsg && <p style={{ color: 'var(--green)', fontSize: 12, margin: 0 }}>{pwMsg}</p>}
          <button onClick={changePw} style={{ padding: 8, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>{t('settings:password.submit')}</button>
        </div>
      </Section>
    </div>
  );
}
