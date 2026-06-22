import { describe, it, expect } from 'vitest';
import { normToPx } from './viewerGeom';

describe('normToPx', () => {
  it('places a normalized point inside a letterboxed 16:9 video in a wide box', () => {
    const p = normToPx(0.5, 0.5, { width: 1000, height: 500 }, 1920, 1080)!;
    expect(Math.round(p.left)).toBe(500);
    expect(Math.round(p.top)).toBe(250);
  });
  it('returns null when video size unknown', () => {
    expect(normToPx(0.5, 0.5, { width: 1000, height: 500 }, 0, 0)).toBeNull();
  });
});
