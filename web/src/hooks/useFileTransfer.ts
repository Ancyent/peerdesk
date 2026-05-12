import { useCallback, useRef, useState } from 'react';

const CHUNK_SIZE = 64 * 1024; // 64 KB

export interface TransferState {
  id: string;
  name: string;
  size: number;
  sent: number;
  status: 'sending' | 'done' | 'error';
}

export function useFileTransfer(ftChannel: RTCDataChannel | null) {
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const pendingResolve = useRef<Map<string, (accepted: boolean) => void>>(new Map());

  const handleMessage = useCallback((data: string | ArrayBuffer) => {
    if (typeof data !== 'string') return;
    try {
      const msg = JSON.parse(data) as { type: string; id?: string; reason?: string };
      const resolve = msg.id ? pendingResolve.current.get(msg.id) : undefined;
      if (msg.type === 'ft_accept' && resolve) {
        pendingResolve.current.delete(msg.id!);
        resolve(true);
      } else if (msg.type === 'ft_reject' && resolve) {
        pendingResolve.current.delete(msg.id!);
        resolve(false);
      } else if (msg.type === 'ft_done') {
        setTransfer(s => s ? { ...s, status: 'done' } : null);
        setTimeout(() => setTransfer(null), 3000);
      }
    } catch { /* ignore */ }
  }, []);

  const sendFile = useCallback(async (file: File) => {
    if (!ftChannel || ftChannel.readyState !== 'open') return;

    const id = crypto.randomUUID();
    setTransfer({ id, name: file.name, size: file.size, sent: 0, status: 'sending' });

    ftChannel.send(JSON.stringify({
      type: 'ft_offer', id, name: file.name, size: file.size, mime: file.type,
    }));

    const accepted = await new Promise<boolean>((resolve) => {
      pendingResolve.current.set(id, resolve);
      setTimeout(() => {
        pendingResolve.current.delete(id);
        resolve(false);
      }, 15000);
    });

    if (!accepted) {
      setTransfer(s => s ? { ...s, status: 'error' } : null);
      return;
    }

    const buffer = await file.arrayBuffer();
    let offset = 0;
    while (offset < buffer.byteLength) {
      if (ftChannel.bufferedAmount > 1024 * 1024) {
        // Back-pressure: wait for buffer to drain
        await new Promise(r => setTimeout(r, 50));
        continue;
      }
      const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
      ftChannel.send(chunk);
      offset += chunk.byteLength;
      setTransfer(s => s ? { ...s, sent: offset } : null);
      await new Promise(r => setTimeout(r, 0));
    }
  }, [ftChannel]);

  return { transfer, sendFile, handleMessage };
}
