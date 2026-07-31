import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api, type BrandingConfig } from '../api/client';
import { applyBranding, DEFAULT_BRANDING as DEFAULT } from '../hooks/useBranding';

// The default used to be declared a second time right here, and the two copies
// had already drifted apart in accent colour. applyBranding now compares the
// incoming accent against this exact object to decide whether to override the
// theme, so a second copy would silently break that check.

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
