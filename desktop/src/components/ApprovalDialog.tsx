import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useNotify } from '@pd/ui';

interface ApprovalReq {
  viewer_id: string;
  remote_ip: string;
}

/** Attended-access prompt. The agent emits `approval-request` for every
 *  incoming connection; the host must accept or reject. Auto-rejects after
 *  60s (matching the agent-side timeout) so a stale prompt can't hang. */
export function ApprovalDialog() {
  const { t } = useTranslation('viewer');
  const { notify } = useNotify();
  const [req, setReq] = useState<ApprovalReq | null>(null);
  const [secs, setSecs] = useState(60);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reqRef = useRef<ApprovalReq | null>(null);
  reqRef.current = req;

  const show = (r: ApprovalReq) => {
    if (reqRef.current) return; // already showing one
    setReq(r);
    setSecs(60);
  };

  // Two mechanisms so the prompt is reliable: a Tauri event (instant) and a
  // poll of get_pending_approval (works even if the event doesn't arrive).
  // Both failures stay silent — they're deliberately redundant, so either
  // one failing to register/poll is covered by the other still working.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<ApprovalReq>('approval-request', (e) => show(e.payload))
      .then((u) => { unlisten = u; })
      .catch(() => {});

    const poll = setInterval(() => {
      if (reqRef.current) return;
      invoke<ApprovalReq | null>('get_pending_approval')
        .then((p) => { if (p) show(p); })
        .catch(() => {});
    }, 1500);

    return () => { unlisten?.(); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const respond = (approved: boolean) => {
    // Deliberate action (accept/reject a specific viewer): if this fails, the
    // host would otherwise believe they answered when the agent never heard it.
    if (req) invoke('respond_approval', { viewerId: req.viewer_id, approved }).catch(() => notify.error(t('notify:approvalFailed')));
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
          {t('viewer:approval.title')}
        </div>
        <div style={{ fontSize: 12, color: '#b3bdca', marginBottom: 16, lineHeight: 1.5 }}>
          {t('viewer:approval.message')}
          <br />{t('viewer:approval.fromIp')} <span style={{ color: '#26c6da', fontFamily: 'monospace' }}>{req.remote_ip}</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => respond(false)}
            style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: '1px solid #30363d', background: 'transparent', color: '#f0a0a0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            {t('viewer:approval.reject')}
          </button>
          <button
            onClick={() => respond(true)}
            style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: 'none', background: '#26c6da', color: '#0d1117', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            {t('viewer:approval.accept', { secs })}
          </button>
        </div>
      </div>
      <style>{`@keyframes pd-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}
