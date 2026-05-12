import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api, type BrandingConfig } from '../api/client';
import { applyBranding } from '../hooks/useBranding';

const DEFAULT: BrandingConfig = {
  brand_name: 'PeerDesk',
  logo_data_url: null,
  accent_color: '#2563eb',
};

export const BrandingContext = createContext<BrandingConfig>(DEFAULT);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingConfig>(DEFAULT);

  useEffect(() => {
    api.branding.get()
      .then(b => {
        setBranding(b);
        applyBranding(b);
      })
      .catch(() => {
        applyBranding(DEFAULT);
      });
  }, []);

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBrandingContext(): BrandingConfig {
  return useContext(BrandingContext);
}
