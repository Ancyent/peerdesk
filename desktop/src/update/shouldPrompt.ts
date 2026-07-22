/** -1 if a<b, 0 if equal, 1 if a>b (numeric dotted versions). */
export function cmpVer(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export interface PromptArgs {
  current: string;
  latest: string | null;
  skipVersion: string;
  snoozeUntil: number | null;
  now: number;
}

/** Whether to surface the update prompt: newer than current, not the skipped
 *  version, and not currently snoozed. */
export function shouldPrompt({ current, latest, skipVersion, snoozeUntil, now }: PromptArgs): boolean {
  if (!latest || !current) return false;
  if (cmpVer(latest, current) <= 0) return false;
  if (latest === skipVersion) return false;
  if (snoozeUntil != null && now < snoozeUntil) return false;
  return true;
}
