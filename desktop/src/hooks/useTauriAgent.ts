import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface AgentStatus {
  running: boolean;
  peer_id: string;
  password: string;
}

export function useTauriAgent() {
  const [status, setStatus] = useState<AgentStatus>({ running: false, peer_id: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<AgentStatus>('get_agent_status');
      setStatus(s);
    } catch { /* not running yet */ }
  }, []);

  const start = useCallback(async (password: string, signalingUrl: string) => {
    setLoading(true);
    setError('');
    try {
      const s = await invoke<AgentStatus>('start_agent', { password, signalingUrl });
      setStatus(s);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setLoading(true);
    try {
      await invoke('stop_agent');
      setStatus({ running: false, peer_id: '', password: '' });
    } catch { /* ignore */ }
    finally {
      setLoading(false);
    }
  }, []);

  return { status, loading, error, start, stop, refresh };
}
