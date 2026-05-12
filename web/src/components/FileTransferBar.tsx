import { useRef } from 'react';
import type { TransferState } from '../hooks/useFileTransfer';

interface Props {
  transfer: TransferState | null;
  onSendFile: (file: File) => void;
}

export function FileTransferBar({ transfer, onSendFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pct = transfer ? Math.round((transfer.sent / transfer.size) * 100) : 0;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      background: 'rgba(0,0,0,0.85)', color: '#fff',
      padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12,
      fontFamily: 'system-ui, sans-serif', fontSize: 13, zIndex: 20,
    }}>
      <input ref={inputRef} type="file" style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onSendFile(f);
          e.target.value = '';
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        style={{ padding: '5px 14px', borderRadius: 5, background: '#2563eb',
          border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 500 }}
      >
        Send File
      </button>

      {transfer && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {transfer.name}
            </span>
            <span style={{ marginLeft: 8, color: '#9ca3af', flexShrink: 0 }}>
              {transfer.status === 'sending' && `${pct}%`}
              {transfer.status === 'done' && <span style={{ color: '#22c55e' }}>&#10003; Sent</span>}
              {transfer.status === 'error' && <span style={{ color: '#ef4444' }}>Failed</span>}
            </span>
          </div>
          {transfer.status === 'sending' && (
            <div style={{ background: '#374151', borderRadius: 2, height: 4 }}>
              <div style={{
                background: '#2563eb', height: '100%', borderRadius: 2,
                width: `${pct}%`, transition: 'width 0.15s',
              }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
