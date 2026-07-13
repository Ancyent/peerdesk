// web/src/components/CodeBlock.tsx
import { useState } from 'react';
import { copyText } from '../lib/clipboard';

const box: React.CSSProperties = {
  background: 'var(--bg-base)', borderRadius: 8, padding: '12px 14px',
  fontFamily: 'monospace', fontSize: 11, color: 'var(--text-1)',
  lineHeight: 1.6, wordBreak: 'break-all', border: '1px solid var(--border-dim)',
};
const btn = (copied: boolean): React.CSSProperties => ({
  marginTop: 8, padding: '6px 16px', fontSize: 12, border: '1px solid var(--border-dim)',
  borderRadius: 5, background: 'var(--bg-hover)', cursor: 'pointer',
  color: copied ? 'var(--green)' : 'var(--text-2)',
});

export function CodeBlock({ code, empty }: { code: string; empty?: string }) {
  const [copied, setCopied] = useState(false);
  if (!code) {
    return <div style={{ ...box, color: 'var(--text-3)' }}>{empty ?? '—'}</div>;
  }
  const copy = async () => {
    const ok = await copyText(code);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div>
      <div style={box}>{code}</div>
      <button onClick={copy} aria-label="Copiază comanda" style={btn(copied)}>{copied ? '✓ Copiat' : '📋 Copiază comanda'}</button>
    </div>
  );
}
