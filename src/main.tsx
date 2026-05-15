import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/ui/Toast';
import { LookupGate } from './components/LookupGate';
import { AuthGate } from './components/AuthGate';
import { AuthProvider } from './services/AuthContext';
import './index.css';

/**
 * Davet / şifre kurtarma link'i tespiti.
 *
 * Supabase invite/recovery mail link'i tıklandığında URL hash şu formatta gelir:
 *   #access_token=...&refresh_token=...&type=invite&expires_at=...
 *   #access_token=...&refresh_token=...&type=recovery&expires_at=...
 *
 * Supabase JS SDK (`detectSessionInUrl: true` — default) bu hash'i okuyup
 * session başlatır ve hash'i URL'den TEMİZLER. Bu yüzden React render olunca
 * artık hash boş — `type=invite` bilgisini kaybederiz.
 *
 * Çözüm: SDK işlemeden ÖNCE hash'i okuyup sessionStorage'a flag yaz. AuthGate
 * bu flag'i okuyup şifre belirleme sayfasını render eder.
 */
(function detectInviteOrRecoveryLink() {
  try {
    const hash = window.location.hash || '';
    if (hash.includes('type=invite') || hash.includes('type=recovery')) {
      sessionStorage.setItem('varuna.pendingPasswordSetup', '1');
    }
  } catch {
    // sessionStorage erişim engeli (private mode, vs.) — sessizce yut
  }
})();

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
