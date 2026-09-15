import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.jsx'
import ErrorBoundary from './components/common/ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Registered unconditionally (not just when a staff member opts into push
// notifications, see src/utils/push.js) so the PWA install criteria — which
// on several browsers still checks for an active service worker — are met
// on every visit. Re-registering the same script URL is a no-op if it's
// already registered (e.g. because push was already enabled), so this is
// safe to call alongside that flow.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/firebase-messaging-sw.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  });
}
