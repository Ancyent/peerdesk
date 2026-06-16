interface Props {
  code: string;
  onDismiss: () => void;
}

export function SecurityCodeBanner({ code, onDismiss }: Props) {
  return (
    <div style={{
      background: '#0a2a2e', border: '1px solid #26c6da', borderRadius: 8,
      padding: '12px 16px', margin: '8px 0', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: '#b3bdca', marginBottom: 4 }}>
          Security code — verify verbally with the remote party
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#26c6da', letterSpacing: 10, fontFamily: 'monospace' }}>
          {code}
        </div>
        <div style={{ fontSize: 10, color: '#93a0b2', marginTop: 4 }}>
          Codes must match on both sides. If they differ, disconnect immediately.
        </div>
      </div>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: '#93a0b2', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>&#x2715;</button>
    </div>
  );
}
