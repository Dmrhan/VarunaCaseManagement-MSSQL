// Gelen çağrı banner'ı — ekranın üstünde (screen-pop bildirimi). SADECE gelen numarayı
// gösterir (kullanıcı isteği: "Vaka Aç" butonu ve bip zili kaldırıldı). Çağrıyı cevaplama/
// reddetme gömülü softphone panelinde (iframe) yapılır.
import { PhoneIncoming, X } from 'lucide-react';
import { useSoftphone } from '../../contexts/SoftphoneContext';

export function IncomingCallBanner() {
  const { incomingCall, dismissIncoming } = useSoftphone();
  if (!incomingCall) return null;
  const ringing = incomingCall.status === 'ringing';

  return (
    <div className="fixed left-1/2 top-4 z-[60] w-[min(94vw,26rem)] -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-lg dark:border-emerald-800 dark:bg-emerald-950">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <PhoneIncoming className={`h-5 w-5 ${ringing ? 'animate-pulse' : ''}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            {ringing ? 'Gelen çağrı' : 'Görüşmede'}
          </div>
          <div className="truncate text-lg font-semibold text-slate-800 dark:text-slate-100">
            {incomingCall.number}
          </div>
        </div>
        <button
          onClick={dismissIncoming}
          className="rounded-lg p-2 text-slate-400 hover:bg-emerald-100 dark:hover:bg-emerald-900"
          title="Bildirimi kapat"
          aria-label="Bildirimi kapat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
