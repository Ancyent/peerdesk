// web/src/hooks/useSignaling.ts
import { useCallback, useEffect, useRef } from 'react';
import type { SignalingMessage } from '../types/messages';

export function useSignaling(
  url: string,
  onMessage: (msg: SignalingMessage) => void,
  onError?: () => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<string[]>([]);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;
    queueRef.current = [];

    ws.onopen = () => {
      // Flush anything queued before the socket finished opening.
      const queued = queueRef.current;
      queueRef.current = [];
      for (const payload of queued) ws.send(payload);
    };
    ws.onmessage = (e) => {
      try {
        onMessageRef.current(JSON.parse(e.data) as SignalingMessage);
      } catch {
        console.warn('Ignoring malformed signaling message');
      }
    };
    ws.onerror = () => { onErrorRef.current?.(); };
    ws.onclose = (e) => {
      // Surface abnormal closes (e.g. server unreachable) so the UI can fail
      // out of "Establishing connection" instead of hanging forever.
      if (!e.wasClean) onErrorRef.current?.();
    };

    return () => {
      queueRef.current = [];
      ws.close();
    };
  }, [url]);

  const send = useCallback((msg: SignalingMessage) => {
    const payload = JSON.stringify(msg);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else if (ws && ws.readyState === WebSocket.CONNECTING) {
      // Queue until onopen flushes it.
      queueRef.current.push(payload);
    }
  }, []);

  return { send };
}
