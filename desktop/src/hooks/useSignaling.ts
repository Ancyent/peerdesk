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

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        onMessageRef.current(JSON.parse(e.data) as SignalingMessage);
      } catch {
        console.warn('Ignoring malformed signaling message');
      }
    };
    return () => ws.close();
  }, [url]);

  const send = useCallback((msg: SignalingMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { send };
}
