// AloTech softphone — Varuna İÇİNE gömülü, sağ kenarda TAM YÜKSEKLİK docked panel.
// embedded: AloTech hosted softphone IFRAME'i — login + cevaplama + ses + durum hepsi
//   AloTech'in kendi arayüzünde. Panel VARSAYILAN KAPALI (sağ-altta "Softphone" butonu);
//   tıklanınca açılır ve iframe mount olup register olur. Bir kez açıldıktan sonra iframe
//   HEP MOUNTED kalır — küçültülünce yalnız GÖRSEL gizlenir (opacity-0), register/oturum
//   DÜŞMEZ, çağrı gelmeye devam eder. click2call: basit dial. env yoksa gizli.
import { useState } from 'react';
import { Phone, PhoneOff, Loader2, ChevronRight } from 'lucide-react';
import { useSoftphone } from '../../contexts/SoftphoneContext';

export function SoftphoneWidget() {
  const { mode, status, iframeUrl, activeCall, dialNumber, endCall, panelCollapsed, setPanelCollapsed } = useSoftphone();
  const [dialInput, setDialInput] = useState('');
  // Softphone bir kez açıldı mı — açıldıysa iframe MOUNTED kalır (küçültünce logout/register
  // düşmesin). setActivated yalnız açılışta true olur, bir daha false'a dönmez.
  const [activated, setActivated] = useState(false);

  // AloTech env'leri eksikse (backend configured:false → 'disabled') panel gizlenir.
  if (status === 'disabled') return null;
  const isEmbedded = mode === 'embedded';

  // Kapalıyken sağ-altta launcher — tıklayınca panel açılır (embedded'de iframe mount + register).
  const launcher = panelCollapsed ? (
    <button
      onClick={() => { setActivated(true); setPanelCollapsed(false); }}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-blue-700"
      title="Softphone'u aç"
    >
      <Phone className="h-4 w-4" /> Softphone
    </button>
  ) : null;

  // Docked panel çerçeve sınıfları: açık → görünür (z-40); kapalı → GÖRSEL gizli ama DOM'da
  // kalır (opacity-0 + arka plan + etkileşimsiz) → içindeki iframe mount kalır, register düşmez.
  const shellVisible = 'fixed right-0 top-0 z-40 flex h-screen w-[380px] flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800';
  const shellHidden = 'pointer-events-none fixed right-0 top-0 -z-10 flex h-screen w-[380px] flex-col opacity-0';

  const header = (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-700">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">AloTech Softphone</span>
      <button
        onClick={() => setPanelCollapsed(true)}
        className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
        title="Gizle (arka planda açık kalır)"
        aria-label="Gizle"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  // GÖMÜLÜ — iframe bir kez açıldıysa HEP mount; kapalıyken görsel gizli (register düşmez).
  if (isEmbedded) {
    return (
      <>
        {launcher}
        {activated && (
          <div className={panelCollapsed ? shellHidden : shellVisible} aria-hidden={panelCollapsed}>
            {header}
            {iframeUrl ? (
              <iframe
                title="AloTech Softphone"
                src={iframeUrl}
                allow="microphone; autoplay; camera; clipboard-write"
                className="w-full flex-1 border-0 bg-white"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Softphone yükleniyor…
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  // click2call — kapalıyken launcher; açıkken küçük panel (aktif çağrı veya dial).
  if (panelCollapsed) return launcher;
  return (
    <div className={shellVisible}>
      {header}
      {activeCall ? (
        <div className="space-y-3 p-3">
          <div className="rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-700/50">
            <div className="text-xs uppercase tracking-wide text-slate-400">
              {activeCall.direction === 'inbound' ? 'Gelen' : 'Giden'} · Çaldırılıyor — telefonunuzu açın
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">{activeCall.name || activeCall.number}</div>
            {activeCall.name && <div className="text-sm text-slate-500">{activeCall.number}</div>}
          </div>
          <button onClick={endCall} className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 py-2 text-sm font-medium text-white hover:bg-rose-600">
            <PhoneOff className="h-4 w-4" /> Kapat
          </button>
        </div>
      ) : (
        <div className="flex gap-2 p-3">
          <input
            value={dialInput}
            onChange={(e) => setDialInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && dialInput) { void dialNumber(dialInput); setDialInput(''); } }}
            placeholder="Numara…"
            inputMode="tel"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          />
          <button
            onClick={() => { if (dialInput) { void dialNumber(dialInput); setDialInput(''); } }}
            disabled={!dialInput || status !== 'ready'}
            className="flex items-center justify-center rounded-lg bg-emerald-500 px-3 text-white hover:bg-emerald-600 disabled:opacity-40"
            title="Ara"
          >
            <Phone className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
