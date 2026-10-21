/**
 * Entry point. Deliberately thin: styles, providers, router, and the service
 * worker registration with an honest update notice (§20 offline core).
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import './styles/global.css';
import { App } from './App';
import { ChronicleProvider } from './state/ChronicleContext';

const container = document.getElementById('root');
if (!container) throw new Error('Chronicle needs a #root element to start.');

createRoot(container).render(
  <StrictMode>
    <ChronicleProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ChronicleProvider>
  </StrictMode>
);

/* ------------------------------------------------------------------ *
 * Service worker: register in production builds only, and tell the user
 * when a new version is waiting instead of swapping underneath them.
 * ------------------------------------------------------------------ */

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('chronicle:sw-update'));
            }
          });
        });
      })
      .catch(() => {
        /* Offline support is a bonus; a blocked worker must not break the app */
      });
  });
}
