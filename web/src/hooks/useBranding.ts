import { useEffect, useState } from 'react';
import { api, type BrandingConfig } from '../api/client';

export type { BrandingConfig };

export const DEFAULT_BRANDING: BrandingConfig = {
  brand_name: 'PeerDesk',
  logo_data_url: null,
  // Matches --accent in branding.css. It was #2563eb, so every unbranded
  // deployment rendered blue while the stylesheet said teal - and because
  // applyBranding writes an inline style on the root, the blue won everywhere.
  accent_color: '#22c5b0',
};

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const [r, g, b] = clean.split('').map(c => parseInt(c + c, 16));
    return [r, g, b];
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }
  return null;
}

function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map(v => Math.max(0, Math.round(v * (1 - amount))));
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const INK_LIGHT = '#ffffff';
const INK_DARK = '#04201d';

/** Picks whichever ink actually contrasts better against the fill.
 *
 *  A luminance threshold is the usual shortcut and it gets this wrong: our own
 *  accent #22c5b0 sits at ~0.43, above any sensible midpoint, yet white on it is
 *  only 2.2:1 while dark ink is 7.5:1. Comparing the two ratios is both exact
 *  and shorter than justifying a magic number. */
function inkFor(hex: string): string {
  const l = luminance(hex);
  const vsLight = 1.05 / (l + 0.05);
  const vsDark = (l + 0.05) / (luminance(INK_DARK) + 0.05);
  return vsDark >= vsLight ? INK_DARK : INK_LIGHT;
}

export function applyBranding(b: BrandingConfig): void {
  const root = document.documentElement;

  // An inline style on the root element beats both theme blocks. That is right
  // for a customer's colour, but wrong for our own: the light theme deliberately
  // uses a darker teal than dark mode does, and forcing one value would flatten
  // that. So when the deployment has not customised the accent, stand aside and
  // let the stylesheet's per-theme values apply.
  if (b.accent_color.toLowerCase() === DEFAULT_BRANDING.accent_color.toLowerCase()) {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-hover');
    root.style.removeProperty('--accent-ink');
  } else {
    root.style.setProperty('--accent', b.accent_color);
    root.style.setProperty('--accent-hover', darken(b.accent_color, 0.12));
    // Without this a customer picking pale yellow gets white text on yellow,
    // and one picking navy gets dark on dark - the theme's ink was computed for
    // our teal, not theirs.
    root.style.setProperty('--accent-ink', inkFor(b.accent_color));
  }

  if (b.brand_name) {
    document.title = b.brand_name;
  }
}

export function useBranding(): BrandingConfig {
  const [branding, setBranding] = useState<BrandingConfig>(DEFAULT_BRANDING);

  useEffect(() => {
    api.branding.get()
      .then(b => {
        setBranding(b);
        applyBranding(b);
      })
      .catch(() => {
        applyBranding(DEFAULT_BRANDING);
      });
  }, []);

  return branding;
}
