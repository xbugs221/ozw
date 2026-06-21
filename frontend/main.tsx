/**
 * PURPOSE: Mount the React shell and register the production PWA service
 * worker that lets mobile users install ozw to their home screen.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import './i18n/config'

function registerProductionServiceWorker(): void {
  /**
   * Register only built production assets so local Vite development cannot keep
   * stale module responses in a browser service worker cache.
   */
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('Failed to register service worker:', error)
    })
  })
}

registerProductionServiceWorker()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
