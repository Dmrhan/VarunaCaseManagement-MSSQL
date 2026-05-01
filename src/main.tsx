import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/ui/Toast';
import { LookupGate } from './components/LookupGate';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <LookupGate>
        <App />
      </LookupGate>
    </ToastProvider>
  </StrictMode>,
);
