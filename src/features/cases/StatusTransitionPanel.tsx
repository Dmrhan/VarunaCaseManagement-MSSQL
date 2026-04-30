import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  Inbox,
  Lock,
  PauseCircle,
  RotateCw,
  Search as SearchIcon,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextArea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { RunaAiCard } from '@/components/ui/RunaAiCard';
import { caseService, lookupService } from '@/services/caseService';
import { aiService, aiErrorMessage } from '@/services/aiService';
import {
  CASE_STATUSES,
  ESCALATION_LEVELS,
  ESCALATION_LEVEL_LABELS,
  STATUS_TRANSITIONS,
  type Case,
  type CaseStatus,
  type EscalationLevel,
} from './types';

interface StatusTransitionPanelProps {
  item: Case;
  onApplied: (updated: Case) => void;
}

// Spec 11.1 renk paletiyle uyumlu kart tonları
const STATUS_META: Record<CaseStatus, {
  icon: ReactNode;
  description: string;
  requirement?: string;
  ring: string;
  bg: string;
  text: string;
  selectedRing: string;
}> = {
  'Açık': {
    icon: <Inbox size={18} />,
    description: 'Yeni oluşturuldu, atama bekliyor.',
    ring: 'ring-blue-200',
    bg: 'bg-blue-50/40',
    text: 'text-blue-700',
    selectedRing: 'ring-blue-500',
  },
  'İncelemede': {
    icon: <SearchIcon size={18} />,
    description: 'Aktif olarak işleniyor.',
    ring: 'ring-amber-200',
    bg: 'bg-amber-50/40',
    text: 'text-amber-700',
    selectedRing: 'ring-amber-500',
  },
  '3rdPartyBekleniyor': {
    icon: <PauseCircle size={18} />,
    description: '3. partiden cevap bekleniyor; SLA durur.',
    requirement: '3. parti seçimi',
    ring: 'ring-slate-200',
    bg: 'bg-slate-50/60',
    text: 'text-slate-700',
    selectedRing: 'ring-slate-500',
  },
  'Eskalasyon': {
    icon: <TrendingUp size={18} />,
    description: 'Üst yönetime yükseltildi.',
    requirement: 'Seviye + gerekçe',
    ring: 'ring-rose-200',
    bg: 'bg-rose-50/40',
    text: 'text-rose-700',
    selectedRing: 'ring-rose-500',
  },
  'Çözüldü': {
    icon: <CheckCircle2 size={18} />,
    description: 'Sorun çözümlendi.',
    requirement: 'Çözüm notu zorunlu',
    ring: 'ring-emerald-200',
    bg: 'bg-emerald-50/40',
    text: 'text-emerald-700',
    selectedRing: 'ring-emerald-500',
  },
  'YenidenAcildi': {
    icon: <RotateCw size={18} />,
    description: 'Müşteri çözümden memnun değil.',
    ring: 'ring-violet-200',
    bg: 'bg-violet-50/40',
    text: 'text-violet-700',
    selectedRing: 'ring-violet-500',
  },
  'İptalEdildi': {
    icon: <Ban size={18} />,
    description: 'Talep geri çekildi (terminal).',
    requirement: 'Gerekçe zorunlu',
    ring: 'ring-slate-200',
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    selectedRing: 'ring-slate-500',
  },
};

const STATUS_LABELS: Record<CaseStatus, string> = {
  'Açık':                'Açık',
  'İncelemede':          'İncelemede',
  '3rdPartyBekleniyor':  '3. Parti Bekleniyor',
  'Eskalasyon':          'Eskalasyon',
  'Çözüldü':             'Çözüldü',
  'YenidenAcildi':       'Yeniden Açıldı',
  'İptalEdildi':         'İptal Edildi',
};

export function StatusTransitionPanel({ item, onApplied }: StatusTransitionPanelProps) {
  const allowedTransitions = useMemo(() => STATUS_TRANSITIONS[item.status], [item.status]);

  const [pending, setPending] = useState<CaseStatus | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [thirdPartyId, setThirdPartyId] = useState('');
  const [escalationLevel, setEscalationLevel] = useState<EscalationLevel | ''>('');
  const [escalationReason, setEscalationReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const { toast } = useToast();

  const thirdParties = useMemo(() => lookupService.thirdParties(), []);

  // Vaka değişince akış sıfırlanır
  useEffect(() => {
    setPending(null);
    setResolutionNote('');
    setCancelReason('');
    setThirdPartyId('');
    setEscalationLevel('');
    setEscalationReason('');
    setError(null);
  }, [item.id]);

  async function handleDraftResolution() {
    setDrafting(true);
    const r = await aiService.draftResolution({
      caseSubject: item.title,
      description: item.description,
      caseType: item.caseType,
      category: item.category,
      history: item.history,
      notes: item.notes,
    });
    setDrafting(false);
    if (r.ok) {
      setResolutionNote(r.data.draft);
      toast({ type: 'success', message: 'Çözüm taslağı oluşturuldu.', duration: 1800 });
    } else {
      toast({ type: 'warn', message: aiErrorMessage(r.error), duration: 2500 });
    }
  }

  const requiresSupervisor =
    pending === 'Çözüldü' &&
    (item.priority === 'Critical' ||
      item.slaViolation ||
      item.escalationLevel === 'Direktör' ||
      item.escalationLevel === 'ÜstYönetim');

  function isCardDisabled(target: CaseStatus): boolean {
    if (target === item.status) return true;
    return !allowedTransitions.includes(target);
  }

  function selectCard(target: CaseStatus) {
    if (isCardDisabled(target)) return;
    if (pending === target) {
      setPending(null);
      return;
    }
    setPending(target);
    setError(null);
    setResolutionNote('');
    setCancelReason('');
    setThirdPartyId('');
    setEscalationLevel('');
    setEscalationReason('');
  }

  // FAZ 4 — Çözüldü transition için zorunlu kontrol listesi maddelerinin
  // tamamlanmış olması gerekir. Eksik varsa transition bloklanır.
  const requiredChecklistPending =
    item.checklistItems?.filter((it) => it.required && !it.checked) ?? [];

  function applyDisabled(): boolean {
    if (!pending) return true;
    if (pending === 'Çözüldü' && !resolutionNote.trim()) return true;
    if (pending === 'Çözüldü' && requiredChecklistPending.length > 0) return true;
    if (pending === 'İptalEdildi' && !cancelReason.trim()) return true;
    if (pending === '3rdPartyBekleniyor' && !thirdPartyId) return true;
    if (pending === 'Eskalasyon' && (!escalationLevel || !escalationReason.trim())) return true;
    return false;
  }

  async function handleApply() {
    if (!pending || submitting) return;
    setSubmitting(true);
    setError(null);
    const tp = thirdParties.find((t) => t.id === thirdPartyId);
    const updated = await caseService.transitionStatus(item.id, pending, {
      resolutionNote: pending === 'Çözüldü' ? resolutionNote.trim() : undefined,
      cancellationReason: pending === 'İptalEdildi' ? cancelReason.trim() : undefined,
      thirdPartyId: pending === '3rdPartyBekleniyor' ? tp?.id : undefined,
      thirdPartyName: pending === '3rdPartyBekleniyor' ? tp?.name : undefined,
      escalationLevel: pending === 'Eskalasyon' && escalationLevel ? (escalationLevel as EscalationLevel) : undefined,
      escalationReason: pending === 'Eskalasyon' ? escalationReason.trim() : undefined,
    });
    setSubmitting(false);
    if (updated) {
      toast({
        type: pending === 'Çözüldü' ? 'success' : pending === 'İptalEdildi' ? 'warn' : 'info',
        title: 'Statü güncellendi',
        message: `${updated.caseNumber} → ${STATUS_LABELS[pending]}`,
      });
      setPending(null);
      onApplied(updated);
    } else {
      setError('Statü değiştirilemedi.');
    }
  }

  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Statü Geçişi</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Mevcut statüden geçilebilen kartlar aktif. Diğerleri pasiftir.
          </p>
        </div>
        <Badge tint="slate">
          Şu an: <strong className="ml-1">{STATUS_LABELS[item.status]}</strong>
        </Badge>
      </div>

      {/* Status kart grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
        {CASE_STATUSES.map((status) => {
          const meta = STATUS_META[status];
          const isCurrent = status === item.status;
          const disabled = isCardDisabled(status);
          const selected = pending === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => selectCard(status)}
              disabled={disabled}
              className={`group relative flex flex-col items-start gap-1.5 rounded-lg p-3 text-left ring-1 ring-inset transition ${
                disabled
                  ? 'cursor-not-allowed bg-slate-50/40 opacity-50 ring-slate-200'
                  : `${meta.bg} ${meta.ring} hover:scale-[1.02] hover:shadow-sm`
              } ${
                selected
                  ? `ring-2 ring-offset-1 ${meta.selectedRing} shadow-md`
                  : ''
              }`}
              title={
                disabled && !isCurrent
                  ? `${item.status} → ${status} geçişi yok`
                  : isCurrent
                    ? 'Şu an bu statüdesin'
                    : `${status} statüsüne geç`
              }
            >
              <div className="flex w-full items-center justify-between">
                <span className={`flex h-7 w-7 items-center justify-center rounded-md ${meta.bg} ${meta.text}`}>
                  {meta.icon}
                </span>
                {disabled && !isCurrent && <Lock size={11} className="text-slate-400" />}
                {isCurrent && (
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-700">
                    Şu an
                  </span>
                )}
                {selected && !isCurrent && (
                  <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                    Seçildi
                  </span>
                )}
              </div>
              <div className={`text-sm font-semibold ${meta.text}`}>{STATUS_LABELS[status]}</div>
              <div className="text-[11px] leading-tight text-slate-600">{meta.description}</div>
              {meta.requirement && !disabled && (
                <span className="mt-auto rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  ⚠ {meta.requirement}
                </span>
              )}
              {disabled && !isCurrent && (
                <span className="mt-auto text-[10px] text-slate-400">Geçilemez</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Koşullu alanlar */}
      {pending && (
        <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-center gap-2">
            <ChevronRight size={14} className="text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {STATUS_LABELS[pending]} için zorunlu alanlar
            </span>
          </div>

          {pending === 'Çözüldü' && requiredChecklistPending.length > 0 && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
              <div className="mb-1 font-semibold">
                Vaka çözülmeden önce {requiredChecklistPending.length} zorunlu kontrol maddesi
                tamamlanmalı:
              </div>
              <ul className="ml-4 list-disc space-y-0.5">
                {requiredChecklistPending.map((it) => (
                  <li key={it.id}>{it.label}</li>
                ))}
              </ul>
              <div className="mt-1.5 text-[11px] text-rose-700 dark:text-rose-300">
                Detay sekmesindeki <strong>Kontrol Listesi</strong> bölümünden işaretleyebilirsiniz.
              </div>
            </div>
          )}

          {pending === 'Çözüldü' && (
            <>
              <RunaAiCard
                title="Çözüm Notu Taslağı"
                body={
                  resolutionNote
                    ? 'Taslak alana yazıldı; düzenleyebilirsiniz veya yeni bir taslak üretebilirsiniz.'
                    : 'Vaka geçmişine ve notlara bakarak müşteri dostu bir çözüm notu önerilir.'
                }
                isLoading={drafting}
                primaryAction={{
                  label: resolutionNote ? '✦ Yeniden Üret' : '✦ Taslak Üret',
                  onClick: () => void handleDraftResolution(),
                  disabled: drafting,
                }}
              />
              <Field
                label="Çözüm Notu"
                required
                actions={
                  <VoiceNoteButton
                    onTranscript={(chunk) =>
                      setResolutionNote((t) => (t ? `${t} ${chunk}` : chunk))
                    }
                  />
                }
              >
                <TextArea
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="Sorunun nasıl çözüldüğünü açıklayın…"
                  rows={3}
                />
              </Field>
            </>
          )}

          {pending === 'İptalEdildi' && (
            <Field
              label="İptal Gerekçesi"
              required
              actions={
                <VoiceNoteButton
                  onTranscript={(chunk) =>
                    setCancelReason((t) => (t ? `${t} ${chunk}` : chunk))
                  }
                />
              }
            >
              <TextArea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="İptal sebebini yazın…"
                rows={2}
              />
            </Field>
          )}

          {pending === '3rdPartyBekleniyor' && (
            <Field label="Beklenen 3. Parti" required hint="Bu süreçte SLA sayacı duraklatılır.">
              <Select value={thirdPartyId} onChange={(e) => setThirdPartyId(e.target.value)}>
                <option value="">Seçin…</option>
                {thirdParties.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {pending === 'Eskalasyon' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Eskalasyon Seviyesi" required>
                <Select
                  value={escalationLevel}
                  onChange={(e) => setEscalationLevel(e.target.value as EscalationLevel | '')}
                >
                  <option value="">Seçin…</option>
                  {ESCALATION_LEVELS.filter((l) => l !== 'Yok').map((l) => (
                    <option key={l} value={l}>
                      {ESCALATION_LEVEL_LABELS[l]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Gerekçe"
                required
                className="sm:row-span-1"
                actions={
                  <VoiceNoteButton
                    onTranscript={(chunk) =>
                      setEscalationReason((t) => (t ? `${t} ${chunk}` : chunk))
                    }
                  />
                }
              >
                <TextArea
                  value={escalationReason}
                  onChange={(e) => setEscalationReason(e.target.value)}
                  placeholder="Eskalasyon sebebini açıklayın…"
                  rows={2}
                />
              </Field>
            </div>
          )}

          {requiresSupervisor && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Çözüldü geçişi <strong>Supervisor onayı</strong> gerektiriyor (Critical / SLA ihlali /
                yüksek eskalasyon). FAZ 0'da onay simülasyonludur — geçiş yine de uygulanır.
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setPending(null)} disabled={submitting}>
              Vazgeç
            </Button>
            <Button
              size="sm"
              disabled={applyDisabled() || submitting}
              onClick={handleApply}
              rightIcon={<ChevronRight size={14} />}
            >
              {submitting ? 'Uygulanıyor…' : 'Uygula'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
