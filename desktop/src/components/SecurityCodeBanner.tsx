import { useTranslation } from 'react-i18next';

interface Props {
  code: string;
  onDismiss: () => void;
}

/** The one-time security code the host reads out to the viewer.
 *
 *  Rendered entirely through --pd-sys-* tokens, which no uploaded theme may
 *  declare: a code the user cannot read is a code they will skip. It used to
 *  be protected only by still holding hardcoded hex, which the pending
 *  token-adoption work would have removed without anyone noticing. */
export function SecurityCodeBanner({ code, onDismiss }: Props) {
  const { t } = useTranslation('viewer');
  return (
    <div style={{
      background: 'var(--pd-sys-accent-bg, #0a2a2e)',
      border: '1px solid var(--pd-sys-accent, #26c6da)', borderRadius: 8,
      padding: '12px 16px', margin: '8px 0', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--pd-sys-text-2, #b3bdca)', marginBottom: 4 }}>
          {t('viewer:securityCode.label')}
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--pd-sys-accent, #26c6da)', letterSpacing: 10, fontFamily: 'monospace' }}>
          {code}
        </div>
        <div style={{ fontSize: 10, color: 'var(--pd-sys-text-3, #93a0b2)', marginTop: 4 }}>
          {t('viewer:securityCode.note')}
        </div>
      </div>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'var(--pd-sys-text-3, #93a0b2)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>&#x2715;</button>
    </div>
  );
}
