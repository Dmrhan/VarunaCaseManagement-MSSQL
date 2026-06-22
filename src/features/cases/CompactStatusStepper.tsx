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
    /** Ring + bg + text utilitileri (aktif/buton stillerinde paylaşılır) */
    nodeBg: string;
    nodeRing: string;
    nodeText: string;
    /** Button (aksiyon satırı) tint (hedef statünün rengini taşır) */
    btnBg: string;
    btnHoverBg: string;
    btnText: string;
    btnRing: string;
    /** Alt-durum rozeti chip */
    chipBg: string;
    chipText: string;
  }
> = {
  'Açık': {
    icon: <Inbox size={13} />,
    nodeBg: 'bg-blue-50',
    nodeRing: 'ring-blue-200',
    nodeText: 'text-blue-700',
    btnBg: 'bg-blue-50',
    btnHoverBg: 'hover:bg-blue-100',
    btnText: 'text-blue-700',
    btnRing: 'ring-blue-200',
    chipBg: 'bg-blue-50',
    chipText: 'text-blue-700',
  },
  'İncelemede': {
    icon: <SearchIcon size={13} />,
    nodeBg: 'bg-amber-50',
    nodeRing: 'ring-amber-200',
    nodeText: 'text-amber-700',
    btnBg: 'bg-amber-50',
    btnHoverBg: 'hover:bg-amber-100',
    btnText: 'text-amber-700',
    btnRing: 'ring-amber-200',
    chipBg: 'bg-amber-50',
    chipText: 'text-amber-700',
  },
  '3rdPartyBekleniyor': {
    icon: <PauseCircle size={13} />,
    nodeBg: 'bg-slate-100',
    nodeRing: 'ring-slate-300',
    nodeText: 'text-slate-700',
    btnBg: 'bg-slate-100',
    btnHoverBg: 'hover:bg-slate-200',
    btnText: 'text-slate-700',
    btnRing: 'ring-slate-300',
    chipBg: 'bg-slate-100',
    chipText: 'text-slate-700',
  },
  'Eskalasyon': {
    icon: <TrendingUp size={13} />,
    nodeBg: 'bg-rose-50',
    nodeRing: 'ring-rose-300',
    nodeText: 'text-rose-700',
    btnBg: 'bg-rose-50',
    btnHoverBg: 'hover:bg-rose-100',
    btnText: 'text-rose-700',
    btnRing: 'ring-rose-300',
    chipBg: 'bg-rose-50',
    chipText: 'text-rose-700',
  },
  'YenidenAcildi': {
    icon: <RotateCw size={13} />,
    nodeBg: 'bg-violet-50',
    nodeRing: 'ring-violet-300',
    nodeText: 'text-violet-700',
    btnBg: 'bg-violet-50',
    btnHoverBg: 'hover:bg-violet-100',
    btnText: 'text-violet-700',
    btnRing: 'ring-violet-300',
    chipBg: 'bg-violet-50',
    chipText: 'text-violet-700',
  },
  'Çözüldü': {
    icon: <CheckCircle2 size={13} />,
    nodeBg: 'bg-emerald-50',
    nodeRing: 'ring-emerald-300',
    nodeText: 'text-emerald-700',
    btnBg: 'bg-emerald-50',
    btnHoverBg: 'hover:bg-emerald-100',
    btnText: 'text-emerald-700',
    btnRing: 'ring-emerald-300',
    chipBg: 'bg-emerald-50',
    chipText: 'text-emerald-700',
  },
  'İptalEdildi': {
    icon: <Ban size={13} />,
    nodeBg: 'bg-slate-100',
    nodeRing: 'ring-slate-300',
    nodeText: 'text-slate-600',
    btnBg: 'bg-slate-100',
    btnHoverBg: 'hover:bg-slate-200',
    btnText: 'text-slate-600',
    btnRing: 'ring-slate-300',
    chipBg: 'bg-slate-100',
    chipText: 'text-slate-600',
  },
};

const PHASE_ORDER: Record<CaseStatusPhase, number> = {
  open: 0,
  in_progress: 1,
  result: 2,
};

/**
 * Faz başına temsil edici statü ikonu/teması (alt-durum yokken kullanılır).
 * Aktif fazda gerçek statünün görseli + alt-durum chip'i öne çıkar; bu yalnız
 * tamamlanan/gelecek fazlar için fallback.
 */
const PHASE_FALLBACK_STATUS: Record<CaseStatusPhase, CaseStatus> = {
  open: 'Açık',
  in_progress: 'İncelemede',
  result: 'Çözüldü',
};

/** Aksiyon satırında en sık görülen 2 hedef öne, gerisi "⋯" menüsüne. */
const PRIMARY_LIMIT = 2;

export function CompactStatusStepper({ item, onApplied }: CompactStatusStepperProps) {
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

  const primary = allowed.slice(0, PRIMARY_LIMIT);
  const overflow = allowed.slice(PRIMARY_LIMIT);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {/* Çizgi: 3 faz omurgası */}
      <div className="flex items-center gap-1.5" role="group" aria-label="Vaka statü adımları">
        {CASE_STATUS_PHASES.map((phase, idx) => {
          const isCurrent = phase === currentPhase;
          const isCompleted = idx < currentPhaseIdx;
          const isFuture = idx > currentPhaseIdx;

          // Aktif faz görseli mevcut statüden alınır → alt-durum rengini yansıtır.
          // Tamamlanan/gelecek fazlarda fallback temsili statü kullanılır.
          const visualStatus: CaseStatus = isCurrent
            ? item.status
            : PHASE_FALLBACK_STATUS[phase];
          const v = STATUS_VISUAL[visualStatus];

          // Tamamlanan node yeşil + check; gelecek nötr; aktif kendi rengi.
          const nodeBg = isCompleted
            ? 'bg-emerald-100 ring-emerald-300 text-emerald-700'
            : isFuture
              ? 'bg-slate-50 ring-slate-200 text-slate-400'
              : `${v.nodeBg} ${v.nodeRing} ${v.nodeText}`;

          // Bağlantı çizgisi: önceki fazlar arası tamamlandıysa yeşil.
          const connectorClass =
            idx === 0
              ? 'hidden'
              : isCompleted || (isCurrent && idx > 0)
                ? 'bg-emerald-400'
                : 'bg-slate-200';

          return (
            <div key={phase} className="flex items-center gap-1.5">
              {idx > 0 && <span className={`block h-0.5 w-6 rounded ${connectorClass}`} />}
              <div className="flex flex-col items-center gap-0.5">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full ring-1 ring-inset ${nodeBg}`}
                  aria-label={`${CASE_STATUS_PHASE_LABELS[phase]} fazı${
                    isCurrent ? ` — ${CASE_STATUS_LABELS[item.status]}` : isCompleted ? ' (tamamlandı)' : ''
                  }`}
                  title={
                    isCurrent
                      ? CASE_STATUS_LABELS[item.status]
                      : isCompleted
                        ? `${CASE_STATUS_PHASE_LABELS[phase]} — tamamlandı`
                        : CASE_STATUS_PHASE_LABELS[phase]
                  }
                >
                  {isCompleted ? <Check size={13} /> : v.icon}
                </span>
                <span
                  className={`text-[10px] font-medium ${
                    isCurrent ? v.nodeText : isCompleted ? 'text-emerald-700' : 'text-slate-400'
                  }`}
                >
                  {CASE_STATUS_PHASE_LABELS[phase]}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Alt-durum rozeti (yalnız aktif fazda mevcut statü "fallback" değilse) */}
      {item.status !== PHASE_FALLBACK_STATUS[currentPhase] && (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_VISUAL[item.status].chipBg} ${STATUS_VISUAL[item.status].chipText} ${STATUS_VISUAL[item.status].nodeRing}`}
          title={CASE_STATUS_LABELS[item.status]}
        >
          {STATUS_VISUAL[item.status].icon}
          {CASE_STATUS_LABELS[item.status]}
        </span>
      )}

      {/* Aksiyon satırı — geçerli geçişler */}
      {primary.length > 0 && (
        <div className="flex items-center gap-1.5">
          {primary.map((target) => {
            const v = STATUS_VISUAL[target];
            const submitting = directSubmitting === target;
            return (
              <button
                key={target}
                type="button"
                onClick={() => handleClick(target)}
                disabled={!!directSubmitting}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-50 ${v.btnBg} ${v.btnHoverBg} ${v.btnText} ${v.btnRing}`}
                title={
                  STATUS_REQUIRES_REASON[target]
                    ? `${CASE_STATUS_LABELS[target]} — gerekçe penceresi açılır`
                    : `${CASE_STATUS_LABELS[target]} olarak işaretle`
                }
              >
                {v.icon}
                {CASE_STATUS_LABELS[target]}
                {STATUS_REQUIRES_REASON[target] && (
                  <AlertTriangle size={10} className="text-slate-500" aria-hidden="true" />
                )}
                {submitting && <span className="ml-0.5 animate-pulse">…</span>}
              </button>
            );
          })}

          {/* Taşma menüsü */}
          {overflow.length > 0 && (
            <Popover
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className={`inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 ${open ? 'ring-slate-400' : ''}`}
                  title="Diğer geçişler"
                  aria-label="Diğer geçişler"
                >
                  Daha fazla
                  <ChevronDown size={11} />
                </button>
              )}
              align="end"
              width={220}
            >
              {({ close }) => (
                <ul className="py-1">
                  {overflow.map((target) => {
                    const v = STATUS_VISUAL[target];
                    return (
                      <li key={target}>
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            handleClick(target);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${v.btnText}`}
                        >
                          {v.icon}
                          <span className="flex-1">{CASE_STATUS_LABELS[target]}</span>
                          {STATUS_REQUIRES_REASON[target] && (
                            <AlertTriangle size={10} className="text-slate-500" aria-hidden="true" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Popover>
          )}
        </div>
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
            onApplied={(updated) => {
              setReasonTarget(null);
              onApplied(updated);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
