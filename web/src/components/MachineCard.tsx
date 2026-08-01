import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, styleOnce, surfaceStyle } from '@pd/ui';
import type { MachineOut } from '../api/client';
import { pathFor, isPlainLeftClick } from '../routing/paths';

/* Hover moved out of onMouseEnter/onMouseLeave handlers and into a real :hover
 * rule. The imperative version wrote inline styles and then cleared them to '',
 * which meant hover state could survive a re-render, and it had to repeat the
 * colour logic in two places. */
const CSS = `
[data-pd-machine] {
  overflow: hidden;
  cursor: pointer;
  padding: 0;
  transition: transform 180ms ease-out, border-color 180ms ease-out;
}
[data-pd-machine]:hover { transform: translateY(-3px); border-color: var(--border); }
[data-pd-machine][data-offline='1'] { opacity: 0.55; }

@media (prefers-reduced-motion: reduce) {
  [data-pd-machine] { transition: border-color 180ms ease-out; }
  [data-pd-machine]:hover { transform: none; }
  [data-pd-scan] { animation: none; }
}
`;

interface Props {
  machine: MachineOut;
  onConnect: (machine: MachineOut) => void;
  onDelete?: (id: string) => void;
  onForget?: (machine: MachineOut) => void;
}

function getOsIcon(os: string | null): string {
  const s = os?.toLowerCase() ?? '';
  if (s.includes('windows')) return '🪟';
  if (s.includes('mac')) return '🍎';
  return '🐧';
}

function formatLastSeen(ts: string | null, t: TFunction): string {
  if (!ts) return '';
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return t('machines:card.justNow');
  if (m < 60) return t('machines:card.minutesShort', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('machines:card.hoursShort', { n: h });
  return t('machines:card.daysShort', { n: Math.floor(h / 24) });
}

export function MachineCard({ machine: m, onConnect, onDelete, onForget }: Props) {
  const { t } = useTranslation('machines');
  styleOnce('pd-machine-card', CSS);

  const icon = getOsIcon(m.os);
  const online = m.is_online;
  const saved = m.has_saved_password;

  return (
    <div data-pd-machine data-offline={online ? undefined : '1'} style={surfaceStyle('card')}>
      {/* Thumbnail. The gradient was three hardcoded navy pairs, one per OS,
          which stayed dark in the light theme; it reads off tokens now. */}
      <div style={{ height: 110, position: 'relative', overflow: 'hidden', background: 'var(--bg-raised)' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 46, opacity: 0.15 }}>{icon}</div>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 30%, var(--bg-surface) 100%)' }} />
        {online && (
          <div data-pd-scan style={{ position: 'absolute', left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', animation: 'scan-line 4s linear infinite' }} />
        )}
        <div style={{
          position: 'absolute', top: 10, left: 12, borderRadius: 20, padding: '3px 10px',
          fontSize: 10, fontWeight: 600, color: 'var(--text-2)',
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--chrome-bg)',
          border: '1px solid var(--border-dim)',
          // Both spellings: WebKitGTK only ships the prefixed one.
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: online ? 'var(--green)' : 'var(--text-3)', boxShadow: online ? '0 0 5px var(--green)' : 'none', animation: online ? 'pulse-dot 2s infinite' : 'none' }} />
          {online ? t('machines:card.online') : t('machines:card.offline')}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '13px 15px 15px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 22 }}>{icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <a
              href={pathFor('viewer', m.id)}
              onClick={e => {
                if (!isPlainLeftClick(e)) return;
                e.preventDefault();
                if (online) onConnect(m);
              }}
              style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: 'none' }}
            >{m.name}</a>
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'monospace', marginTop: 2, letterSpacing: 1 }}>
              {m.peer_id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 · $2 · $3')}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 11 }}>
          {m.os ?? t('machines:card.defaultOs')}{!online && m.last_seen_at ? ` · ${t('machines:card.offlineSince', { time: formatLastSeen(m.last_seen_at, t) })}` : online ? ` · ${t('machines:card.lastActivityNow')}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="primary"
            disabled={!online}
            onClick={() => online && onConnect(m)}
            style={{ flex: 1, fontSize: 12, padding: '8px 0' }}
          >
            {online ? (saved ? t('machines:card.connectSaved') : t('machines:card.connect')) : t('machines:card.offline')}
          </Button>
          {saved && onForget && (
            <Button variant="secondary" onClick={() => onForget(m)}
                    title={t('machines:card.forgetPassword')} aria-label={t('machines:card.forgetPassword')}
                    style={{ fontSize: 12, padding: '8px 12px' }}>🔑✕</Button>
          )}
          {onDelete && (
            <Button variant="secondary" onClick={() => onDelete(m.id)}
                    title={t('machines:card.deleteMachine')} aria-label={t('machines:card.deleteMachine')}
                    style={{ fontSize: 12, padding: '8px 12px' }}>···</Button>
          )}
        </div>
      </div>
    </div>
  );
}
