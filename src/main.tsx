import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/ui/Toast';
import { LookupGate } from './components/LookupGate';
import { AuthGate } from './components/AuthGate';
import { AuthProvider } from './services/AuthContext';
import { SoftphoneProvider, useSoftphone } from './contexts/SoftphoneContext';
import { SoftphoneWidget } from './components/softphone/SoftphoneWidget';
import { IncomingCallBanner } from './components/softphone/IncomingCallBanner';
import './index.css';

// Faz 3 (local auth): Supabase invite/recovery hash tespiti kaldırıldı.
// Zorunlu şifre değişimi artık /api/auth/me'nin mustChangePassword alanıyla
// AuthGate'te yönetiliyor.

// AppShell — softphone dock ENTEGRASYON katmanı. Uygulamanın TAMAMI (App + banner)
// bu katmanın içinde yaşar; softphone dock DIŞINDA kalır (viewport'a sabit sağ 300px).
//
// AppShell `position: fixed` ile viewport'u doldurur ama dock açıkken sağdan 300px
// içerlek durur (right: 300px) → dock'un yeri gerçekten ayrılır. `overflow-y: auto`
// ile uygulama scroll'u ARTIK bu kutuda döner (body değil). `contain: layout` ise
// AppShell'i tüm `position: fixed` TORUNLAR için CONTAINING BLOCK yapar (MDN — layout
// containment): App içinde inline açılan HER drawer/modal (ör. Aksiyonlarım /
// ActionCenterDrawer `fixed inset-y-0 right-0`) artık viewport'a DEĞİL bu kutuya göre
// konumlanır → softphone'un altına/üstüne binmez, tam soluna oturur; kutu viewport
// boyunda + tepeye sabit olduğundan drawer'lar hâlâ pinned kalır (doküman boyuna uzamaz).
//
// Güvenli olduğu doğrulananlar: Popover body'e portal eder (bu block'tan etkilenmez);
// sticky header scroll konteyneri olarak AppShell'e göre çalışır; window-scroll'a gerçek
// bağımlılık yok (scroll'lar iç elemanlara bağlı). Scroll konteyneri body→AppShell'e
// taşındığından body scroll-lock yapan CaseListDrawer #app-scroll'u kilitler.
function AppShell({ children }: { children: ReactNode }) {
  const { dockReserved } = useSoftphone();
  return (
    <div
      id="app-scroll"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        right: dockReserved ? '300px' : 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        contain: 'layout',
        transition: 'right 200ms',
      }}
    >
      {children}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <AuthGate>
          <SoftphoneProvider>
            <AppShell>
              <LookupGate>
                <App />
              </LookupGate>
              <IncomingCallBanner />
            </AppShell>
            <SoftphoneWidget />
          </SoftphoneProvider>
        </AuthGate>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
