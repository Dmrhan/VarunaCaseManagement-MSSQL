import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Send,
  ShieldCheck,
  ShieldX,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, TextArea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import {
  approvalService,
  type ApprovalState,
  type CaseApprovalsResponse,
  type CaseResolutionApproval,
} from '@/services/approvalService';
import type { Case } from '../types';

/**
 * WR-D4 Phase 1 — Çözüm Onayı kartı.
 *
 * CaseDetail içinde StatusTransitionPanel'in altında render edilir. Yalnız:
 *  - Vakaya eşleşen aktif politika varsa görünür (matchedPolicy null ise hiç
 *    görünmez — fazla gürültü olmasın).
 *  - Phase 1 NO external sending — submit yalnızca yerel state üretir, mail
 *    veya SMS giden yer yoktur (planning card §16).
 *
 * Yetki:
 *  - Submit: case'i çözen taraf (Agent, Backoffice, CSM, Supervisor, Admin,
 *    SystemAdmin). BE allowSelfApprove kontrolünü uygular.
 *  - Approve/Reject: beklenen onaylayıcı (expectedApprover.personId == user.personId)
 *    veya SystemAdmin override.
 *
 * State refresh: parent kendisinin onChange hook'unu vermez; component
 * `onApprovalChanged` callback'i üzerinden parent'a "vaka tazele" sinyali
 * iletir (CaseDetailPage zaten onTransitionApplied benzeri hook tutuyor).
 */
export function ResolutionApprovalCard({
  item,
  onApprovalChanged,
}: {
  item: Case;
  onApprovalChanged?: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<CaseApprovalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    const r = await approvalService.getCaseApprovals(item.id);
    setLoading(false);
    setData(r ?? null);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  if (loading) return null;
  if (!data || !data.matchedPolicy) return null;

  const policy = data.matchedPolicy;
  const pendingApproval =
    data.approvals.find((a) => a.state === 'Pending') ?? null;
  const lastApproval = data.approvals[0] ?? null;
  const state: ApprovalState | null = data.approvalState;

  const canApprove =
    pendingApproval &&
    user?.personId &&
    data.expectedApprover?.personId === user.personId;
  const canOverride = pendingApproval && user?.role === 'SystemAdmin';

  async function handleSubmit() {
    if (!summary.trim()) return;
    setBusy(true);
    const r = await approvalService.submit(item.id, {
      resolutionSummary: summary.trim(),
    });
    setBusy(false);
    if (r) {
      toast({ type: 'success', message: 'Çözüm onaya gönderildi.', duration: 2200 });
      setSubmitOpen(false);
      setSummary('');
      await refresh();
      onApprovalChanged?.();
    }
  }

  async function handleApprove() {
    if (!pendingApproval) return;
    setBusy(true);
    const r = await approvalService.approve(pendingApproval.id, {
      override: !canApprove && canOverride ? true : undefined,
    });
    setBusy(false);
    if (r) {
      toast({ type: 'success', message: 'Çözüm onaylandı.', duration: 2200 });
      await refresh();
      onApprovalChanged?.();
    }
  }

  async function handleReject() {
    if (!pendingApproval) return;
    if (!rejectionReason.trim()) return;
    setBusy(true);
    const r = await approvalService.reject(pendingApproval.id, {
      rejectionReason: rejectionReason.trim(),
      override: !canApprove && canOverride ? true : undefined,
    });
    setBusy(false);
    if (r) {
      toast({ type: 'warn', message: 'Çözüm reddedildi.', duration: 2200 });
      setRejectOpen(false);
      setRejectionReason('');
      await refresh();
      onApprovalChanged?.();
    }
  }

  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-ndark-card dark:ring-ndark-border">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-violet-600 dark:text-violet-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">
            Çözüm Onayı
          </h3>
          <Badge tint="violet">{policy.name}</Badge>
        </div>
        <StateBadge state={state} />
      </div>

      {state === 'Pending' && pendingApproval && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <Clock size={14} className="mt-0.5 shrink-0" />
            <div className="space-y-1">
              <div>
                <strong>Çözüm Onayı Bekliyor.</strong> Vaka kapatılamaz; önce onay
                gelmeli.
              </div>
              <div className="text-[11px] text-amber-700 dark:text-amber-300">
                Gönderim: {fmtDate(pendingApproval.submittedAt)} · Politika:{' '}
                {pendingApproval.policyNameSnapshot}
              </div>
            </div>
          </div>
        </div>
      )}

      {state === 'Approved' && lastApproval && lastApproval.state === 'Approved' && (
        <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <div>
              <strong>Çözüm Onaylandı.</strong> Vaka artık kapatılabilir.
              <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
                Karar: {fmtDate(lastApproval.decidedAt)} · Politika:{' '}
                {lastApproval.policyNameSnapshot}
              </div>
            </div>
          </div>
        </div>
      )}

      {state === 'Rejected' && lastApproval && lastApproval.state === 'Rejected' && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <div className="flex items-start gap-2">
            <XCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <strong>Çözüm Reddedildi.</strong>{' '}
              {lastApproval.rejectionReason ?? 'Gerekçe yok.'}
              <div className="text-[11px] text-rose-700 dark:text-rose-300">
                Karar: {fmtDate(lastApproval.decidedAt)}. Düzeltme yapıp yeniden
                onaya gönderebilirsiniz.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      {state !== 'Pending' && item.status !== 'Çözüldü' && item.status !== 'İptalEdildi' && (
        <div>
          {!submitOpen ? (
            <Button
              size="sm"
              leftIcon={<Send size={12} />}
              onClick={() => setSubmitOpen(true)}
            >
              {state === 'Rejected' ? 'Yeniden Onaya Gönder' : 'Çözüm Onayına Gönder'}
            </Button>
          ) : (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-ndark-border dark:bg-ndark-bg/40">
              <Field label="Çözüm özeti" required>
                <TextArea
                  rows={3}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Onaylayıcının görmesini istediğiniz çözüm özetini yazın."
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSubmitOpen(false)} disabled={busy}>
                  Vazgeç
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleSubmit()}
                  disabled={busy || !summary.trim()}
                >
                  {busy ? 'Gönderiliyor…' : 'Gönder'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {state === 'Pending' && pendingApproval && (
        <div className="space-y-2">
          {pendingApproval.resolutionSummary && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-muted">
              <div className="mb-0.5 font-semibold text-slate-800 dark:text-ndark-text">
                Gönderilen Çözüm Özeti
              </div>
              {pendingApproval.resolutionSummary}
            </div>
          )}

          {(canApprove || canOverride) && !rejectOpen && (
            <div className="flex gap-2">
              <Button
                size="sm"
                leftIcon={<CheckCircle2 size={12} />}
                onClick={() => void handleApprove()}
                disabled={busy}
              >
                {canApprove ? 'Onayla' : 'Override Onayla'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                leftIcon={<ShieldX size={12} />}
                onClick={() => setRejectOpen(true)}
                disabled={busy}
              >
                Reddet
              </Button>
            </div>
          )}

          {rejectOpen && (
            <div className="space-y-2 rounded-md border border-rose-200 bg-rose-50/40 p-3 dark:border-rose-900/50 dark:bg-rose-950/20">
              <Field label="Red gerekçesi" required>
                <TextArea
                  rows={3}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Neden onaylamadığınızı yazın — onayı bekleyen taraf görür."
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setRejectOpen(false)} disabled={busy}>
                  Vazgeç
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleReject()}
                  disabled={busy || !rejectionReason.trim()}
                >
                  {busy ? 'Reddediliyor…' : 'Reddet'}
                </Button>
              </div>
            </div>
          )}

          {!canApprove && !canOverride && (
            <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-ndark-muted">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              Onaylama yetkin yok — kararı beklenen onaylayıcı verebilir.
            </div>
          )}
        </div>
      )}

      {/* History — son 3 */}
      {data.approvals.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-slate-500 dark:text-ndark-muted">
            Onay Geçmişi ({data.approvals.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {data.approvals.slice(0, 5).map((a) => (
              <HistoryRow key={a.id} a={a} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function StateBadge({ state }: { state: ApprovalState | null }) {
  if (state === 'Pending') return <Badge tint="amber">Çözüm Onayı Bekliyor</Badge>;
  if (state === 'Approved') return <Badge tint="emerald">Çözüm Onaylandı</Badge>;
  if (state === 'Rejected') return <Badge tint="rose">Çözüm Reddedildi</Badge>;
  return null;
}

function HistoryRow({ a }: { a: CaseResolutionApproval }) {
  const stateLabel =
    a.state === 'Approved' ? 'Onaylandı' : a.state === 'Rejected' ? 'Reddedildi' : 'Bekliyor';
  return (
    <li className="rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-slate-700 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-muted">
      <div className="flex justify-between gap-2">
        <span className="font-medium">{stateLabel}</span>
        <span className="text-[10px] text-slate-400">{fmtDate(a.decidedAt ?? a.submittedAt)}</span>
      </div>
      <div className="text-[11px] text-slate-500 dark:text-ndark-muted">
        {a.policyNameSnapshot}
      </div>
      {a.rejectionReason && <div className="text-[11px] text-rose-700">{a.rejectionReason}</div>}
    </li>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
