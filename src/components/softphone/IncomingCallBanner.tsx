// Gelen çağrı banner'ı — ekranın üstünde.
// embedded (popup): "Cevapla" AloTech softphone penceresini öne getirir (cevaplama
//   orada yapılır); "Reddet" REST ile çağrıyı kapatır. click2call: bildirim.
// Her iki modda "Vaka Aç" → callerId ile Akıllı Ticket (müşteri ön-seçili) açar (screen pop).
// Çağrı yanıtlanınca otomatik tetiklenir (SOFTPHONE_ANSWERED_EVENT).
import { PhoneIncoming, PhoneOff, X, FilePlus2 } from 'lucide-react';
import { useSoftphone, SOFTPHONE_ANSWERED_EVENT } from '../../contexts/SoftphoneContext';

export function IncomingCallBanner() {
  const { mode, incomingCall, answerCall, endCall, dismissIncoming } = useSoftphone();
  if (!incomingCall) return null;
  const isEmbedded = mode === 'embedded';
  const ringing = incomingCall.status === 'ringing';

  const openTicket = () => {
    window.dispatchEvent(new CustomEvent(SOFTPHONE_ANSWERED_EVENT, { detail: { number: incomingCall.number } }));
    dismissIncoming();
  };

  return (
    <div className="fixed left-1/2 top-4 z-[60] w-[min(94vw,34rem)] -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-lg dark:border-emerald-800 dark:bg-emerald-950">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <PhoneIncoming className={`h-5 w-5 ${ringing ? 'animate-pulse' : ''}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            {ringing ? 'Gelen çağrı' : 'Görüşmede'}{incomingCall.queue ? ` · ${incomingCall.queue}` : ''}
          </div>
          <div className="truncate text-base font-semibold text-slate-800 dark:text-slate-100">
            {incomingCall.matchedName || incomingCall.number}
          </div>
          {incomingCall.matchedName && <div className="truncate text-sm text-slate-500 dark:text-slate-400">{incomingCall.number}</div>}
        </div>

        <button
          onClick={openTicket}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          title="Bu numarayla Akıllı Ticket aç"
        >
          <FilePlus2 className="h-4 w-4" /> Vaka Aç
        </button>

        {isEmbedded ? (
          <>
            <button
              onClick={answerCall}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600"
              title="AloTech softphone penceresinde cevapla"
            >
              <PhoneIncoming className="h-4 w-4" /> Cevapla
            </button>
            <button
              onClick={endCall}
              className="flex items-center justify-center rounded-lg bg-rose-500 px-3 py-2 text-white hover:bg-rose-600"
              title="Reddet"
            >
              <PhoneOff className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            onClick={dismissIncoming}
            className="rounded-lg p-2 text-slate-400 hover:bg-emerald-100 dark:hover:bg-emerald-900"
            title="Bildirimi kapat"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
