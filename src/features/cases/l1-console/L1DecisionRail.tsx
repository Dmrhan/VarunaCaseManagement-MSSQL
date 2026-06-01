/**
 * L1DecisionRail — Phase 2C.
 *
 * Right-rail intelligence + decision summary for the L1 Case
 * Resolution Console. All data comes from the case payload already
 * loaded by L1CaseResolutionConsole — no new backend calls in this
 * phase, no actions wired. Real RUNA actions / status / transfer
 * logic land in later phases via component reuse, not rewrite.
 *
 * Sections:
 *   1. RUNA AI                — aiSummary + confidence + follow-up
 *   2. Müşteri Durumu / Sağlık — case-type derived signals (Churn /
 *                                ProactiveTracking) + transferCount
 *   3. SLA / Zaman             — response/resolution due, paused state
 *   4. Kapanışa Hazırlık       — read-only checklist from case payload
 *   5. L2 Devre Hazırlık       — read-only checklist
 *
 * The "Analiz Et" / similar buttons render disabled with a `title`
 * tooltip pointing at the next phase, matching the L1CommandBar
 * placeholder pattern.
 */

import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  CircleAlert,
  Clock,
  HeartPulse,
  ShieldAlert,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { formatRelative } from '@/lib/format';
import type { Case } from '../types';

const PLACEHOLDER_TITLE = 'Sonraki L1 fazında bağlanacak (Phase 2D+).';

type CheckState = 'ok' | 'missing' | 'review';

function Section({
  title,
  icon,
  rightSlot,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 dark:border-ndark-border/60">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
          <span className="text-slate-500 dark:text-ndark-muted">{icon}</span>
          {title}
        </div>
        {rightSlot}
      </header>
      <div className="px-3 py-2.5 text-sm text-slate-700 dark:text-ndark-text">{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] italic text-slate-500 dark:text-ndark-muted">{children}</p>;
}

function PlaceholderNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-[11.5px] italic text-slate-500 dark:border-ndark-border/60 dark:bg-ndark-bg/30 dark:text-ndark-muted">
      {children}
    </p>
  );
}

function CheckItem({ label, state, hint }: { label: string; state: CheckState; hint?: string }) {
  const icon =
    state === 'ok' ? (
      <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" />
    ) : state === 'missing' ? (
      <XCircle size={13} className="text-rose-600 dark:text-rose-400" />
    ) : (
      <CircleAlert size={13} className="text-amber-600 dark:text-amber-400" />
    );
  const label2 =
    state === 'ok' ? 'Tamam' : state === 'missing' ? 'Eksik' : 'Kontrol et';
  const tint =
    state === 'ok'
      ? 'text-emerald-700 dark:text-emerald-300'
      : state === 'missing'
        ? 'text-rose-700 dark:text-rose-300'
        : 'text-amber-700 dark:text-amber-300';
  return (
    <li className="flex items-start gap-2 py-0.5">
      <span className="mt-0.5">{icon}</span>
      <span className="min-w-0 flex-1 text-[12.5px] text-slate-700 dark:text-ndark-text">
        {label}
        {hint && (
          <span className="ml-1 text-[11px] text-slate-400 dark:text-ndark-muted">— {hint}</span>
        )}
      </span>
      <span className={`shrink-0 text-[11px] font-medium uppercase tracking-wide ${tint}`}>
        {label2}
      </span>
    </li>
  );
}

export function L1DecisionRail({ item }: { item: Case }) {
  // ── RUNA derived ────────────────────────────────────────────────
  const aiConfidencePct =
    typeof item.aiConfidenceScore === 'number'
      ? Math.round(Math.max(0, Math.min(1, item.aiConfidenceScore)) * 100)
      : null;
  const hasAiAnalysis = !!(item.aiSummary || item.aiFollowupRecommendation);

  // ── Customer health derived ─────────────────────────────────────
  const isChurn = item.caseType === 'Churn';
  const isProactive = item.caseType === 'ProactiveTracking';
  const transferCountHigh = (item.transferCount ?? 0) >= 2;

  // ── Closure-readiness checklist ─────────────────────────────────
  const topNoteCount = item.notes.filter((n) => !n.parentNoteId).length;
  const closureItems: Array<{ label: string; state: CheckState; hint?: string }> = [
    {
      label: 'Problem açıklaması var',
      state: item.description?.trim() ? 'ok' : 'missing',
    },
    {
      label: 'Kategori / alt kategori seçilmiş',
      state: item.category && item.subCategory ? 'ok' : 'missing',
    },
    {
      label: 'Öncelik seçilmiş',
      state: item.priority ? 'ok' : 'missing',
    },
    {
      label: 'En az bir not var',
      state: topNoteCount > 0 ? 'ok' : 'missing',
    },
    {
      label: 'Dosya / kanıt var',
      state: item.files.length > 0 ? 'ok' : 'missing',
    },
    {
      label: 'Çözüm notu yazıldı',
      state: item.resolutionNote?.trim() ? 'ok' : 'review',
      hint: 'Çözüldü statüsüne taşımadan önce',
    },
    {
      label: 'Müşteri bilgilendirme durumu',
      state: 'review',
    },
  ];

  // ── L2 transfer-readiness checklist ─────────────────────────────
  const l2Items: Array<{ label: string; state: CheckState; hint?: string }> = [
    {
      label: 'Atanan takım / kişi var',
      state: item.assignedTeamId || item.assignedPersonId ? 'ok' : 'missing',
    },
    {
      label: 'Denenen çalışma notu var',
      state: topNoteCount > 0 ? 'ok' : 'missing',
    },
    {
      label: 'Kanıt / dosya var',
      state: item.files.length > 0 ? 'ok' : 'review',
    },
    {
      label: 'Öncelik ve talep türü net',
      state: item.priority && item.requestType ? 'ok' : 'missing',
    },
    {
      label: 'Devir nedeni',
      state: 'review',
      hint: 'Mevcut Devret akışından gelir',
    },
  ];

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto">
      {/* ─── 1. RUNA AI — first viewport priority ─── */}
      <Section
        title="RUNA AI"
        icon={<Brain size={13} />}
        rightSlot={
          aiConfidencePct !== null && (
            <span className="text-[11px] text-slate-500 dark:text-ndark-muted">
              Güven: <span className="font-medium text-slate-700 dark:text-ndark-text">{aiConfidencePct}%</span>
            </span>
          )
        }
      >
        {hasAiAnalysis ? (
          <div className="space-y-2">
            {item.aiSummary && (
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-700 dark:text-ndark-text">
                {item.aiSummary}
              </p>
            )}
            {item.aiFollowupRecommendation && (
              <div className="rounded-md border border-violet-200 bg-violet-50/60 px-2.5 py-1.5 text-[12px] text-violet-800 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-200">
                <span className="font-medium">Önerilen aksiyon: </span>
                {item.aiFollowupRecommendation}
              </div>
            )}
            {(item.aiCategoryPrediction || item.aiPriorityPrediction) && (
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {item.aiCategoryPrediction && (
                  <Badge tint="slate">AI Kategori: {item.aiCategoryPrediction}</Badge>
                )}
                {item.aiPriorityPrediction && (
                  <Badge tint="slate">AI Öncelik: {item.aiPriorityPrediction}</Badge>
                )}
              </div>
            )}
          </div>
        ) : (
          <EmptyLine>Bu vaka için henüz AI analizi yapılmadı.</EmptyLine>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled
            title={`${hasAiAnalysis ? 'Yeniden Analiz Et' : 'Analiz Et'} — ${PLACEHOLDER_TITLE}`}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-violet-300 bg-white px-2.5 text-[11.5px] font-medium text-violet-600 opacity-60 dark:border-violet-900/60 dark:bg-ndark-card dark:text-violet-300"
          >
            <Brain size={11} />
            {hasAiAnalysis ? 'Yeniden Analiz Et' : 'Analiz Et'}
          </button>
        </div>
      </Section>

      {/* ─── 2. Müşteri Durumu / Sağlık ─── */}
      <Section title="Müşteri Durumu / Sağlık" icon={<HeartPulse size={13} />}>
        <div className="space-y-1.5">
          {isChurn && (
            <>
              {item.cancellationRequest && (
                <div className="flex items-center gap-2 text-[12.5px]">
                  <AlertTriangle size={12} className="text-rose-500" />
                  <span className="text-rose-700 dark:text-rose-300">İptal talebi açık</span>
                </div>
              )}
              {item.churnResult && (
                <div className="flex flex-wrap items-baseline gap-1.5 text-[12.5px]">
                  <span className="text-slate-500 dark:text-ndark-muted">Churn sonucu:</span>
                  <span className="font-medium text-slate-700 dark:text-ndark-text">
                    {item.churnResult}
                  </span>
                </div>
              )}
              {item.retentionStatus && (
                <div className="flex flex-wrap items-baseline gap-1.5 text-[12.5px]">
                  <span className="text-slate-500 dark:text-ndark-muted">Tutma durumu:</span>
                  <span className="font-medium text-slate-700 dark:text-ndark-text">
                    {item.retentionStatus}
                  </span>
                </div>
              )}
              {item.aiRetentionOfferSuggestion && (
                <div className="rounded-md border border-violet-200 bg-violet-50/40 px-2.5 py-1 text-[11.5px] text-violet-800 dark:border-violet-900/40 dark:bg-violet-950/20 dark:text-violet-200">
                  <span className="font-medium">AI Elde Tutma Önerisi: </span>
                  {item.aiRetentionOfferSuggestion}
                </div>
              )}
            </>
          )}
          {isProactive && (
            <>
              {item.financialStatus && (
                <div className="flex flex-wrap items-baseline gap-1.5 text-[12.5px]">
                  <span className="text-slate-500 dark:text-ndark-muted">Finansal durum:</span>
                  <span className="font-medium text-slate-700 dark:text-ndark-text">
                    {item.financialStatus}
                  </span>
                </div>
              )}
              {item.productUsage && (
                <div className="flex flex-wrap items-baseline gap-1.5 text-[12.5px]">
                  <span className="text-slate-500 dark:text-ndark-muted">Ürün kullanımı:</span>
                  <span className="font-medium text-slate-700 dark:text-ndark-text">
                    {item.productUsage}
                  </span>
                </div>
              )}
              {item.usageChangeAlert && (
                <div className="flex flex-wrap items-baseline gap-1.5 text-[12.5px]">
                  <span className="text-slate-500 dark:text-ndark-muted">Kullanım sinyali:</span>
                  <span className="font-medium text-slate-700 dark:text-ndark-text">
                    {item.usageChangeAlert}
                  </span>
                </div>
              )}
            </>
          )}
          {transferCountHigh && (
            <div className="flex items-center gap-2 text-[12.5px]">
              <AlertTriangle size={12} className="text-amber-500" />
              <span className="text-amber-700 dark:text-amber-300">
                Devir sayısı: {item.transferCount} (yüksek)
              </span>
            </div>
          )}
          {!isChurn && !isProactive && !transferCountHigh && (
            <EmptyLine>Bu vaka türü için sağlık sinyali henüz yüklenmedi.</EmptyLine>
          )}
        </div>
        <PlaceholderNote>
          Müşteri Pulse paneli (Stable / Watch / Risky / Critical) mevcut bileşen reuse
          edilerek gelecek.
        </PlaceholderNote>
      </Section>

      {/* ─── 3. SLA / Zaman ─── */}
      <Section title="SLA / Zaman" icon={<Clock size={13} />}>
        <div className="space-y-1.5 text-[12.5px]">
          {item.slaViolation && (
            <div className="flex items-center gap-2">
              <ShieldAlert size={12} className="text-rose-600" />
              <span className="font-medium text-rose-700 dark:text-rose-300">SLA İhlali</span>
            </div>
          )}
          {item.slaPausedAt && (
            <div className="flex items-center gap-2">
              <Clock size={12} className="text-amber-500" />
              <span className="text-amber-700 dark:text-amber-300">
                Duraklatıldı {formatRelative(item.slaPausedAt)}
                {item.slaPausedDurationMin > 0 && ` · ${item.slaPausedDurationMin} dk`}
              </span>
            </div>
          )}
          {item.slaResponseDueAt && (
            <div className="flex flex-wrap items-baseline gap-1.5">
              <span className="text-slate-500 dark:text-ndark-muted">Yanıt SLA:</span>
              <span className="font-medium text-slate-700 dark:text-ndark-text">
                {formatRelative(item.slaResponseDueAt)}
              </span>
            </div>
          )}
          {item.slaResolutionDueAt && (
            <div className="flex flex-wrap items-baseline gap-1.5">
              <span className="text-slate-500 dark:text-ndark-muted">Çözüm SLA:</span>
              <span className="font-medium text-slate-700 dark:text-ndark-text">
                {formatRelative(item.slaResolutionDueAt)}
              </span>
            </div>
          )}
          {!item.slaResponseDueAt && !item.slaResolutionDueAt && !item.slaPausedAt && !item.slaViolation && (
            <EmptyLine>SLA süresi tanımlı değil.</EmptyLine>
          )}
        </div>
      </Section>

      {/* ─── 4. Kapanışa Hazırlık ─── */}
      <Section title="Kapanışa Hazırlık" icon={<CheckCircle2 size={13} />}>
        <ul className="divide-y divide-slate-100 dark:divide-ndark-border/60">
          {closureItems.map((it) => (
            <CheckItem key={it.label} label={it.label} state={it.state} hint={it.hint} />
          ))}
        </ul>
      </Section>

      {/* ─── 5. L2 Devre Hazırlık ─── */}
      <Section title="L2 Devre Hazırlık" icon={<UserPlus size={13} />}>
        <ul className="divide-y divide-slate-100 dark:divide-ndark-border/60">
          {l2Items.map((it) => (
            <CheckItem key={it.label} label={it.label} state={it.state} hint={it.hint} />
          ))}
        </ul>
      </Section>
    </div>
  );
}

export default L1DecisionRail;
