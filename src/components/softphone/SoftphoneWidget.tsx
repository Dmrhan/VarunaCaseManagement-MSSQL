// AloTech softphone — Varuna İÇİNE ENTEGRE, sağda DAR (300px) tam-yükseklik dock.
// embedded: AloTech hosted softphone IFRAME'i — login + cevaplama + ses + durum hepsi
//   AloTech'in kendi arayüzünde. Panel VARSAYILAN küçültülmüş; header'daki "Softphone"
//   butonuna tıklayınca açılır (ayrı pill YOK), GELEN ÇAĞRIDA otomatik öne gelir. Bir kez
//   açıldıktan sonra iframe HEP MOUNTED kalır — küçültme yalnız className'i değiştirir
//   (görsel gizlenir, opacity-0), DOM yapısı aynı kaldığından register/oturum DÜŞMEZ,
//   tekrar login OLMAZ.
// ENTEGRE: Panel açıkken main.tsx'teki AppShell katmanı (position:fixed + right:300px +
//   contain:layout) uygulamanın TAMAMINI sağdan 300px içerlek tutar → içerik VE açılan
//   drawer/modal'lar panelin ALTINA girmez, arkasındaki butonlar TIKLANABİLİR kalır
//   (yüzen kart değil). Eski dock 380px'ti (~ekranın 1/5'i); 300px'e daraltıldı +
//   küçültülünce tamamen kalkar. click2call: basit dial. env yoksa gizli.
//   NOT: PANEL_W (w-[300px]) AppShell'deki right:300px ile EŞLEŞMELİ.
import { useEffect, useState } from 'react';
import { Phone, PhoneOff, Loader2, Minus } from 'lucide-react';
import { useSoftphone } from '../../contexts/SoftphoneContext';

// Panel genişliği — TEK YERDEN ayarla. Değişirse App.tsx'teki pr-[300px] de güncellenmeli.
const PANEL_W = 'w-[300px]';

export function SoftphoneWidget() {
  const {
    mode, status, iframeUrl, activeCall, dialNumber, endCall,
    panelCollapsed, setPanelCollapsed, activated, openPanel,
    incomingCall,
  } = useSoftphone();
  const [dialInput, setDialInput] = useState('');

  // Gelen (inbound) çağrıda kartı otomatik öne getir (küçültülmüşse aç).
  useEffect(() => {
    if (incomingCall?.inbound && panelCollapsed) openPanel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall?.key, incomingCall?.inbound]);

  // AloTech env'leri eksikse (backend configured:false → 'disabled') tamamen gizli.
  if (status === 'disabled') return null;
  const isEmbedded = mode === 'embedded';

  // Sağda DAR tam-yükseklik dock. Açık → görünür (içerik pr-[300px] ile yanına
  // kayar, entegre); embedded'de küçültülünce görsel gizli ama iframe MOUNT kalır
  // (register düşmesin).
  const cardVisible = `fixed right-0 top-0 z-40 flex h-screen ${PANEL_W} flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800`;
  const cardHidden = `pointer-events-none fixed right-0 top-0 -z-10 flex h-screen ${PANEL_W} flex-col opacity-0`;

  const ready = status === 'ready';
  const statusDot = (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${ready ? 'bg-emerald-400' : 'bg-slate-300 dark:bg-slate-500'}`}
      title={ready ? 'Bağlı' : 'Bağlanıyor'}
    />
  );

  const header = (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-700">
      <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        <Phone className="h-4 w-4 text-brand-600 dark:text-brand-400" />
        AloTech
        {statusDot}
      </span>
      <button
        onClick={() => setPanelCollapsed(true)}
        className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
        title="Küçült (arka planda açık kalır)"
        aria-label="Küçült"
      >
        <Minus className="h-4 w-4" />
      </button>
    </div>
  );

  const embeddedIframe = iframeUrl ? (
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
  );

  // GÖMÜLÜ — iframe bir kez açıldıysa (activated) HEP MOUNT kalır. Küçültme YALNIZ
  // className'i değiştirir (cardVisible↔cardHidden); DOM yapısı AYNI olduğundan React
  // iframe'i remount ETMEZ → küçültünce AloTech oturumu/register DÜŞMEZ, tekrar login
  // OLMAZ, çağrı almaya devam eder. Küçültülünce görsel gizli; geri açmak header'daki
  // "Softphone" butonuyla (ayrı pill YOK — header'da zaten mevcut).
  if (isEmbedded) {
    if (!activated) return null; // header launcher açana kadar hiçbir şey
    return (
      <div className={panelCollapsed ? cardHidden : cardVisible} aria-hidden={panelCollapsed}>
        {header}
        {embeddedIframe}
      </div>
    );
  }

  // click2call — kapalıyken hiçbir şey (header butonu açar); açıkken küçük kart.
  if (panelCollapsed) return null;
  return (
    <div className={cardVisible}>
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
