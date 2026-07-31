// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyBranding } from './useBranding';

const root = document.documentElement;

/** WCAG contrast ratio between two hex colours, computed independently of the
 *  implementation so the assertions check the outcome rather than the method. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = hex.replace('#', '');
    const [r, g, bl] = [0, 2, 4].map(i => {
      const v = parseInt(c.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

beforeEach(() => {
  root.style.removeProperty('--accent');
  root.style.removeProperty('--accent-hover');
  root.style.removeProperty('--accent-ink');
});

describe('applyBranding accent ink', () => {
  it('stands aside for the default accent so the theme keeps its own per-theme values', () => {
    applyBranding({ brand_name: 'PeerDesk', logo_data_url: null, accent_color: '#22c5b0' });
    expect(root.style.getPropertyValue('--accent')).toBe('');
    expect(root.style.getPropertyValue('--accent-ink')).toBe('');
  });

  it('applies a customised accent', () => {
    applyBranding({ brand_name: 'Acme', logo_data_url: null, accent_color: '#2563eb' });
    expect(root.style.getPropertyValue('--accent')).toBe('#2563eb');
  });

  it.each([
    ['#2563eb', 'deep blue'],
    ['#fde047', 'pale yellow'],
    ['#0b1a4a', 'navy'],
    ['#22c5b1', 'bright teal, one digit off the default'],
    ['#ff6b6b', 'coral'],
    ['#111111', 'near black'],
    ['#fafafa', 'near white'],
  ])('picks ink clearing 4.5:1 on %s (%s)', (hex) => {
    applyBranding({ brand_name: 'Acme', logo_data_url: null, accent_color: hex });
    const ink = root.style.getPropertyValue('--accent-ink');
    expect(ink).not.toBe('');
    expect(contrast(hex, ink)).toBeGreaterThanOrEqual(4.5);
  });
});
