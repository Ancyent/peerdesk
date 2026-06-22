import { useEffect, useRef, useState } from 'react';
import { parseStats, type LiveStats } from '../lib/stats';

export function useStats(getPc: () => RTCPeerConnection | null, active: boolean): LiveStats | null {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const prev = useRef<RTCStatsReport | undefined>(undefined);
  useEffect(() => {
    if (!active) { setStats(null); prev.current = undefined; return; }
    const id = setInterval(async () => {
      const pc = getPc();
      if (!pc) return;
      const report = await pc.getStats();
      setStats(parseStats(report, prev.current));
      prev.current = report;
    }, 1000);
    return () => clearInterval(id);
  }, [getPc, active]);
  return stats;
}
