import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './branding.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import { BrandingProvider } from './branding/BrandingContext.tsx'
import { initConfig } from './config.ts'
import { ConfirmProvider } from '@pd/ui'
import { NotifyRoot } from './NotifyRoot.tsx'

// NotifyProvider goes outermost (via NotifyRoot) so a confirm dialog can
// also raise toasts.
initConfig().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <NotifyRoot>
        <ConfirmProvider>
          <BrandingProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrandingProvider>
        </ConfirmProvider>
      </NotifyRoot>
    </StrictMode>,
  )
})
