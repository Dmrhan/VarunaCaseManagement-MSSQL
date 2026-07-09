/**
 * CompactStatusStepper — Vaka Detay sticky header'da 3-fazlı omurga +
 * 7 statünün TIKLANIR stepper'ı.
 *
 * Görev: Statü panelini geniş 7 kartlık alandan tek satır kompakt görsele
 * indirgemek. Statü enum'una / allowed-transition kurallarına / reason zorunluluğuna
 * DOKUNULMAZ — yalnız görsel/sunum katmanı.
 *
 * Davranış:
 *  - Üstte 3 faz omurgası (Açık → İşlemde → Sonuç) — eskisi gibi.
 *  - ALTINDA 7 STATÜ CHIP DIZISI: Açık · İncelemede · 3. Parti Bekliyor ·
 *    Eskale Edildi · Çözüldü · Yeniden Açıldı · İptal Edildi.
 *  - Her chip MEVCUT STATÜYE GÖRE gate'lenir:
 *      • aktif (item.status === target)        → ring + dolu, tıklanamaz
 *      • izinli (STATUS_TRANSITIONS[item.status].includes(target))
 *                                              → renkli, tıklanır, hover
 *      • izinsiz                               → gri/sönük, disabled
 *  - Reason gerektiren geçişler (Çözüldü/İptal/Eskalasyon/3.parti)
 *    StatusTransitionPanel'i modal içinde initialPending preselect ile açar.
 *    Reason gerektirmeyenler (Açık→İncelemede, 3.parti→İncelemede,
 *    Eskalasyon→İncelemede, Yeniden Açıldı→İncelemede) doğrudan
 *    caseService.transitionStatus çağırır.
 *  - "Durumu değiştir ▾" dropdown'ı KALDIRILDI — tüm geçişler tıklanır
 *    chip'lerden yapılır.
 *
 * Reason/closure/allowed-transition/rol logic yeniden YAZILMAZ —
 *  - STATUS_TRANSITIONS (types.ts) izin matrisi
 *  - STATUS_REQUIRES_REASON (types.ts) reason zorunluluk matrisi
 *  - StatusTransitionPanel mevcut reason/closure/checklist modal'ı
 * bütün halinde reuse edilir.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Inbox,
  PauseCircle,
  RotateCw,
  Search as SearchIcon,
  TrendingUp,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { StatusPill } from '@/components/ui/StatusPill';
import { caseService, lookupService, type SmartTicketTaxonomyResponse } from '@/services/caseService';
import { useAuth } from '@/services/AuthContext';
import { externalKbService } from '@/services/externalKbService';
import { StatusTransitionPanel } from './StatusTransitionPanel';
import {
  CASE_STATUS_LABELS,
  STATUS_REQUIRES_REASON,
  STATUS_TRANSITIONS,
  type Case,
  type CaseStatus,
} from './types';

interface CompactStatusStepperProps {
  item: Case;
  onApplied: (updated: Case) => void;
  /**
   * Faz noktaları arası bağlantı çubuklarını içerik genişliğine yayar
   * (`flex-1`, min 80px). Content band'da gerçek "progress bar" görünümü için.
   * Default `false` — eski sıkışık görünüm (sticky/dar yerleşim için).
   */
  wideConnectors?: boolean;
  /** "Tümü" (wide, dar kapsam kanıtlanmamış) görünümde true — statü
   *  değiştirme tamamen devre dışı bırakılır. */
  readOnly?: boolean;
}

/**
 * Statü → görsel meta (renk + ikon). Aktif düğüm rengi BU map'ten okunur.
 * Renk + ikon + metin birlikte: erişilebilirlik için renge tek başına bağımlı
 * değil (label ve ikon her zaman var).
 */
const STATUS_VISUAL: Record<
  CaseStatus,
  {
    icon: ReactNode;
    /** Cila-2 — aktif 28px node içinde kullanılan büyük ikon (16px). */
    iconLg: ReactNode;
    /** Faz rayında nokta dolgusu (aktif alt-statü rengini taşır). */
    dotColor: string;
    /** Cila-2 — aktif node halo'su (ring-{color}/30 saydam). */
    ringColor: string;
    /** Menü dropdown'unda hedef ipucu (küçük chip). */
    chipBg: string;
    chipText: string;
    /** Aktif faz etiketi altında küçük sönük not — yalnız alt-durum varsa. */
    subStatusNote?: string;
  }
> = {
  'Açık': {
    icon: <Inbox size={13} />,
    iconLg: <Inbox size={14} strokeWidth={2.5} />,
    dotColor: 'bg-blue-500',
    ringColor: 'ring-blue-500/30',
    chipBg: 'bg-blue-50',
    chipText: 'text-blue-700',
  },
  'İncelemede': {
    icon: <SearchIcon size={13} />,
    iconLg: <SearchIcon size={14} strokeWidth={2.5} />,
    dotColor: 'bg-amber-500',
    ringColor: 'ring-amber-500/30',
    chipBg: 'bg-amber-50',
    chipText: 'text-amber-700',
  },
  '3rdPartyBekleniyor': {
    icon: <PauseCircle size={13} />,
    iconLg: <PauseCircle size={14} strokeWidth={2.5} />,
    dotColor: 'bg-slate-400',
    ringColor: 'ring-slate-400/30',
    chipBg: 'bg-slate-100',
    chipText: 'text-slate-700',
    subStatusNote: '3. parti · SLA durdu',
  },
  'Eskalasyon': {
    icon: <TrendingUp size={13} />,
    iconLg: <TrendingUp size={14} strokeWidth={2.5} />,
    dotColor: 'bg-rose-500',
    ringColor: 'ring-rose-500/30',
    chipBg: 'bg-rose-50',
    chipText: 'text-rose-700',
    subStatusNote: 'Eskale Edildi',
  },
  'YenidenAcildi': {
    icon: <RotateCw size={13} />,
    iconLg: <RotateCw size={14} strokeWidth={2.5} />,
    dotColor: 'bg-violet-500',
    ringColor: 'ring-violet-500/30',
    chipBg: 'bg-violet-50',
    chipText: 'text-violet-700',
    subStatusNote: 'Yeniden açıldı',
  },
  'Çözüldü': {
    icon: <CheckCircle2 size={13} />,
    iconLg: <CheckCircle2 size={14} strokeWidth={2.5} />,
    dotColor: 'bg-emerald-500',
    ringColor: 'ring-emerald-500/30',
    chipBg: 'bg-emerald-50',
    chipText: 'text-emerald-700',
  },
  'İptalEdildi': {
    icon: <Ban size={13} />,
    iconLg: <Ban size={14} strokeWidth={2.5} />,
    dotColor: 'bg-slate-400',
    ringColor: 'ring-slate-400/30',
    chipBg: 'bg-slate-100',
    chipText: 'text-slate-600',
    subStatusNote: 'İptal edildi',
  },
};

// 3-faz omurga + pill satırı KALDIRILDI (refactor: 7 daire-düğüm stepper).
// CASE_STATUS_PHASES / CASE_STATUS_PHASE_LABELS / CASE_STATUS_PHASE_MAP
// types.ts'de DURUR (başka kullanıcıları olabilir); bu component artık
// kullanmıyor.

/**
 * Component LOKAL etiket map'leri — kullanıcı dilinde "DURUM" (ad) vs
 * "AKSİYON" (fiil) ayrımı. CASE_STATUS_LABELS (types.ts) DOKUNULMAZ;
 * burada parallel görüntü dilidir. DB değerleri / enum identifier'lar
 * korunur.
 *
 * Davranış:
 *   - GEÇMİŞ / MEVCUT düğüm → DURUM adı (nerede olunduğu): "İncelemede"
 *   - ULAŞILABİLİR hedef düğüm → AKSİYON fiili (tıklayınca ne olacak):
 *     "İncelemeye al"
 *   - ULAŞILAMAZ düğüm → DURUM adı (sönük)
 *
 * Açık başlangıçtır; aksiyonu yoktur (Açık'a geri dönülmez).
 */
const STATUS_NOUN_LABEL: Record<CaseStatus, string> = {
  'Açık':                'Açık',
  'İncelemede':          'İncelemede',
  '3rdPartyBekleniyor':  '3rd Partide',
  'Eskalasyon':          'Eskale edildi',
  'Çözüldü':             'Çözüldü',
  'YenidenAcildi':       'Yeniden açıldı',
  'İptalEdildi':         'İptal edildi',
};

const STATUS_ACTION_LABEL: Record<CaseStatus, string | null> = {
  'Açık':                null, // başlangıç — aksiyon yok
  'İncelemede':          'İncelemeye al',
  '3rdPartyBekleniyor':  '3rd Partiye gönder',
  'Eskalasyon':          'Eskale et',
  'Çözüldü':             'Çöz',
  'YenidenAcildi':       'Yeniden aç',
  'İptalEdildi':         'İptal et',
};

const OPENING_TAG_FIELDS = ['platform', 'businessProcess', 'operationType', 'affectedObject', 'impact'] as const;

export function CompactStatusStepper({ item, onApplied, wideConnectors = false, readOnly = false }: CompactStatusStepperProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const allowed = useMemo(() => STATUS_TRANSITIONS[item.status], [item.status]);

  // Açılış etiketleri kapanış kapısı — StatusTransitionPanel'deki
  // openingTagsMissing'in aynası (caseRepository.js transitionStatus
  // guard'ı: opening_tags_required_for_closure). Burada da uygulanır ki
  // kullanıcı "Çöz" düğümüne hiç basamasın — panele girip çözüm notu
  // yazdıktan sonra reddedilmesin. kbEnabled === null (yükleniyor) →
  // güvenli taraf: aktif kalır.
  const [kbEnabled, setKbEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    if (!item.companyId) return;
    void externalKbService
      .settingsStatus(item.companyId)
      .then((st) => { if (alive) setKbEnabled(st?.enabled === true); })
      .catch(() => { if (alive) setKbEnabled(null); });
    return () => { alive = false; };
  }, [item.companyId]);
  // P2 review fix — backend YALNIZ o şirkette en az bir aktif TaxonomyDef
  // tanımlı olan alanları zorunlu sayar; StatusTransitionPanel'deki
  // definedOpeningTagKeys ile aynı desen (closureTax[key].length > 0 ⇔
  // backend'in definedTypes.has(key)). Eskiden 5 alan koşulsuz zorunluydu —
  // backend kapatmaya izin verse bile bu düğüm hiç tıklanamıyordu.
  const [openingTax, setOpeningTax] = useState<SmartTicketTaxonomyResponse['taxonomies'] | null>(null);
  const [openingTaxLoading, setOpeningTaxLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    if (item.companyId !== 'COMP-UNIVERA') return;
    setOpeningTaxLoading(true);
    void lookupService
      .smartTicketTaxonomies(item.companyId)
      .then((res) => { if (alive) setOpeningTax(res.taxonomies); })
      .catch(() => { if (alive) setOpeningTax(null); })
      .finally(() => { if (alive) setOpeningTaxLoading(false); });
    return () => { alive = false; };
  }, [item.companyId]);
  const smartTicketOpening = (
    item.customFields as { smartTicket?: Record<string, unknown> } | undefined
  )?.smartTicket;
  const definedOpeningTagKeys = new Set(
    OPENING_TAG_FIELDS.filter((key) => (openingTax?.[key]?.length ?? 0) > 0),
  );
  const openingTagsMissing =
    item.companyId === 'COMP-UNIVERA' &&
    kbEnabled !== false &&
    user?.role !== 'SystemAdmin' &&
    (openingTaxLoading
      ? OPENING_TAG_FIELDS.some((key) => !smartTicketOpening?.[key])
      : [...definedOpeningTagKeys].some((key) => !smartTicketOpening?.[key]));

  // Reason gerekmeyen geçişler için direkt API; gerekenlerde modal.
  const [reasonTarget, setReasonTarget] = useState<CaseStatus | null>(null);
  const [directSubmitting, setDirectSubmitting] = useState<CaseStatus | null>(null);

  async function handleClick(target: CaseStatus) {
    // Fonksiyon seviyesinde ek güvence — UI'da bir yer unutulsa bile
    // "Tümü" (wide, dar kapsam kanıtlanmamış) görünümde statü değişmez.
    if (readOnly) return;
    if (STATUS_REQUIRES_REASON[target]) {
      // Modal akışı — StatusTransitionPanel preselect ile açılır, reason/closure
      // taxonomy / KB suggestion / checklist bütünlüğü panelin kendisinde.
      setReasonTarget(target);
      return;
    }
    if (directSubmitting) return;
    setDirectSubmitting(target);
    try {
      const updated = await caseService.transitionStatus(item.id, target, {});
      if (updated) {
        toast({
          type: 'info',
          title: 'Statü güncellendi',
          message: `${updated.caseNumber} → ${STATUS_NOUN_LABEL[target]}`,
        });
        onApplied(updated);
      } else {
        toast({ type: 'warn', message: 'Statü değiştirilemedi.' });
      }
    } finally {
      setDirectSubmitting(null);
    }
  }

  // 7 durumun lineer sırası — eski 3-faz omurganın görsel mantığında
  // "tamamlanan/current/sonraki" anlamı için. Kanonik sıra
  // CASE_STATUS_LABELS map'ten gelir (Açık → … → İptal Edildi).
  const NODE_ORDER = Object.keys(CASE_STATUS_LABELS) as CaseStatus[];
  const currentIdx = NODE_ORDER.indexOf(item.status);

  return (
    // Üst sarmalayıcı:
    //   - pt-3 → stepper üst kenara yapışmasın (kullanıcı talebi #1: nefes
    //     payı)
    //   - relative → sağ üstte mutlak konumlu StatusPill (kullanıcı talebi
    //     #2: mevcut durum sağ üstte renk-kodlu rozet)
    //   - pr-... → pill'in stepper'a binmemesi için sağdan padding
    <div
      className={`relative pt-3 pr-2 sm:pr-28 ${wideConnectors ? 'w-full' : ''}`}
      role="group"
      aria-label={`Vaka statü adımları — şu an ${CASE_STATUS_LABELS[item.status]}`}
    >
      {/* Sağ üst MEVCUT DURUM rozeti — REUSE: src/components/ui/StatusPill.tsx.
          Dropdown kalktığından bu köşe boştu; mevcut durumun rengi orada
          tek bakışta görünür. Stepper'daki aktif düğüm büyük halo'su
          KALIR; pill onu tamamlar (sticky/dar yerleşimlerde başlık seviyesinde
          okunabilir kalır). */}
      <div className="absolute right-2 top-2 z-10">
        <StatusPill status={item.status} />
      </div>

      {/* TEK 7-DÜĞÜMLÜ STEPPER — 3-faz omurgasının görsel stili (daire +
          bağlantı çizgisi + ikon + alt etiket) AYNI; ama 3 faz yerine 7
          DURUM düğümü. Pill satırı + 3-faz çizgisi KALDIRILDI.

          Gating:
            • current  → ring-4 + dolu STATUS_VISUAL.dotColor, tıklanamaz
            • allowed  → border-2 renkli + beyaz zemin, hover dolu + cursor-pointer
            • disallowed → sönük gri border, opacity-60, cursor-not-allowed
            • completed (idx < currentIdx) → görsel kalıtım: solgun, ama
              connector çizgisi yeşil değil (7-state'te lineer "tamamlandı"
              anlamı zayıf; bağlantı çizgileri pasif/gri kalır).

          Allowed-transition + reason zorunluluğu MEVCUT matrislerden
          (STATUS_TRANSITIONS + STATUS_REQUIRES_REASON, types.ts).

          Tıklayınca handleClick mevcut akışı tetikler — reason'lı geçişler
          StatusTransitionPanel modal'ına gider, reason'sız geçişler doğrudan
          caseService.transitionStatus.

          Dar ekran: container overflow-x-auto; düğümler shrink-0; mobilde
          yatay scroll. flex-1 connector ile büyük ekranda 7 düğüm yatayda
          eşit yayılır. */}
      <ol className="flex w-full min-w-0 items-start overflow-x-auto">
        {NODE_ORDER.map((target, idx) => {
          const v = STATUS_VISUAL[target];
          const isCurrent = target === item.status;
          const isOpeningTagsBlocked = target === 'Çözüldü' && openingTagsMissing;
          const isAllowed = allowed.includes(target) && !isOpeningTagsBlocked;
          // 4 GÖRSEL DURUM — kullanıcı dilinde net ayrılır:
          //   • PAST       (geçmiş)        → lineer geçmiş VE allowed DEĞİL
          //   • CURRENT    (mevcut)        → item.status (BURADASIN)
          //   • REACHABLE  (ulaşılabilir)  → STATUS_TRANSITIONS allowed
          //   • LOCKED     (ulaşılamaz)    → diğer hepsi
          // Etiket dili: PAST/CURRENT/LOCKED → durum adı (STATUS_NOUN_LABEL)
          //              REACHABLE         → aksiyon fiili (STATUS_ACTION_LABEL)
          //
          // Codex review fix — REACHABLE > PAST öncelik. Allowed
          // back-transition'larda hedef idx < currentIdx olabilir (örn:
          // Eskalasyon → İncelemede, 3rdPartyBekleniyor → İncelemede,
          // YenidenAcildi → İncelemede). Önce isPast yeşil ✓ + LOCKED
          // semantik çıkarıyordu → tıklanabilir geri-dönüş CTA "tamamlanmış"
          // gibi görünüyordu. Doğru: allowed back-transition REACHABLE
          // kalmalı; sadece allowed DEĞİL olan geçmiş düğümler PAST sayılır.
          const interactive = isAllowed && !isCurrent && !readOnly;
          const isPast = idx < currentIdx && !isAllowed;
          const isBusy = directSubmitting === target;
          const needsReason = STATUS_REQUIRES_REASON[target];
          const actionLabel = STATUS_ACTION_LABEL[target];
          // Ulaşılabilir hedefin aksiyon fiili olmazsa (Açık başlangıç) durum
          // adına düş; pratikte interactive Açık olmaz (allowed listesinde
          // Açık yok). Defensive.
          const displayLabel = interactive && actionLabel
            ? actionLabel
            : STATUS_NOUN_LABEL[target];

          // Daire stilleri — 4 durum × görsel ayrım:
          //   PAST      → emerald dolu + beyaz Check; "bu durumdan geçildi"
          //   CURRENT   → STATUS_VISUAL.dotColor + ring-4 + iconLg + scale
          //               (daha büyük halo); "BURADASIN"
          //   REACHABLE → dotColor dolu + opacity-90 + hover ring; canlı CTA
          //   LOCKED    → dashed gri + slate-50 + opacity-60; pasif
          const nodeBase = 'flex items-center justify-center rounded-full transition';
          const nodeCls = isCurrent
            ? `${nodeBase} h-9 w-9 ${v.dotColor} text-white ring-4 ${v.ringColor} shadow-sm`
            : isPast
              ? `${nodeBase} h-7 w-7 bg-emerald-500 text-white`
              : interactive
                ? `${nodeBase} h-7 w-7 ${v.dotColor} text-white opacity-90 hover:opacity-100 hover:ring-4 hover:${v.ringColor} cursor-pointer`
                : `${nodeBase} h-7 w-7 border-2 border-dashed border-slate-300 bg-slate-50 text-slate-300 dark:bg-ndark-card dark:border-ndark-border opacity-60`;

          // Bağlantı çizgisi (connector) — düğümün SOLUNDAKİ çizgi.
          // PAST düğüme kadar olan connector'lar yeşil (akış); diğerleri slate.
          const connectorClass = idx <= currentIdx
            ? 'bg-emerald-400'
            : 'bg-slate-200 dark:bg-ndark-border';

          // aria-label/title — durum adı + (var ise) aksiyon ipucu
          const ariaTitle = isCurrent
            ? `${STATUS_NOUN_LABEL[target]} — şu an buradasın`
            : isPast
              ? `${STATUS_NOUN_LABEL[target]} — bu durumdan geçildi`
              : interactive
                ? needsReason
                  ? `${actionLabel ?? STATUS_NOUN_LABEL[target]} — gerekçe penceresi açılır`
                  : actionLabel ?? STATUS_NOUN_LABEL[target]
                : isOpeningTagsBlocked
                  ? 'Açılış etiketleri (platform / iş süreci / işlem türü / etkilenen nesne / etki) tamamlanmadan çözülemez — önce Detay sekmesindeki Akıllı Tanımlar kartını doldurun.'
                  : `${STATUS_NOUN_LABEL[target]} — bu durumdan geçilemez`;

          return (
            <li
              key={target}
              className={`flex shrink-0 items-start ${idx > 0 ? 'flex-1 min-w-[88px]' : 'min-w-[72px]'}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {/* Soldaki bağlantı çizgisi — düğümün ÜST yarısı hizasında.
                  current büyük (h-9) olduğunda merkez hizası daha aşağıda;
                  mt-4 ile orta noktayı çoğunluk için yakalar. */}
              {idx > 0 && (
                <span
                  aria-hidden="true"
                  className={`mt-3.5 h-1 flex-1 rounded-full ${connectorClass}`}
                />
              )}

              {/* Düğüm — daire + altında etiket. Düğüm tıklanır button
                  içinde; etiket görsel olarak altta ama buton içinde
                  (tek hit-area). */}
              <button
                type="button"
                onClick={() => {
                  if (!interactive) return;
                  handleClick(target);
                }}
                disabled={!interactive || !!directSubmitting}
                aria-disabled={!interactive}
                title={ariaTitle}
                className={`flex shrink-0 flex-col items-center gap-1 px-1.5 transition disabled:cursor-not-allowed ${interactive ? '' : 'cursor-default'}`}
              >
                <span className={nodeCls}>
                  {isBusy ? (
                    <span aria-hidden="true" className="animate-pulse text-[10px]">…</span>
                  ) : isPast ? (
                    // PAST → beyaz Check (kullanıcı isteği: "yeşil daire + ✓")
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  ) : isCurrent ? (
                    // CURRENT → daha büyük iconLg
                    v.iconLg ?? v.icon
                  ) : (
                    v.icon
                  )}
                </span>
                <span
                  className={`text-center text-[11px] leading-tight ${
                    isCurrent
                      ? 'font-bold text-slate-900 dark:text-ndark-text'
                      : isPast
                        ? 'font-medium text-emerald-700 dark:text-emerald-300'
                        : interactive
                          ? `font-semibold ${v.chipText}`
                          : 'text-slate-400 dark:text-ndark-muted'
                  }`}
                >
                  {displayLabel}
                  {interactive && needsReason && (
                    <span
                      aria-label="Gerekçe gerekir"
                      title="Gerekçe penceresi açılır"
                      className="ml-0.5 inline-flex translate-y-[-1px] items-center text-slate-400"
                    >
                      <AlertTriangle size={9} aria-hidden="true" />
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Reason zorunlu hedef için modal — StatusTransitionPanel'i bütün halinde
          reuse eder; preselect initialPending ile akış doğrudan reason fazına gider. */}
      {reasonTarget && (
        <Modal
          open
          onClose={() => setReasonTarget(null)}
          size="2xl"
          title={`Statü değişikliği — ${CASE_STATUS_LABELS[reasonTarget]}`}
        >
          <StatusTransitionPanel
            item={item}
            initialPending={reasonTarget}
            compactMode
            onApplied={(updated) => {
              setReasonTarget(null);
              onApplied(updated);
            }}
            // Codex P2 — Vazgeç click'inde modal kapansın, boş kalmasın
            onCancel={() => setReasonTarget(null)}
          />
        </Modal>
      )}
    </div>
  );
}
