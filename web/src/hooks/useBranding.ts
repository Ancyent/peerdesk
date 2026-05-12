import { useEffect, useState } from 'react';
import { api, type BrandingConfig } from '../api/client';

export type { BrandingConfig };

const DEFAULT_BRANDING: BrandingConfig = {
  brand_name: 'PeerDesk',
  logo_data_url: null,
  accent_color: '#2563eb',
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

export function applyBranding(b: BrandingConfig): void {
  const root = document.documentElement;
  root.style.setProperty('--accent', b.accent_color);
  root.style.setProperty('--accent-hover', darken(b.accent_color, 0.12));
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
