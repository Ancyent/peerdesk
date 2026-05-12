// web/src/hooks/useClipboard.ts
import { useCallback, useEffect, useRef } from 'react';

/**
 * Syncs clipboard between local browser and remote agent via a send function.
 * - On local copy/cut: reads clipboard and sends to agent
 * - On agent clipboard received: writes to local clipboard
 */
export function useClipboard(
  sendToAgent: ((text: string) => void) | null
) {
  const sendRef = useRef(sendToAgent);
  sendRef.current = sendToAgent;

  // Called when agent sends us clipboard content
  const receiveFromAgent = useCallback((text: string) => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).catch(() => {
      // Clipboard write permission denied — silently ignore
    });
  }, []);

  // Send local clipboard to agent after user copies/cuts
  const handleCopyOrCut = useCallback(() => {
    if (!navigator.clipboard || !sendRef.current) return;
    navigator.clipboard.readText().then((text) => {
      if (text && sendRef.current) {
        sendRef.current(text);
      }
    }).catch(() => {
      // Clipboard read permission denied — silently ignore
    });
  }, []);

  useEffect(() => {
    document.addEventListener('copy', handleCopyOrCut);
    document.addEventListener('cut', handleCopyOrCut);
    return () => {
      document.removeEventListener('copy', handleCopyOrCut);
      document.removeEventListener('cut', handleCopyOrCut);
    };
  }, [handleCopyOrCut]);

  return { receiveFromAgent };
}
