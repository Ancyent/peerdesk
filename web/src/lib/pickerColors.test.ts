import { describe, it, expect } from 'vitest';
import { pickerItemColors } from './pickerColors';

describe('pickerItemColors', () => {
  it('primary (not selected) is amber with a Default badge', () => {
    const c = pickerItemColors(true, false);
    expect(c.border).toBe('#f59e0b');
    expect(c.number).toBe('#f59e0b');
    expect(c.showDefaultBadge).toBe(true);
    expect(c.background).toBe('transparent');
  });

  it('selected (not primary) is light green', () => {
    const c = pickerItemColors(false, true);
    expect(c.border).toBe('#34d399');
    expect(c.background).toBe('rgba(52,211,153,0.15)');
    expect(c.showDefaultBadge).toBe(false);
  });

  it('selected AND primary: green border wins, amber badge kept', () => {
    const c = pickerItemColors(true, true);
    expect(c.border).toBe('#34d399');
    expect(c.background).toBe('rgba(52,211,153,0.15)');
    expect(c.showDefaultBadge).toBe(true);
  });

  it('plain monitor is neutral grey', () => {
    const c = pickerItemColors(false, false);
    expect(c.border).toBe('#3f4754');
    expect(c.number).toBe('#cbd5e1');
    expect(c.showDefaultBadge).toBe(false);
  });
});
