import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AgentStatus } from '../types';

const DEFAULT_STATUS: AgentStatus = {
  running: false,
  peer_id: '',
  approval_status: 'standalone',
  server_url: null,
  access_mode: 'full',
};

export function useAgent() {
  const [status, setStatus] = useState<AgentStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<AgentStatus>('get_agent_status');
      setStatus(s);
    } catch {
      /* not running yet */
    }
  }, []);

  const start = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const s = await invoke<AgentStatus>('start_agent');
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setLoading(true);
    try {
      await invoke('stop_agent');
      setStatus((prev) => ({ ...prev, running: false }));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh]);

  return { status, loading, error, refresh, start, stop };
}
