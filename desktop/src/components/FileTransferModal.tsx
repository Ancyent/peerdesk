import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';

interface OutgoingFile {
  id: string;
  name: string;
  size: number;
  sent: number;
  status: 'sending' | 'done' | 'error';
}

interface IncomingFile {
  id: string;
  name: string;
  size: number;
  chunks: string[];
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
  const [tab, setTab] = useState<'send' | 'receive'>('send');
  const [outgoing, setOutgoing] = useState<OutgoingFile[]>([]);
  const [incoming, setIncoming] = useState<IncomingFile[]>([]);

  useEffect(() => {
    if (!ftChannel) return;
    const handler = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'file_meta') {
          setIncoming(prev => [...prev, { id: msg.id, name: msg.name, size: msg.size, chunks: [], received: 0, status: 'receiving' }]);
        } else if (msg.type === 'file_chunk') {
          setIncoming(prev => prev.map(f =>
            f.id !== msg.id ? f :
            { ...f, chunks: [...f.chunks, msg.data as string], received: f.received + Math.floor((msg.data as string).length * 3 / 4) }
          ));
        } else if (msg.type === 'file_end') {
          setIncoming(prev => prev.map(f => {
            if (f.id !== msg.id) return f;
            const binary = atob(f.chunks.join(''));
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const url = URL.createObjectURL(new Blob([bytes]));
            return { ...f, status: 'done', url };
          }));
        }
      } catch { /* ignore malformed */ }
    };
    ftChannel.addEventListener('message', handler);
    return () => ftChannel.removeEventListener('message', handler);
  }, [ftChannel]);

  useEffect(() => {
    return () => {
      incoming.forEach(f => { if (f.url) URL.revokeObjectURL(f.url); });
    };
  }, [incoming]);

  const handlePickFile = (file: File) => {
    if (!ftChannel || ftChannel.readyState !== 'open') return;
    const id = genId();
    const CHUNK = 16 * 1024;
    setOutgoing(prev => [...prev, { id, name: file.name, size: file.size, sent: 0, status: 'sending' }]);
    ftChannel.send(JSON.stringify({ type: 'file_meta', id, name: file.name, size: file.size }));

    const reader = new FileReader();
    let offset = 0;

    const readNext = () => {
      reader.readAsDataURL(file.slice(offset, offset + CHUNK));
    };

    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      ftChannel.send(JSON.stringify({ type: 'file_chunk', id, data: base64 }));
      offset += CHUNK;
      setOutgoing(prev => prev.map(f => f.id === id ? { ...f, sent: Math.min(offset, file.size) } : f));
      if (offset < file.size) {
        readNext();
      } else {
        ftChannel.send(JSON.stringify({ type: 'file_end', id }));
        setOutgoing(prev => prev.map(f => f.id === id ? { ...f, status: 'done' } : f));
      }
    };
    reader.onerror = () => setOutgoing(prev => prev.map(f => f.id === id ? { ...f, status: 'error' } : f));
    readNext();
  };

  const tabBtn = (t: 'send' | 'receive'): CSSProperties => ({
    flex: 1, background: 'none', border: 'none',
    borderBottom: tab === t ? '2px solid #26c6da' : '2px solid transparent',
    color: tab === t ? '#26c6da' : '#8b949e',
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
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', flex: 1 }}>File Transfer</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#484f58', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid #21262d' }}>
          <button style={tabBtn('send')} onClick={() => setTab('send')}>Send</button>
          <button style={tabBtn('receive')} onClick={() => setTab('receive')}>Receive</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {tab === 'send' && (
            <>
              <label style={{ display: 'block', border: '2px dashed #30363d', borderRadius: 8, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', color: '#484f58', fontSize: 12, marginBottom: 12 }}>
                <input type="file" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handlePickFile(e.target.files[0])} />
                📁 Click to pick a file
              </label>
              {outgoing.map(f => (
                <div key={f.id} style={{ background: '#0d1117', borderRadius: 6, padding: '8px 12px', marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: '#c9d1d9', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{f.name}</span>
                    <span style={{ color: f.status === 'done' ? '#56d364' : f.status === 'error' ? '#f85149' : '#8b949e', flexShrink: 0 }}>
                      {f.status === 'done' ? '✓ Done' : f.status === 'error' ? '✗ Error' : `${Math.round((f.sent / f.size) * 100)}%`}
                    </span>
                  </div>
                  {f.status === 'sending' && (
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
                <div style={{ textAlign: 'center', color: '#484f58', fontSize: 12, paddingTop: 20 }}>No incoming files yet</div>
              )}
              {incoming.map(f => (
                <div key={f.id} style={{ background: '#0d1117', borderRadius: 6, padding: '8px 12px', marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: '#c9d1d9', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{f.name}</span>
                    {f.status === 'done' && f.url ? (
                      <a href={f.url} download={f.name} style={{ color: '#26c6da', fontSize: 11, textDecoration: 'none', flexShrink: 0 }}>⬇ Download</a>
                    ) : (
                      <span style={{ color: '#8b949e', flexShrink: 0 }}>{Math.round((f.received / f.size) * 100)}%</span>
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
