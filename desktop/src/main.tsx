import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import App from './App.tsx'
import './styles.css'
import { watchSystemTheme } from '@pd/ui'

// Matches the inline script in index.html and keeps tracking the OS preference
// while the stored choice is 'system'. Desktop has no theme picker in its own
// Settings yet, so today this only follows the OS.
watchSystemTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
