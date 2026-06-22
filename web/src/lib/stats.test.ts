import { describe, it, expect } from 'vitest';
import { parseStats, type LiveStats } from './stats';

function makeReport(entries: Record<string, unknown>[]): RTCStatsReport {
  const map = new Map<string, unknown>();
  entries.forEach((e, i) => map.set(String(e.id ?? i), e));
  return map as unknown as RTCStatsReport;
}

describe('parseStats', () => {
  it('computes bitrate from byte delta and reads fps/resolution/codec/rtt', () => {
    const prev = makeReport([{ id: 'v', type: 'inbound-rtp', kind: 'video', bytesReceived: 1000, timestamp: 1000 }]);
    const cur = makeReport([
      { id: 'v', type: 'inbound-rtp', kind: 'video', bytesReceived: 126000, timestamp: 2000,
        framesPerSecond: 30, frameWidth: 1280, frameHeight: 720, packetsReceived: 100, packetsLost: 1, codecId: 'c' },
      { id: 'c', type: 'codec', mimeType: 'video/H264' },
      { id: 'p', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.042 },
    ]);
    const s: LiveStats = parseStats(cur, prev)!;
    expect(s.bitrateKbps).toBe(1000);
    expect(s.fps).toBe(30);
    expect(s.width).toBe(1280);
    expect(s.height).toBe(720);
    expect(s.codec).toBe('H264');
    expect(s.rttMs).toBe(42);
    expect(s.lossPct).toBeCloseTo(0.99, 1);
  });

  it('returns null when there is no inbound video', () => {
    expect(parseStats(makeReport([]), undefined)).toBeNull();
  });
});
