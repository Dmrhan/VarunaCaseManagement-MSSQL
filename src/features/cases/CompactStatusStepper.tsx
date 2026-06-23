/**
 * CompactStatusStepper — Vaka Detay sticky header'da 3-fazlı renk-kodlu çizgi.
 *
 * Görev: Statü panelini geniş 7 kartlık alandan tek satır kompakt görsele
 * indirgemek. Statü enum'una / allowed-transition kurallarına / reason zorunluluğuna
 * DOKUNULMAZ — yalnız görsel/sunum katmanı.
 *
 * Davranış:
 *  - 3 faz omurgası (Açık → İşlemde → Sonuç).
 *  - Aktif düğüm rengi alt-durumdan gelir (Eskalasyon=mercan, 3.parti=gri,
 *    normal İşlemde=amber, Çözüldü=yeşil, İptal=gri, YenidenAcildi=mor, Açık=mavi).
 *  - Tamamlanan omurga + bağlantı çizgisi yeşil + check ikonu.
 *  - Aksiyon satırı: o anki statüden geçerli geçişlerin en sık 2'si açık buton;
 *    geri kalanlar "⋯" taşma menüsünde. Butonlar hedef statünün rengini taşır.
 *  - Geçişlerden reason zorunlu olanlar (Çözüldü/İptal/Eskalasyon/3.parti)
 *    StatusTransitionPanel'i modal içinde initialPending preselect ile açar.
 *    Reason gerektirmeyenler (Açık→İncelemede, 3.parti→İncelemede, …) doğrudan
 *    caseService.transitionStatus çağırır.
 *
 * Reason/closure logic yeniden YAZILMAZ — mevcut StatusTransitionPanel modal
 * içinde bütün halinde reuse edilir.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  Flag,
  Inbox,
  PauseCircle,
  RotateCw,
  Search as SearchIcon,
  TrendingUp,
} from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { caseService } from '@/services/caseService';
import { StatusTransitionPanel } from './StatusTransitionPanel';
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_PHASES,
  CASE_STATUS_PHASE_LABELS,
  CASE_STATUS_PHASE_MAP,
  STATUS_REQUIRES_REASON,
  STATUS_TRANSITIONS,
  type Case,
  type CaseStatus,
  type CaseStatusPhase,
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

const PHASE_ORDER: Record<CaseStatusPhase, number> = {
  open: 0,
  in_progress: 1,
  result: 2,
};

// Cila-3 (madde #4) — STATUS_VERB_LABELS map'i kaldırıldı. Menü etiketleri
// artık doğrudan CASE_STATUS_LABELS (statü adı) kullanır: "Çözüldü",
// "3. Parti Bekliyor", "Eskale Edildi", "İptal Edildi". Sol renkli dot
// hedef geçişi sinyal verir; etiket sade ve PR-C A9 ile tutarlı.

export function CompactStatusStepper({ item, onApplied, wideConnectors = false }: CompactStatusStepperProps) {
  const { toast } = useToast();
  const currentPhase = CASE_STATUS_PHASE_MAP[item.status];
  const currentPhaseIdx = PHASE_ORDER[currentPhase];
  const allowed = useMemo(() => STATUS_TRANSITIONS[item.status], [item.status]);

  // Reason gerekmeyen geçişler için direkt API; gerekenlerde modal.
  const [reasonTarget, setReasonTarget] = useState<CaseStatus | null>(null);
  const [directSubmitting, setDirectSubmitting] = useState<CaseStatus | null>(null);

  async function handleClick(target: CaseStatus) {
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
          message: `${updated.caseNumber} → ${CASE_STATUS_LABELS[target]}`,
        });
        onApplied(updated);
      } else {
        toast({ type: 'warn', message: 'Statü değiştirilemedi.' });
      }
    } finally {
      setDirectSubmitting(null);
    }
  }

  // Aktif faz görsel meta — alt-statüden çözülür (ek kriter 1).
  const activeVisual = STATUS_VISUAL[item.status];
  const subStatusNote = activeVisual.subStatusNote;

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${wideConnectors ? 'w-full' : ''}`}>
      {/* Faz rayı — nokta + 1px hairline. Kutu/dolu pill yok.
          wideConnectors=true → ray content band genişliğine yayılır (progress bar). */}
      <div
        className={`flex flex-col ${wideConnectors ? 'flex-1' : ''}`}
        role="group"
        aria-label={`Vaka statü adımları — şu an ${CASE_STATUS_LABELS[item.status]}`}
      >
        <div className={`flex items-center ${wideConnectors ? 'w-full' : ''}`}>
          {CASE_STATUS_PHASES.map((phase, idx) => {
            const isCurrent = phase === currentPhase;
            const isCompleted = idx < currentPhaseIdx;

            // Cila-2 — gerçek process göstergesi: dolu node + ikon + halo.
            // Tamamlanan → bg-emerald-500 dolu + beyaz Check
            // Aktif      → activeVisual.dotColor dolu + statünün kendi ikonu
            //              (beyaz) + ring-4 ring-{color}/30 halo (öne çıkar)
            // Gelecek    → border-2 border-slate-300 bg-white + sönük Flag ikonu
            // Yön B renk mantığı: aktif node rengi alt-statüden gelir.
            const nodeBase = 'flex h-7 w-7 items-center justify-center rounded-full transition';
            const nodeCls = isCompleted
              ? `${nodeBase} bg-emerald-500 text-white`
              : isCurrent
                ? `${nodeBase} ${activeVisual.dotColor} text-white ring-4 ${activeVisual.ringColor}`
                : `${nodeBase} border-2 border-slate-300 bg-white text-slate-300`;

            // Kalın ray (~4px) — Cila-2.
            const connectorClass =
              idx === 0
                ? 'hidden'
                : isCompleted || (isCurrent && idx > 0)
                  ? 'bg-emerald-400'
                  : 'bg-slate-200';

            return (
              <div key={phase} className={`flex items-center ${wideConnectors && idx > 0 ? 'flex-1' : ''}`}>
                {idx > 0 && (
                  <span
                    className={`block h-1 rounded-full ${wideConnectors ? 'flex-1 min-w-[60px]' : 'w-10'} ${connectorClass}`}
                    aria-hidden="true"
                  />
                )}
                <div className="flex flex-col items-center gap-1 px-1.5">
                  <span
                    className={nodeCls}
                    title={
                      isCurrent
                        ? CASE_STATUS_LABELS[item.status]
                        : isCompleted
                          ? `${CASE_STATUS_PHASE_LABELS[phase]} — tamamlandı`
                          : CASE_STATUS_PHASE_LABELS[phase]
                    }
                    aria-label={
                      isCurrent
                        ? `${CASE_STATUS_PHASE_LABELS[phase]} — ${CASE_STATUS_LABELS[item.status]}`
                        : isCompleted
                          ? `${CASE_STATUS_PHASE_LABELS[phase]} (tamamlandı)`
                          : CASE_STATUS_PHASE_LABELS[phase]
                    }
                  >
                    {/* Cila-2 — node içinde ikon (renk + ikon birlikte, erişilebilirlik):
                        tamamlanan=Check, aktif=statünün kendi ikonu, gelecek=Flag (sönük) */}
                    {isCompleted ? (
                      <Check size={14} strokeWidth={3} aria-hidden="true" />
                    ) : isCurrent ? (
                      activeVisual.iconLg ?? activeVisual.icon
                    ) : (
                      <Flag size={12} strokeWidth={2} aria-hidden="true" />
                    )}
                  </span>
                  <span
                    className={`text-[11px] leading-none ${
                      isCurrent
                        ? 'font-medium text-slate-900 dark:text-ndark-text'
                        : isCompleted
                          ? 'text-slate-500 dark:text-ndark-muted'
                          : 'text-slate-400 dark:text-ndark-muted'
                    }`}
                  >
                    {CASE_STATUS_PHASE_LABELS[phase]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {/* Alt-durum notu — aktif fazın altında küçük sönük metin.
            Renk + ikon/metin birlikte: nokta rengi + bu metin tek başına da
            okunabilir bilgi taşır. */}
        {subStatusNote && (
          <div className="mt-0.5 flex justify-center">
            <span
              className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-ndark-muted"
              title={CASE_STATUS_LABELS[item.status]}
            >
              {activeVisual.icon}
              {subStatusNote}
            </span>
          </div>
        )}
      </div>

      {/* Dikey hairline — faz rayı / işlem ayrımı */}
      {allowed.length > 0 && (
        <span
          aria-hidden="true"
          className="hidden h-6 border-l border-slate-200 sm:block dark:border-ndark-border"
        />
      )}

      {/* Tek işlem kontrolü — "Durumu değiştir ▾" ghost link.
          Şekil/anlam ayrımı: durum = nokta+etiket (faz rayı); işlem = SÖNÜK
          link (border yok). Renkli statü diline karışmaz; menü içindeki
          hedeflerde sadece küçük dot hedef rengini taşır. */}
      {allowed.length > 0 && (
        <Popover
          trigger={({ open, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              disabled={!!directSubmitting}
              className={`inline-flex items-center gap-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                open
                  ? 'text-slate-900 dark:text-ndark-text'
                  : 'text-slate-600 hover:text-slate-900 dark:text-ndark-muted dark:hover:text-ndark-text'
              }`}
              title="Statü değiştir"
              aria-label="Durumu değiştir"
              aria-haspopup="menu"
              aria-expanded={open}
            >
              Durumu değiştir
              <ChevronDown size={12} />
              {directSubmitting && <span className="ml-0.5 animate-pulse">…</span>}
            </button>
          )}
          align="start"
          width={260}
          minWidth={260}
          usePortal
          nowrap
        >
          {({ close }) => (
            <ul className="py-1" role="menu" aria-label="Geçerli geçişler">
              {allowed.map((target) => {
                const v = STATUS_VISUAL[target];
                return (
                  <li key={target} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        handleClick(target);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-ndark-text dark:hover:bg-ndark-card"
                      title={
                        STATUS_REQUIRES_REASON[target]
                          ? `${CASE_STATUS_LABELS[target]} — gerekçe penceresi açılır`
                          : `${CASE_STATUS_LABELS[target]} olarak işaretle`
                      }
                    >
                      {/* Küçük renkli nokta — hedef statü rengi ipucu */}
                      <span
                        className={`flex h-2 w-2 shrink-0 rounded-full ${v.dotColor}`}
                        aria-hidden="true"
                      />
                      {/* Cila-3 (madde #4) — etiket = statü adı (CASE_STATUS_LABELS),
                          fiil değil. Sade + PR-C A9 ile tutarlı ("Eskale Edildi"). */}
                      <span className="flex-1 font-medium">{CASE_STATUS_LABELS[target]}</span>
                      {STATUS_REQUIRES_REASON[target] && (
                        <span
                          className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-slate-400"
                          aria-label="Gerekçe gerekir"
                        >
                          <AlertTriangle size={10} aria-hidden="true" />
                          gerekçe
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Popover>
      )}

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
