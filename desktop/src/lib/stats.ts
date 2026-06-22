export interface LiveStats {
  fps: number | null;
  bitrateKbps: number | null;
  rttMs: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  lossPct: number | null;
}

export function parseStats(cur: RTCStatsReport, prev?: RTCStatsReport): LiveStats | null {
  let inbound: any = null;
  let codecMime: string | null = null;
  let rttMs: number | null = null;
  const curMap = cur as unknown as Map<string, any>;
  curMap.forEach((r) => {
    if (r.type === 'inbound-rtp' && r.kind === 'video') inbound = r;
    if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && r.currentRoundTripTime != null) {
      rttMs = Math.round(r.currentRoundTripTime * 1000);
    }
  });
  if (!inbound) return null;
  if (inbound.codecId) {
    const c = curMap.get(inbound.codecId);
    if (c?.mimeType) codecMime = String(c.mimeType).replace('video/', '');
  }
  let bitrateKbps: number | null = null;
  const prevMap = prev as unknown as Map<string, any> | undefined;
  const p = prevMap?.get(inbound.id);
  if (p && inbound.bytesReceived != null && p.bytesReceived != null && inbound.timestamp > p.timestamp) {
    const bits = (inbound.bytesReceived - p.bytesReceived) * 8;
    const secs = (inbound.timestamp - p.timestamp) / 1000;
    bitrateKbps = Math.round(bits / secs / 1000);
  }
  const recv = inbound.packetsReceived ?? 0;
  const lost = inbound.packetsLost ?? 0;
  const lossPct = recv + lost > 0 ? (lost / (recv + lost)) * 100 : null;
  return {
    fps: inbound.framesPerSecond ?? null,
    bitrateKbps,
    rttMs,
    width: inbound.frameWidth ?? null,
    height: inbound.frameHeight ?? null,
    codec: codecMime,
    lossPct,
  };
}
