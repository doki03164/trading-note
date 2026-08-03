import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { InstallPortal } from './InstallPortal';

const params = new URLSearchParams(window.location.search);
const content = params.get('install') === '1' ? <InstallPortal /> : <App />;

if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch(() => undefined);
  });
}

createRoot(document.getElementById('root')!).render(<StrictMode>{content}</StrictMode>);
