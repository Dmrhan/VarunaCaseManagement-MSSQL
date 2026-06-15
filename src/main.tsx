import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/ui/Toast';
import { LookupGate } from './components/LookupGate';
import { AuthGate } from './components/AuthGate';
import { AuthProvider } from './services/AuthContext';
import './index.css';

// Faz 3 (local auth): Supabase invite/recovery hash tespiti kaldırıldı.
// Zorunlu şifre değişimi artık /api/auth/me'nin mustChangePassword alanıyla
// AuthGate'te yönetiliyor.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <AuthGate>
          <LookupGate>
            <App />
          </LookupGate>
        </AuthGate>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
