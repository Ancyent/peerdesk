import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';

/** Live view of the agent's activity (connect, register, errors, reconnects),
 *  polled from the Rust log buffer. */
export function LogPanel() {
  const { t } = useTranslation('viewer');
  const [lines, setLines] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  // Auto-scroll to newest only while the user is already at the bottom; if they
  // scroll up to read older lines, leave them there.
  const stickRef = useRef(true);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      invoke<string[]>('get_agent_log')
        .then((l) => { if (alive) setLines(l); })
        .catch(() => {});
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (stickRef.current && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const b = boxRef.current;
    if (b) stickRef.current = b.scrollHeight - b.scrollTop - b.clientHeight < 24;
  };

  const color = (l: string) =>
    /\bERROR\b/.test(l) ? '#f0a0a0' : /\bWARN\b/.test(l) ? '#e3b341' : '#9fb0c3';

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 10, color: '#93a0b2', letterSpacing: 1, fontWeight: 600, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #21262d', textTransform: 'uppercase' }}>
        {t('viewer:log.title')}
      </div>
      <div
        ref={boxRef}
        onScroll={onScroll}
        style={{
          height: 170, overflow: 'auto', background: '#0a0e14',
          border: '1px solid #21262d', borderRadius: 6, padding: '8px 10px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10.5, lineHeight: 1.5,
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: '#93a0b2' }}>{t('viewer:log.empty')}</div>
        ) : (
          lines.slice(-250).map((l, i) => (
            <div key={i} style={{ color: color(l), whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{l}</div>
          ))
        )}
      </div>
    </div>
  );
}
