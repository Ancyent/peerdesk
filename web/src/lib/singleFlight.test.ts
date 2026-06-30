import { describe, it, expect, vi } from 'vitest';
import { singleFlight } from './singleFlight';

describe('singleFlight', () => {
  it('shares one in-flight promise then re-invokes after settle', async () => {
    const fn = vi.fn(async () => 'x');
    const wrapped = singleFlight(fn);
    const [a, b] = await Promise.all([wrapped(), wrapped()]);
    expect(a).toBe('x'); expect(b).toBe('x');
    expect(fn).toHaveBeenCalledTimes(1);
    await wrapped();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears in-flight on rejection', async () => {
    const fn = vi.fn(async () => { throw new Error('no'); });
    const wrapped = singleFlight(fn);
    await expect(wrapped()).rejects.toThrow('no');
    await expect(wrapped()).rejects.toThrow('no');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
