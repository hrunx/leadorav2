import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { validateEnv } from './tools/env';

// Only validate env in production builds; avoid noisy warnings in dev
if (import.meta.env.PROD) {
  validateEnv();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
