import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import {
  api, ApiError, type TeamMemberOut, type InvitationOut, type InvitationCreatedOut,
} from '../api/client';
import { localizeError } from '../api/errors';
import { copyText } from '../lib/clipboard';
import { MemberAccessEditor } from '../components/MemberAccessEditor';
import { formatDate } from '../i18n/format';
import { InlineError } from '@pd/ui';

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
  background: 'var(--bg-surface)', border: '1px solid var(--border-dim)', borderRadius: 8,
};
const smallBtn = (bg: string, color: string) => ({
  padding: '5px 10px', fontSize: 12, background: bg, color, border: `1px solid ${color}`,
  borderRadius: 6, cursor: 'pointer',
});
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '0 4px', color: 'var(--text-3)' };
const selectStyle = {
  padding: '5px 8px', fontSize: 12, border: '1px solid var(--border-dim)', borderRadius: 6,
  background: 'var(--bg-hover)', color: 'var(--text-1)',
};

export function TeamPage() {
  const { t } = useTranslation('team');
  const { accessToken } = useAuth();
  const [members, setMembers] = useState<TeamMemberOut[]>([]);
  const [invitations, setInvitations] = useState<InvitationOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [expandedAccess, setExpandedAccess] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);
  const [newInvite, setNewInvite] = useState<InvitationCreatedOut | null>(null);
  const [copied, setCopied] = useState(false);

  const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? localizeError(e) : fallback);

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [m, inv] = await Promise.all([
        api.team.members(accessToken),
        api.team.invitations(accessToken),
      ]);
      setMembers(m);
      setInvitations(inv);
    } catch (e) {
      // Real error surfacing (not console.error): a member who lands here at
      // all is an admin (App.tsx gates the route), so a failure here is a
      // real problem worth reading, not routine noise.
      setError(errorMessage(e, t('team:errors.loadFailed')));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRoleChange = async (membershipId: string, role: string) => {
    if (!accessToken) return;
    setError(null);
    try {
      const updated = await api.team.setRole(accessToken, membershipId, role);
      setMembers(prev => prev.map(m => (m.membership_id === membershipId ? updated : m)));
    } catch (e) {
      // The last-admin guard lives here: demoting the account's only admin
      // returns 400 with a message the user has to read.
      setError(errorMessage(e, t('team:errors.roleChangeFailed')));
    }
  };

  const handleRemove = async (membershipId: string) => {
    if (!accessToken) return;
    setError(null);
    try {
      await api.team.removeMember(accessToken, membershipId);
      setMembers(prev => prev.filter(m => m.membership_id !== membershipId));
    } catch (e) {
      // Same last-admin guard as above, on the delete path.
      setError(errorMessage(e, t('team:errors.removeFailed')));
    } finally {
      setConfirmDelete(null);
    }
  };

  const handleInvite = async () => {
    if (!accessToken) return;
    setError(null);
    setInviting(true);
    try {
      const created = await api.team.invite(accessToken, inviteEmail.trim() || null, inviteRole);
      setNewInvite(created);
      setInviteEmail('');
      setInviteRole('member');
      const inv = await api.team.invitations(accessToken).catch(() => null);
      if (inv) setInvitations(inv);
    } catch (e) {
      setError(errorMessage(e, t('team:errors.inviteFailed')));
    } finally {
      setInviting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!accessToken) return;
    setError(null);
    try {
      await api.team.revokeInvite(accessToken, id);
      setInvitations(prev => prev.filter(i => i.id !== id));
    } catch (e) {
      setError(errorMessage(e, t('team:errors.revokeFailed')));
    }
  };

  const handleCopy = async (text: string) => {
    if (!(await copyText(text))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inviteLink = newInvite ? `${window.location.origin}/invite/${newInvite.token}` : '';

  return (
    <div style={{ padding: '20px 24px', maxWidth: 760, background: 'var(--bg-base)', minHeight: '100%' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{t('team:title')}</h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-2)' }}>
        {t('team:subtitle')}
      </p>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          marginBottom: 20, padding: '10px 14px', background: 'var(--red-bg)',
          border: '1px solid var(--red)', borderRadius: 8,
        }}>
          <InlineError>{error}</InlineError>
          <button onClick={() => setError(null)} title={t('team:close')} aria-label={t('team:close')}
            style={{ ...iconBtn, color: 'var(--red)' }}>✕</button>
        </div>
      )}

      {/* Invite form */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, padding: 16, background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-dim)' }}>
        <input
          value={inviteEmail}
          onChange={e => setInviteEmail(e.target.value)}
          placeholder={t('team:invite.emailPlaceholder')}
          style={{ flex: 1, padding: '7px 12px', fontSize: 13, border: '1px solid var(--border-dim)', borderRadius: 6, background: 'var(--bg-hover)', color: 'var(--text-1)' }}
          onKeyDown={e => e.key === 'Enter' && handleInvite()}
        />
        <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'member')} style={selectStyle}>
          <option value="member">{t('team:role.member')}</option>
          <option value="admin">{t('team:role.admin')}</option>
        </select>
        <button
          onClick={handleInvite}
          disabled={inviting}
          style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent-2)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: inviting ? 0.5 : 1 }}
        >
          {inviting ? t('team:invite.submitting') : t('team:invite.submit')}
        </button>
      </div>

      {/* Newly created invitation — shown once, dismissible, never re-fetchable */}
      {newInvite && (
        <div style={{ marginBottom: 20, padding: 16, background: 'var(--green-bg)', border: '1px solid var(--green-glow)', borderRadius: 8 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
            {t('team:invite.created')}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              readOnly
              value={inviteLink}
              onFocus={e => e.currentTarget.select()}
              style={{ flex: 1, padding: '6px 10px', background: 'rgba(0,229,160,0.15)', border: 'none', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', color: 'var(--text-1)' }}
            />
            <button onClick={() => handleCopy(inviteLink)} style={{ padding: '6px 12px', fontSize: 12, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              {copied ? t('team:invite.copied') : t('team:invite.copy')}
            </button>
            <button onClick={() => setNewInvite(null)} style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-hover)', color: 'var(--text-2)', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              {t('team:invite.dismiss')}
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-2)' }}>
            {t('team:invite.oneTimeNotice')}
          </p>
        </div>
      )}

      {loading && <p style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('team:loading')}</p>}

      {/* Members */}
      {!loading && (
        <>
          <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {t('team:members.heading')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {members.map(m => (
              <div key={m.membership_id} style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{m.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                      {m.email} · {t('team:members.memberSince', { date: formatDate(m.created_at) })}
                    </div>
                  </div>
                  <select value={m.role} onChange={e => handleRoleChange(m.membership_id, e.target.value)} style={selectStyle}>
                    <option value="member">{t('team:role.member')}</option>
                    <option value="admin">{t('team:role.admin')}</option>
                  </select>
                  <button
                    onClick={() => setExpandedAccess(id => (id === m.membership_id ? null : m.membership_id))}
                    style={smallBtn('var(--bg-hover)', 'var(--text-2)')}
                  >
                    {t('team:members.access')}
                  </button>
                  {confirmDelete === m.membership_id ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                      <span style={{ color: 'var(--text-3)' }}>{t('team:members.deleteConfirm')}</span>
                      <button title={t('team:members.confirmRemove')} aria-label={t('team:members.confirmRemove')} style={{ ...iconBtn, color: 'var(--red)' }} onClick={() => handleRemove(m.membership_id)}>✓</button>
                      <button title={t('team:members.cancel')} aria-label={t('team:members.cancel')} style={iconBtn} onClick={() => setConfirmDelete(null)}>✕</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDelete(m.membership_id)} style={smallBtn('var(--red-bg)', 'var(--red)')}>
                      {t('team:members.remove')}
                    </button>
                  )}
                </div>
                {expandedAccess === m.membership_id && (
                  <div style={{
                    padding: '12px 16px', background: 'var(--bg-hover)', border: '1px solid var(--border-dim)',
                    borderTop: 'none', borderRadius: '0 0 8px 8px',
                  }}>
                    <MemberAccessEditor membershipId={m.membership_id} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pending invitations */}
          <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {t('team:invitations.heading')}
          </h3>
          {invitations.length === 0 ? (
            <div style={{ padding: 24, border: '1px dashed var(--border)', borderRadius: 8, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              {t('team:invitations.empty')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {invitations.map(inv => (
                <div key={inv.id} style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-1)' }}>
                      {inv.email ?? t('team:invitations.openLink')}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {inv.role === 'admin' ? t('team:role.admin') : t('team:role.member')} · {t('team:invitations.expires', { date: formatDate(inv.expires_at) })}
                    </div>
                  </div>
                  <button onClick={() => handleRevoke(inv.id)} style={smallBtn('var(--red-bg)', 'var(--red)')}>
                    {t('team:invitations.revoke')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
