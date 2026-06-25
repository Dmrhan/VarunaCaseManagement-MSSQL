import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/ui/Toast';
import { LookupGate } from './components/LookupGate';
import { AuthGate } from './components/AuthGate';
import { AuthProvider } from './services/AuthContext';
import { SoftphoneProvider } from './contexts/SoftphoneContext';
import { SoftphoneWidget } from './components/softphone/SoftphoneWidget';
import { IncomingCallBanner } from './components/softphone/IncomingCallBanner';
import './index.css';

// Faz 3 (local auth): Supabase invite/recovery hash tespiti kaldırıldı.
// Zorunlu şifre değişimi artık /api/auth/me'nin mustChangePassword alanıyla
// AuthGate'te yönetiliyor.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <AuthGate>
          <SoftphoneProvider>
            <LookupGate>
              <App />
            </LookupGate>
            <IncomingCallBanner />
            <SoftphoneWidget />
          </SoftphoneProvider>
        </AuthGate>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
