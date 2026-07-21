import { useAuth } from '../auth/useAuth';

// Renders only when the user holds more than one membership — a
// single-account user should never learn this feature exists.
export function AccountSwitcher() {
  const { accounts, activeAccountId, switchAccount } = useAuth();

  if (accounts.length <= 1) return null;

  return (
    <select
      value={activeAccountId ?? ''}
      onChange={e => { void switchAccount(e.target.value); }}
      style={{
        width: '100%', padding: '6px 8px', fontSize: 12,
        background: 'var(--bg-surface)', color: 'var(--text-2)',
        border: '1px solid var(--border-dim)', borderRadius: 6,
        cursor: 'pointer', marginBottom: 8,
      }}
    >
      {accounts.map(a => (
        <option key={a.account_id} value={a.account_id}>{a.name}</option>
      ))}
    </select>
  );
}
