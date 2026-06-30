export const IDLE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function isIdleExpired(lastActivityMs: number, nowMs: number, thresholdMs: number): boolean {
  return nowMs - lastActivityMs > thresholdMs;
}
