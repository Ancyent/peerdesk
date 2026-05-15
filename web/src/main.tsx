import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './branding.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import { BrandingProvider } from './branding/BrandingContext.tsx'
import { initConfig } from './config.ts'

initConfig().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrandingProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrandingProvider>
    </StrictMode>,
  )
})
