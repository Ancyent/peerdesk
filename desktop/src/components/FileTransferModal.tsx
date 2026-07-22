import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

interface OutgoingFile {
  id: string;
  name: string;
  size: number;
  sent: number;
  status: 'pending' | 'sending' | 'done' | 'error';
  errorNote?: string;
}

interface IncomingFile {
  id: string;
  name: string;
  size: number;
  received: number;
  status: 'receiving' | 'done';
  url?: string;
}

interface Props {
  ftChannel: RTCDataChannel | null;
  onClose: () => void;
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function FileTransferModal({ ftChannel, onClose }: Props) {
  const { t } = useTranslation('viewer');
  const [tab, setTab] = useState<'send' | 'receive'>('send');
  const [outgoing, setOutgoing] = useState<OutgoingFile[]>([]);
  const [incoming, setIncoming] = useState<IncomingFile[]>([]);

  // Bug 3 fix: keep a ref so the unmount cleanup sees the latest incoming list
  const incomingRef = useRef(incoming);
  useEffect(() => { incomingRef.current = incoming; }, [incoming]);

  // Pending outgoing transfers awaiting an ft_accept before chunks are sent.
  const pendingSends = useRef<Map<string, { start: () => void; abort: () => void }>>(new Map());

  // Revoke Blob URLs only on unmount, not on every incoming update
  useEffect(() => {
    return () => { incomingRef.current.forEach(f => { if (f.url) URL.revokeObjectURL(f.url); }); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ftChannel) return;
    const handler = (e: MessageEvent) => {
      // Binary messages are future-use (agent → viewer file send, not yet implemented)
      if (e.data instanceof ArrayBuffer) return;

      try {
        const msg = JSON.parse(e.data as string);

        // Agent responses to our outgoing transfers
        if (msg.type === 'ft_accept') {
          setOutgoing(prev => prev.map(f => f.id === msg.id ? { ...f, status: 'sending' } : f));
          // Only now do we begin streaming chunks for this transfer.
          const pending = pendingSends.current.get(msg.id as string);
          if (pending) {
            pendingSends.current.delete(msg.id as string);
            pending.start();
          }
        } else if (msg.type === 'ft_reject') {
          const pending = pendingSends.current.get(msg.id as string);
          if (pending) { pending.abort(); pendingSends.current.delete(msg.id as string); }
          setOutgoing(prev => prev.map(f => f.id === msg.id ? { ...f, status: 'error', errorNote: msg.reason as string } : f));
        } else if (msg.type === 'ft_progress') {
          setOutgoing(prev => prev.map(f => f.id === msg.id ? { ...f, sent: msg.received as number } : f));
        } else if (msg.type === 'ft_done') {
          setOutgoing(prev => prev.map(f => f.id === msg.id ? { ...f, status: 'done' } : f));
        }
        // Incoming files from agent (future feature — placeholder)
      } catch { /* ignore malformed */ }
    };
    ftChannel.addEventListener('message', handler);
    return () => ftChannel.removeEventListener('message', handler);
  }, [ftChannel]);

  // Abort any in-flight/pending transfers on unmount so readers stop firing.
  useEffect(() => {
    const map = pendingSends.current;
    return () => { map.forEach(p => p.abort()); map.clear(); };
  }, []);

  // Bug 9 fix: send ft_offer, then wait for ft_accept before streaming chunks.
  const handlePickFile = (file: File) => {
    if (!ftChannel || ftChannel.readyState !== 'open') return;
    const id = genId();
    const CHUNK = 16 * 1024;
    setOutgoing(prev => [...prev, { id, name: file.name, size: file.size, sent: 0, status: 'pending' }]);
    ftChannel.send(JSON.stringify({ type: 'ft_offer', id, name: file.name, size: file.size }));

    let offset = 0;
    let aborted = false;
    const reader = new FileReader();

    const readNext = () => {
      if (aborted) return;
      reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK));
    };

    reader.onload = () => {
      if (aborted || !(reader.result instanceof ArrayBuffer)) return;
      if (ftChannel.readyState !== 'open') {
        setOutgoing(prev => prev.map(f => f.id === id ? { ...f, status: 'error', errorNote: t('viewer:fileTransfer.channelClosed') } : f));
        return;
      }
      ftChannel.send(reader.result);
      offset += reader.result.byteLength;
      setOutgoing(prev => prev.map(f => f.id === id ? { ...f, sent: Math.min(offset, file.size) } : f));
      if (offset < file.size) {
        readNext();
      } else {
        setOutgoing(prev => prev.map(f => f.id === id ? { ...f, status: 'done' } : f));
      }
    };

    reader.onerror = () => {
      setOutgoing(prev => prev.map(f => f.id === id ? { ...f, status: 'error' } : f));
    };

    // Register the send loop; it only runs once the agent sends ft_accept.
    pendingSends.current.set(id, {
      start: readNext,
      abort: () => { aborted = true; try { reader.abort(); } catch { /* ignore */ } },
    });
  };

  const tabBtn = (t: 'send' | 'receive'): CSSProperties => ({
    flex: 1, background: 'none', border: 'none',
    borderBottom: tab === t ? '2px solid #26c6da' : '2px solid transparent',
    color: tab === t ? '#26c6da' : '#b3bdca',
    padding: '8px', fontSize: 12, cursor: 'pointer', fontWeight: 500,
  });

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 10, width: 380, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', borderBottom: '1px solid #21262d' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', flex: 1 }}>{t('viewer:fileTransfer.title')}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#93a0b2', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid #21262d' }}>
          <button style={tabBtn('send')} onClick={() => setTab('send')}>{t('viewer:fileTransfer.send')}</button>
          <button style={tabBtn('receive')} onClick={() => setTab('receive')}>{t('viewer:fileTransfer.receive')}</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {tab === 'send' && (
            <>
              <label style={{ display: 'block', border: '2px dashed #30363d', borderRadius: 8, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', color: '#93a0b2', fontSize: 12, marginBottom: 12 }}>
                <input type="file" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handlePickFile(e.target.files[0])} />
                📁 {t('viewer:fileTransfer.pickFile')}
              </label>
              {outgoing.map(f => (
                <div key={f.id} style={{ background: '#0d1117', borderRadius: 6, padding: '8px 12px', marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: '#e6ebf1', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{f.name}</span>
                    <span style={{ color: f.status === 'done' ? '#56d364' : f.status === 'error' ? '#f85149' : '#b3bdca', flexShrink: 0 }}>
                      {f.status === 'done' ? `✓ ${t('viewer:fileTransfer.done')}`
                        : f.status === 'error' ? `✗ ${f.errorNote ?? t('viewer:fileTransfer.error')}`
                        : f.status === 'pending' ? t('viewer:fileTransfer.waiting')
                        : `${Math.round((f.sent / f.size) * 100)}%`}
                    </span>
                  </div>
                  {(f.status === 'sending' || f.status === 'pending') && (
                    <div style={{ height: 3, background: '#21262d', borderRadius: 2 }}>
                      <div style={{ height: '100%', background: '#26c6da', borderRadius: 2, width: `${(f.sent / f.size) * 100}%`, transition: 'width 0.1s' }} />
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
          {tab === 'receive' && (
            <>
              {incoming.length === 0 && (
                <div style={{ textAlign: 'center', color: '#93a0b2', fontSize: 12, paddingTop: 20 }}>{t('viewer:fileTransfer.noIncoming')}</div>
              )}
              {incoming.map(f => (
                <div key={f.id} style={{ background: '#0d1117', borderRadius: 6, padding: '8px 12px', marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: '#e6ebf1', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{f.name}</span>
                    {f.status === 'done' && f.url ? (
                      <a href={f.url} download={f.name} style={{ color: '#26c6da', fontSize: 11, textDecoration: 'none', flexShrink: 0 }}>⬇ {t('viewer:fileTransfer.download')}</a>
                    ) : (
                      <span style={{ color: '#b3bdca', flexShrink: 0 }}>{Math.round((f.received / f.size) * 100)}%</span>
                    )}
                  </div>
                  {f.status === 'receiving' && (
                    <div style={{ height: 3, background: '#21262d', borderRadius: 2 }}>
                      <div style={{ height: '100%', background: '#26c6da', borderRadius: 2, width: `${(f.received / f.size) * 100}%`, transition: 'width 0.1s' }} />
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
