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
    <div className="fixed left-1/2 top-3 z-[60] w-[min(92vw,20rem)] -translate-x-1/2">
      <div className="flex items-center gap-2.5 rounded-full border border-emerald-200 bg-emerald-50 py-1.5 pl-2 pr-1.5 shadow-lg dark:border-emerald-800 dark:bg-emerald-950">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <PhoneIncoming className={`h-3.5 w-3.5 ${ringing ? 'animate-pulse' : ''}`} />
        </span>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            {ringing ? 'Gelen çağrı' : 'Görüşmede'}
          </span>
          <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {incomingCall.number}
          </span>
        </div>
        <button
          onClick={dismissIncoming}
          className="rounded-full p-1.5 text-slate-400 hover:bg-emerald-100 dark:hover:bg-emerald-900"
          title="Bildirimi kapat"
          aria-label="Bildirimi kapat"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
