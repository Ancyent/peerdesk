import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  api, ApiError, type TeamMemberOut, type InvitationOut, type InvitationCreatedOut,
} from '../api/client';
import { copyText } from '../lib/clipboard';
import { MemberAccessEditor } from '../components/MemberAccessEditor';

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

  const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

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
      setError(errorMessage(e, 'Nu am putut încărca echipa'));
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
      setError(errorMessage(e, 'Nu am putut schimba rolul'));
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
      setError(errorMessage(e, 'Nu am putut elimina membrul'));
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
      setError(errorMessage(e, 'Nu am putut crea invitația'));
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
      setError(errorMessage(e, 'Nu am putut revoca invitația'));
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
      <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>Echipă</h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-2)' }}>
        Membrii contului, rolurile lor și invitațiile în așteptare.
      </p>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          marginBottom: 20, padding: '10px 14px', background: 'var(--red-bg)',
          border: '1px solid var(--red)', borderRadius: 8,
        }}>
          <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>
          <button onClick={() => setError(null)} title="Închide" aria-label="Închide"
            style={{ ...iconBtn, color: 'var(--red)' }}>✕</button>
        </div>
      )}

      {/* Invite form */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, padding: 16, background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-dim)' }}>
        <input
          value={inviteEmail}
          onChange={e => setInviteEmail(e.target.value)}
          placeholder="Email (opțional — lasă gol pentru un link pe care îl poate folosi oricine)"
          style={{ flex: 1, padding: '7px 12px', fontSize: 13, border: '1px solid var(--border-dim)', borderRadius: 6, background: 'var(--bg-hover)', color: 'var(--text-1)' }}
          onKeyDown={e => e.key === 'Enter' && handleInvite()}
        />
        <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'member')} style={selectStyle}>
          <option value="member">Membru</option>
          <option value="admin">Admin</option>
        </select>
        <button
          onClick={handleInvite}
          disabled={inviting}
          style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent-2)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: inviting ? 0.5 : 1 }}
        >
          {inviting ? 'Se creează...' : 'Invită'}
        </button>
      </div>

      {/* Newly created invitation — shown once, dismissible, never re-fetchable */}
      {newInvite && (
        <div style={{ marginBottom: 20, padding: 16, background: 'var(--green-bg)', border: '1px solid var(--green-glow)', borderRadius: 8 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
            ✓ Invitație creată — copiază linkul acum, nu va mai fi afișat din nou.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              readOnly
              value={inviteLink}
              onFocus={e => e.currentTarget.select()}
              style={{ flex: 1, padding: '6px 10px', background: 'rgba(0,229,160,0.15)', border: 'none', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', color: 'var(--text-1)' }}
            />
            <button onClick={() => handleCopy(inviteLink)} style={{ padding: '6px 12px', fontSize: 12, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              {copied ? 'Copiat!' : 'Copiază'}
            </button>
            <button onClick={() => setNewInvite(null)} style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-hover)', color: 'var(--text-2)', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              Renunță
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-2)' }}>
            Linkul se afișează o singură dată.
          </p>
        </div>
      )}

      {loading && <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Se încarcă...</p>}

      {/* Members */}
      {!loading && (
        <>
          <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Membri
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {members.map(m => (
              <div key={m.membership_id} style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{m.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                      {m.email} · membru din {new Date(m.created_at).toLocaleDateString('ro-RO')}
                    </div>
                  </div>
                  <select value={m.role} onChange={e => handleRoleChange(m.membership_id, e.target.value)} style={selectStyle}>
                    <option value="member">Membru</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() => setExpandedAccess(id => (id === m.membership_id ? null : m.membership_id))}
                    style={smallBtn('var(--bg-hover)', 'var(--text-2)')}
                  >
                    Acces
                  </button>
                  {confirmDelete === m.membership_id ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                      <span style={{ color: 'var(--text-3)' }}>Șterge?</span>
                      <button title="Confirmă eliminarea" aria-label="Confirmă eliminarea" style={{ ...iconBtn, color: 'var(--red)' }} onClick={() => handleRemove(m.membership_id)}>✓</button>
                      <button title="Anulează" aria-label="Anulează" style={iconBtn} onClick={() => setConfirmDelete(null)}>✕</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDelete(m.membership_id)} style={smallBtn('var(--red-bg)', 'var(--red)')}>
                      Elimină
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
            Invitații în așteptare
          </h3>
          {invitations.length === 0 ? (
            <div style={{ padding: 24, border: '1px dashed var(--border)', borderRadius: 8, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              Nicio invitație în așteptare.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {invitations.map(inv => (
                <div key={inv.id} style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-1)' }}>
                      {inv.email ?? 'Link deschis — poate fi folosit de oricine'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {inv.role === 'admin' ? 'Admin' : 'Membru'} · expiră {new Date(inv.expires_at).toLocaleDateString('ro-RO')}
                    </div>
                  </div>
                  <button onClick={() => handleRevoke(inv.id)} style={smallBtn('var(--red-bg)', 'var(--red)')}>
                    Revocă
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
