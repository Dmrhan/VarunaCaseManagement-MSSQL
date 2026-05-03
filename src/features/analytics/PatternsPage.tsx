import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, BellOff, RefreshCw, Sparkles } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { formatRelative } from '@/lib/format';
import { analyticsService, type PatternAlert } from '@/services/analyticsService';

/**
 * Örüntü Alarmları (Faz 1.5 Madde 5 — Bekçi rolü §5.5).
 *
 * Cron her 15 dk son 60 dk'daki vakaları companyId+category bazında gruplar;
 * 5+ vaka varsa active alarm yarat. Yönetici inceler, "Vakaları Gör" ile
 * filtreli listeyi açar veya "Kapat" ile dismiss eder.
 *
 * Read-only — bu ekran otomatik parent vaka açmaz, yalnızca sinyal gösterir.
 *
 * Erişim: Supervisor / Admin / SystemAdmin (sidebar'da koşullu render edilir;
 * backend GET /api/analytics/patterns ek olarak rol kontrolü yapar).
 */

interface PatternsPageProps {
  /** Vakaları Gör tıklamasında parent App'e bildir — case list'e filtre uygulasın. */
  onShowCases?: (caseIds: string[], category: string) => void;
}

export function PatternsPage({ onShowCases }: PatternsPageProps) {
  const [items, setItems] = useState<PatternAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
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
    setDismissingId(alert.id);
    const r = await analyticsService.dismissPattern(alert.id);
    setDismissingId(null);
    if (r) {
      toast({ type: 'success', message: `Alarm kapatıldı: ${alert.category}` });
      // Sidebar badge'i de düşsün diye custom event yay
      window.dispatchEvent(new CustomEvent('app:patterns-changed'));
      void refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-ndark-text">Örüntü Alarmları</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-ndark-muted">
            Son 60 dakikada aynı kategoride 5+ vaka açılırsa burada uyarı görünür.
            Otomatik vaka açmıyor — sadece sinyal.
          </p>
        </div>
        <Button variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => void refresh()}>
          Yenile
        </Button>
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
              description="Cron her 15 dakikada bir kontrol eder. Anormal yoğunluk olduğunda burada uyarı çıkar."
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {items.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              dismissing={dismissingId === alert.id}
              onDismiss={() => handleDismiss(alert)}
              onShowCases={onShowCases}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertCard({
  alert,
  dismissing,
  onDismiss,
  onShowCases,
}: {
  alert: PatternAlert;
  dismissing: boolean;
  onDismiss: () => void;
  onShowCases?: (caseIds: string[], category: string) => void;
}) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 ring-1 ring-amber-200 dark:border-amber-900/50 dark:bg-amber-950/30 dark:ring-amber-900/50">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          <AlertTriangle size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-base font-semibold text-amber-900 dark:text-amber-100">
              {alert.category}
            </h2>
            <span className="shrink-0 text-xs text-amber-700 dark:text-amber-300">
              {formatRelative(alert.detectedAt)}
            </span>
          </div>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
            Son {alert.windowMinutes} dakikada{' '}
            <strong>{alert.caseCount}</strong> vaka açıldı.
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <Badge tint="amber">{alert.caseIds.length} vaka</Badge>
            <span className="font-mono">{alert.companyId}</span>
          </div>
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
              leftIcon={<BellOff size={12} />}
              onClick={onDismiss}
              disabled={dismissing}
            >
              {dismissing ? 'Kapatılıyor…' : 'Kapat'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
