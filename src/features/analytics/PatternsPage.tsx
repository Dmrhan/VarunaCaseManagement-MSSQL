import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BellOff,
  Bookmark,
  Brain,
  Building2,
  Info,
  Layers,
  Link2,
  Package,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
  Type,
  Users,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextArea } from '@/components/ui/Field';
import { lookupService } from '@/services/caseService';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { formatRelative } from '@/lib/format';
import {
  analyticsService,
  type PatternAlert,
  type PatternInsight,
  type PatternThreadKeyword,
  type PatternThreadValue,
} from '@/services/analyticsService';

/**
 * Örüntü Alarmları — manalı triage kartı (PR-1).
 *
 * Cron her 15 dk: son 60 dk'da aynı kategoride 5+ vaka → PatternAlert.
 * Bu ekran "sayaç" yerine BAĞLAMLI sinyal gösterir:
 *  - Ortak iplik (≥%60 baskınlık): ana firma / ürün / anahtar kelime
 *  - Baseline/spike: bu kategorinin son 7g normal hızı ile şimdiki kıyas
 *  - Etki: kaç bayi etkilendi, SLA riskinde kaç vaka, açık vaka sayısı
 *  - Severity: spike ≥5x veya slaAtRisk ≥3 → critical; ≥2x veya ≥1 → warning
 *
 * Read-only — otomatik aksiyon YOK; agent karar verir (PR-2'de aksiyonlar).
 *
 * Erişim: Supervisor / Admin / SystemAdmin (sidebar koşullu render +
 * backend rol kontrolü GET /api/analytics/patterns).
 */

interface PatternsPageProps {
  /** Vakaları Gör tıklamasında parent App'e bildir — case list'e filtre uygulasın. */
  onShowCases?: (caseIds: string[], category: string) => void;
}

const SEVERITY_STYLES: Record<
  'critical' | 'warning' | 'info',
  { card: string; icon: string; label: string }
> = {
  critical: {
    card: 'border-rose-300 bg-rose-50 ring-1 ring-rose-200 dark:border-rose-900/50 dark:bg-rose-950/30 dark:ring-rose-900/50',
    icon: 'bg-rose-200 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
    label: 'Kritik',
  },
  warning: {
    card: 'border-amber-300 bg-amber-50 ring-1 ring-amber-200 dark:border-amber-900/50 dark:bg-amber-950/30 dark:ring-amber-900/50',
    icon: 'bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    label: 'Uyarı',
  },
  info: {
    card: 'border-sky-300 bg-sky-50 ring-1 ring-sky-200 dark:border-sky-900/50 dark:bg-sky-950/30 dark:ring-sky-900/50',
    icon: 'bg-sky-200 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
    label: 'Bilgi',
  },
};

type ActionModal =
  | { kind: 'link'; alert: PatternAlert }
  | { kind: 'notify'; alert: PatternAlert }
  | null;

export function PatternsPage({ onShowCases }: PatternsPageProps) {
  const [items, setItems] = useState<PatternAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = await analyticsService.listPatterns('active');
      setItems(list);
    } catch (e) {
      setError((e as Error).message ?? 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleDismiss(alert: PatternAlert) {
    setBusyId(alert.id);
    const r = await analyticsService.setPatternStatus(alert.id, 'dismissed');
    setBusyId(null);
    if (r) {
      toast({ type: 'success', message: `Alarm kapatıldı: ${alert.category}` });
      window.dispatchEvent(new CustomEvent('app:patterns-changed'));
      void refresh();
    }
  }

  async function handleKnownIssue(alert: PatternAlert) {
    setBusyId(alert.id);
    const r = await analyticsService.setPatternStatus(alert.id, 'known_issue');
    setBusyId(null);
    if (r) {
      toast({ type: 'success', message: `Bilinen sorun olarak işaretlendi: ${alert.category}` });
      window.dispatchEvent(new CustomEvent('app:patterns-changed'));
      void refresh();
    }
  }

  async function handleLinkSubmit(alert: PatternAlert, masterCaseId: string) {
    setBusyId(alert.id);
    const r = await analyticsService.linkPatternCases(alert.id, { masterCaseId });
    setBusyId(null);
    if (r?.ok) {
      const skippedNote = r.skipped.length > 0 ? ` (${r.skipped.length} vaka atlandı)` : '';
      toast({
        type: 'success',
        message: `${r.linkedCount} vaka ana vakaya bağlandı${skippedNote}.`,
      });
      setActionModal(null);
      void refresh();
    }
  }

  async function handleNotifySubmit(alert: PatternAlert, teamId: string, message: string) {
    setBusyId(alert.id);
    const r = await analyticsService.notifyPatternTeam(alert.id, { teamId, message });
    setBusyId(null);
    if (r?.ok) {
      toast({ type: 'success', message: `Takıma bildirildi: ${r.teamName}` });
      setActionModal(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-ndark-text">
            Örüntü Alarmları
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-ndark-muted">
            Son 60 dakikada aynı kategoride 5+ vaka açıldığında otomatik tetiklenir.
            Otomatik vaka açmaz — yalnız sinyal + bağlam gösterir. Agent karar verir.
          </p>
        </div>
        <Button variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => void refresh()}>
          Yenile
        </Button>
      </div>

      {/* Help banner — spike + severity terimlerini açıkla */}
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted">
        <div className="flex items-start gap-2">
          <Info size={14} className="mt-0.5 shrink-0" />
          <div>
            <strong>Spike</strong>: bu kategorinin son 7 günlük normal hızına göre kaç kat.{' '}
            <strong>Yeni kategori</strong> = baseline yok, kıyas yapılamaz.{' '}
            <strong>Ortak iplik</strong>: vakaların ≥%60'ında paylaşılan ana firma / ürün / anahtar kelime.
            Kart kendisi karar değil; agent ana vakaya bağlayabilir, takıma bildirebilir veya kapatabilir.
          </div>
        </div>
      </div>

      {error && (
        <Card>
          <CardBody>
            <div className="text-sm text-rose-700 dark:text-rose-300">{error}</div>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={refresh}>
                Tekrar dene
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {loading && items.length === 0 && (
        <Card>
          <CardBody>
            <div className="h-20 animate-pulse rounded bg-slate-100 dark:bg-ndark-bg" />
          </CardBody>
        </Card>
      )}

      {!loading && !error && items.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Sparkles size={22} />}
              title="Aktif örüntü alarmı yok"
              description="Sistem 15 dakikada bir kontrol eder. Anormal yoğunluk olduğunda burada bağlamlı bir kart çıkar."
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {items.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              busy={busyId === alert.id}
              onDismiss={() => handleDismiss(alert)}
              onKnownIssue={() => handleKnownIssue(alert)}
              onLink={() => setActionModal({ kind: 'link', alert })}
              onNotify={() => setActionModal({ kind: 'notify', alert })}
              onShowCases={onShowCases}
            />
          ))}
        </div>
      )}

      {actionModal?.kind === 'link' && (
        <LinkModal
          alert={actionModal.alert}
          busy={busyId === actionModal.alert.id}
          onClose={() => setActionModal(null)}
          onSubmit={(master) => handleLinkSubmit(actionModal.alert, master)}
        />
      )}
      {actionModal?.kind === 'notify' && (
        <NotifyModal
          alert={actionModal.alert}
          busy={busyId === actionModal.alert.id}
          onClose={() => setActionModal(null)}
          onSubmit={(teamId, msg) => handleNotifySubmit(actionModal.alert, teamId, msg)}
        />
      )}
    </div>
  );
}

function AlertCard({
  alert,
  busy,
  onDismiss,
  onKnownIssue,
  onLink,
  onNotify,
  onShowCases,
}: {
  alert: PatternAlert;
  busy: boolean;
  onDismiss: () => void;
  onKnownIssue: () => void;
  onLink: () => void;
  onNotify: () => void;
  onShowCases?: (caseIds: string[], category: string) => void;
}) {
  const insight = alert.insight ?? null;
  const severity = insight?.severity ?? 'warning';
  const style = SEVERITY_STYLES[severity];

  const title = buildTitle(alert, insight);

  return (
    <div className={`rounded-xl border p-4 ${style.card}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${style.icon}`}>
          <AlertTriangle size={16} />
        </div>
        <div className="min-w-0 flex-1">
          {/* Başlık + severity + zaman */}
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-base font-semibold text-slate-900 dark:text-ndark-text">
              {title}
            </h2>
            <span className="shrink-0 text-xs text-slate-600 dark:text-ndark-muted">
              {formatRelative(alert.detectedAt)}
            </span>
          </div>

          {/* N vaka + spike rozeti */}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <Badge tint="slate">{alert.caseCount} vaka</Badge>
            <SpikeBadge insight={insight} />
            <Badge tint="slate" className="text-[11px]">
              <Layers size={10} className="mr-0.5 inline" /> {alert.category}
            </Badge>
            <span className="text-xs text-slate-500 dark:text-ndark-muted">
              {alert.windowMinutes} dk pencerede
            </span>
          </div>

          {/* Etki metrikleri */}
          {insight && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <ImpactKpi
                icon={<Users size={12} />}
                label="Etkilenen müşteri"
                value={insight.impact.distinctAccounts}
              />
              <ImpactKpi
                icon={<AlertTriangle size={12} />}
                label="SLA riskinde"
                value={insight.impact.slaAtRisk}
                accent={insight.impact.slaAtRisk > 0 ? 'rose' : undefined}
              />
              <ImpactKpi
                icon={<TrendingUp size={12} />}
                label="Açık vaka"
                value={insight.impact.openCount}
              />
            </div>
          )}

          {/* Ortak iplik chip'leri */}
          {insight && hasAnyThread(insight) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-600 dark:text-ndark-muted">
                Ortak iplik:
              </span>
              {insight.commonThread.topAnaFirma && (
                <ThreadChip
                  icon={<Building2 size={11} />}
                  prefix="Ana firma"
                  value={insight.commonThread.topAnaFirma.name}
                  count={insight.commonThread.topAnaFirma.count}
                  total={insight.commonThread.topAnaFirma.total}
                  dominance={insight.commonThread.topAnaFirma.dominance}
                />
              )}
              {insight.commonThread.topProduct && (
                <ThreadChip
                  icon={<Package size={11} />}
                  prefix="Ürün"
                  value={insight.commonThread.topProduct.name}
                  count={insight.commonThread.topProduct.count}
                  total={insight.commonThread.topProduct.total}
                  dominance={insight.commonThread.topProduct.dominance}
                />
              )}
              {insight.commonThread.topKeyword && (
                <ThreadChip
                  icon={<Type size={11} />}
                  prefix="Anahtar kelime"
                  value={`"${insight.commonThread.topKeyword.word}"`}
                  count={insight.commonThread.topKeyword.count}
                  total={insight.commonThread.topKeyword.total}
                  dominance={insight.commonThread.topKeyword.dominance}
                />
              )}
            </div>
          )}

          {/* Missing cases uyarısı (silinmiş/scope dışı) */}
          {insight && insight.impact.missingCases > 0 && (
            <p className="mt-2 text-[11px] text-slate-500 dark:text-ndark-muted">
              ⚠ {insight.impact.missingCases} vaka erişilemedi (silinmiş veya kapsam dışı).
            </p>
          )}

          {/* PR-3 — AI hipotezi kutusu (lazy load) */}
          <AiHypothesisBox alertId={alert.id} />

          {/* Aksiyonlar — PR-2 */}
          <div className="mt-3 flex flex-wrap gap-2">
            {onShowCases && (
              <Button
                size="sm"
                variant="outline"
                rightIcon={<ArrowRight size={12} />}
                onClick={() => onShowCases(alert.caseIds, alert.category)}
              >
                Vakaları Gör
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Link2 size={12} />}
              onClick={onLink}
              disabled={busy}
              title="Tetik vakalarını bir ana vakaya bağla (Parent link)"
            >
              Ana Vakaya Bağla
            </Button>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Send size={12} />}
              onClick={onNotify}
              disabled={busy}
              title="İlgili takıma in-app bildirim gönder"
            >
              Takıma Bildir
            </Button>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Bookmark size={12} />}
              onClick={onKnownIssue}
              disabled={busy}
              title="Bu örüntüyü bilinen sorun olarak işaretle"
            >
              Bilinen Sorun
            </Button>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<BellOff size={12} />}
              onClick={onDismiss}
              disabled={busy}
            >
              Kapat
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** PR-2 — "Ana Vakaya Bağla" modalı (tetik vakalarından birini master seçer). */
function LinkModal({
  alert,
  busy,
  onClose,
  onSubmit,
}: {
  alert: PatternAlert;
  busy: boolean;
  onClose: () => void;
  onSubmit: (masterCaseId: string) => void;
}) {
  const [masterCaseId, setMasterCaseId] = useState<string>(alert.caseIds[0] ?? '');

  return (
    <Modal
      open
      onClose={onClose}
      title="Ana Vakaya Bağla"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>İptal</Button>
          <Button
            variant="primary"
            disabled={busy || !masterCaseId}
            onClick={() => onSubmit(masterCaseId)}
            leftIcon={<Link2 size={14} />}
          >
            {busy ? 'Bağlanıyor…' : 'Bağla'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-ndark-muted">
          Tetik vakalarından birini ana vaka olarak seç. Diğer vakalar bu ana vakaya
          <strong> Parent</strong> bağlantısıyla iliştirilir.
        </p>
        <Field label="Ana vaka" required>
          <Select
            value={masterCaseId}
            onChange={(e) => setMasterCaseId(e.target.value)}
          >
            {alert.caseIds.map((cid, i) => (
              <option key={cid} value={cid}>
                {i === 0 ? '★ ' : ''}{cid}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-slate-500 dark:text-ndark-muted">
          Toplam {alert.caseIds.length} vaka. Seçilen vakaya {alert.caseIds.length - 1}
          {' '}vaka bağlanacak.
        </p>
      </div>
    </Modal>
  );
}

/** PR-2 — "Takıma Bildir" modalı (takım seç + opsiyonel mesaj). */
function NotifyModal({
  alert,
  busy,
  onClose,
  onSubmit,
}: {
  alert: PatternAlert;
  busy: boolean;
  onClose: () => void;
  onSubmit: (teamId: string, message: string) => void;
}) {
  const allTeams = useState(() => lookupService.teams())[0];
  const teams = allTeams.filter((t) => t.companyId === alert.companyId && t.isActive);
  const [teamId, setTeamId] = useState<string>('');
  const [message, setMessage] = useState<string>(
    `${alert.category} kategorisinde ${alert.caseCount} vaka örüntüsü tespit edildi (${alert.windowMinutes} dk içinde).`,
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Takıma Bildir"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>İptal</Button>
          <Button
            variant="primary"
            disabled={busy || !teamId}
            onClick={() => onSubmit(teamId, message)}
            leftIcon={<Send size={14} />}
          >
            {busy ? 'Gönderiliyor…' : 'Bildir'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Takım" required>
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">— Takım seç —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          {teams.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">Bu şirkette aktif takım yok.</p>
          )}
        </Field>
        <Field label="Mesaj">
          <TextArea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={1000}
          />
        </Field>
        <p className="text-xs text-slate-500 dark:text-ndark-muted">
          Takım üyeleri in-app bildirim olarak alır. Bağlam: ilk tetik vakasının id'si
          kullanılır.
        </p>
      </div>
    </Modal>
  );
}

function buildTitle(alert: PatternAlert, insight: PatternInsight | null): string {
  // "Olası sorun: <ana firma> <kategori>" — varsa
  const ana = insight?.commonThread.topAnaFirma?.name;
  if (ana) return `Olası sorun: ${ana} · ${alert.category}`;
  return `Olası sorun: ${alert.category}`;
}

function SpikeBadge({ insight }: { insight: PatternInsight | null }) {
  if (!insight) return null;
  if (insight.spike.isNew) {
    return <Badge tint="sky">Yeni kategori (kıyas yok)</Badge>;
  }
  if (insight.spike.value == null) return null;
  const v = insight.spike.value;
  if (v >= 5) return <Badge tint="rose">{`${v}× normal`}</Badge>;
  if (v >= 2) return <Badge tint="amber">{`${v}× normal`}</Badge>;
  return <Badge tint="slate">{`${v}× normal`}</Badge>;
}

function ImpactKpi({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: 'rose';
}) {
  const valueColor = accent === 'rose'
    ? 'text-rose-700 dark:text-rose-300'
    : 'text-slate-800 dark:text-ndark-text';
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-ndark-border dark:bg-ndark-card">
      <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-ndark-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-base font-semibold leading-tight ${valueColor}`}>{value}</div>
    </div>
  );
}

function ThreadChip({
  icon,
  prefix,
  value,
  count,
  total,
  dominance,
}: {
  icon: React.ReactNode;
  prefix: string;
  value: string;
  count: number;
  total: number;
  dominance: number;
}) {
  // dominance >= 0.99 → sade (kesin); aksi halde "Çoğunlukla X (count/total)"
  const isFull = dominance >= 0.99;
  const label = isFull ? value : `Çoğunlukla ${value} (${count}/${total})`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
      title={`${prefix}: ${value} — %${Math.round(dominance * 100)} baskınlık`}
    >
      {icon}
      <span className="text-slate-500 dark:text-ndark-muted">{prefix}:</span>
      <span className="font-medium">{label}</span>
    </span>
  );
}

function hasAnyThread(insight: PatternInsight): boolean {
  return !!(
    insight.commonThread.topAnaFirma
    || insight.commonThread.topProduct
    || insight.commonThread.topKeyword
  );
}

/**
 * PR-3 — AI hipotezi kutusu (lazy load).
 *
 * Kart render olur olmaz görünür — "AI hipotezi göster" butonu ile lazy
 * fetch. Cache (24h) backend tarafında; UI sadece state tutar.
 *
 * Privacy etiketi: "AI hipotezi — karar değil, sinyal".
 *
 * Graceful degrade: AI fail veya 503 → kutu "AI yanıt veremedi" mesajı +
 * retry buton. Kartın diğer kısımları aynen çalışır (PR-1 insight standalone).
 */
function AiHypothesisBox({ alertId }: { alertId: string }) {
  const [hypothesis, setHypothesis] = useState<string | null>(null);
  const [suggestedAction, setSuggestedAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);

  async function load(force = false) {
    setLoading(true);
    setAiUnavailable(false);
    const r = await analyticsService.getPatternHypothesis(alertId, { force });
    setLoading(false);
    setLoaded(true);
    if (!r || !r.ok || !r.hypothesis) {
      setAiUnavailable(true);
      return;
    }
    setHypothesis(r.hypothesis);
    setSuggestedAction(r.suggestedAction);
  }

  if (!loaded && !loading) {
    return (
      <div className="mt-3">
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<Brain size={12} />}
          onClick={() => void load()}
          className="text-purple-700 dark:text-purple-300"
        >
          AI hipotezi göster
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mt-3 rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-700 dark:border-purple-900/50 dark:bg-purple-950/30 dark:text-purple-200">
        <Brain size={12} className="mr-1 inline" /> AI hipotezi üretiliyor…
      </div>
    );
  }

  if (aiUnavailable) {
    return (
      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted">
        <div className="flex items-center justify-between gap-2">
          <span>
            <Brain size={12} className="mr-1 inline" />
            AI yanıt veremedi.
          </span>
          <Button size="sm" variant="ghost" onClick={() => void load(true)}>
            Tekrar dene
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-purple-200 bg-purple-50 p-3 dark:border-purple-900/50 dark:bg-purple-950/30">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">
          <Brain size={11} />
          AI hipotezi — karar değil, sinyal
        </span>
        <button
          type="button"
          onClick={() => void load(true)}
          className="text-[10px] text-purple-600 hover:underline dark:text-purple-400"
          title="Yeniden üret (cache bypass)"
        >
          Yenile
        </button>
      </div>
      <p className="text-sm text-purple-900 dark:text-purple-100">{hypothesis}</p>
      {suggestedAction && (
        <p className="mt-1.5 text-xs text-purple-800 dark:text-purple-200">
          <strong>Önerilen aksiyon:</strong> {suggestedAction}
        </p>
      )}
    </div>
  );
}

// Type re-exports for downstream UI (action panels, AI hypothesis box)
export type { PatternThreadValue, PatternThreadKeyword };
