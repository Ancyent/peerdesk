import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './branding.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import { BrandingProvider } from './branding/BrandingContext.tsx'
import { initConfig } from './config.ts'
import { ConfirmProvider, watchSystemTheme } from '@pd/ui'
import { NotifyRoot } from './NotifyRoot.tsx'

// The inline script in index.html already set data-theme before first paint.
// This re-applies from the same source and keeps following the OS while the
// stored choice is 'system'. Never unsubscribed: it lives as long as the app.
watchSystemTheme()

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
