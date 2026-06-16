import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface ApprovalReq {
  viewer_id: string;
  remote_ip: string;
}

/** Attended-access prompt. The agent emits `approval-request` for every
 *  incoming connection; the host must accept or reject. Auto-rejects after
 *  60s (matching the agent-side timeout) so a stale prompt can't hang. */
export function ApprovalDialog() {
  const [req, setReq] = useState<ApprovalReq | null>(null);
  const [secs, setSecs] = useState(60);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<ApprovalReq>('approval-request', (e) => {
      setReq(e.payload);
      setSecs(60);
    })
      .then((u) => { unlisten = u; })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  const respond = (approved: boolean) => {
    if (req) invoke('respond_approval', { viewerId: req.viewer_id, approved }).catch(() => {});
    setReq(null);
    if (timer.current) clearInterval(timer.current);
  };

  useEffect(() => {
    if (!req) return;
    timer.current = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) { respond(false); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  if (!req) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(5, 8, 13, 0.72)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 340, background: '#161b22', border: '1px solid rgba(38,198,218,0.35)',
          borderRadius: 12, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
          animation: 'pd-pop 140ms ease-out',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: '#e6edf3', marginBottom: 6 }}>
          Incoming connection
        </div>
        <div style={{ fontSize: 12, color: '#b3bdca', marginBottom: 16, lineHeight: 1.5 }}>
          Someone wants to control this computer.
          <br />From IP <span style={{ color: '#26c6da', fontFamily: 'monospace' }}>{req.remote_ip}</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => respond(false)}
            style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: '1px solid #30363d', background: 'transparent', color: '#f0a0a0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Reject
          </button>
          <button
            onClick={() => respond(true)}
            style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: 'none', background: '#26c6da', color: '#0d1117', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Accept ({secs}s)
          </button>
        </div>
      </div>
      <style>{`@keyframes pd-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}
