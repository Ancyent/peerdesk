// web/src/hooks/useSignaling.ts
import { useCallback, useEffect, useRef } from 'react';
import type { SignalingMessage } from '../types/messages';

export function useSignaling(
  url: string,
  onMessage: (msg: SignalingMessage) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  // Messages sent before the socket opens are queued and flushed on open,
  // otherwise an early connect/join would be silently dropped.
  const queueRef = useRef<SignalingMessage[]>([]);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      const q = queueRef.current;
      queueRef.current = [];
      for (const m of q) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (e) => {
      try {
        onMessageRef.current(JSON.parse(e.data) as SignalingMessage);
      } catch {
        console.warn('Ignoring malformed signaling message');
      }
    };
    ws.onerror = () => {
      console.warn('Signaling WebSocket error');
    };
    ws.onclose = (e) => {
      if (!e.wasClean) console.warn('Signaling WebSocket closed unexpectedly', e.code);
    };
    return () => ws.close();
  }, [url]);

  const send = useCallback((msg: SignalingMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      queueRef.current.push(msg); // flushed on open
    }
  }, []);

  return { send };
}
