import { FileText, Lightbulb, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export type AiCommandKey = 'brief' | 'insights' | 'report';

interface RunaCommandStripProps {
  briefLoading: boolean;
  insightsLoading: boolean;
  reportLoading: boolean;
  briefError: string | null;
  insightsError: string | null;
  reportError: string | null;
  hasBrief: boolean;
  hasInsights: boolean;
  onRun: (cmd: AiCommandKey) => void;
}

/**
 * Operations Dashboard — Runa AI komut şeridi (Phase 4a §2.8).
 *
 * 3 deterministic giriş noktası:
 *   - Brief: yönetici özeti
 *   - Insights: 3-5 insight kartı
 *   - Report: yönetim için kısa rapor taslağı
 *
 * Kart asıl render edilirken loading/error/empty state diğer bileşenlerde
 * yönetilir; burada sadece tetikleme + durum etiketleri tutuluyor.
 */
export function RunaCommandStrip({
  briefLoading,
  insightsLoading,
  reportLoading,
  briefError,
  insightsError,
  reportError,
  hasBrief,
  hasInsights,
  onRun,
}: RunaCommandStripProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-gradient-to-r from-violet-50/40 via-white to-blue-50/40 px-3 py-2 dark:border-ndark-border dark:from-ndark-card dark:via-ndark-card dark:to-ndark-card">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
        <Sparkles size={13} />
        Runa AI
      </div>

      <CommandButton
        label="Yönetici Özeti"
        icon={<Sparkles size={12} />}
        loading={briefLoading}
        active={hasBrief}
        error={briefError}
        onClick={() => onRun('brief')}
      />

      <CommandButton
        label="İçgörüler"
        icon={<Lightbulb size={12} />}
        loading={insightsLoading}
        active={hasInsights}
        error={insightsError}
        onClick={() => onRun('insights')}
      />

      <CommandButton
        label="Rapor Taslağı"
        icon={<FileText size={12} />}
        loading={reportLoading}
        error={reportError}
        onClick={() => onRun('report')}
      />

      <div className="ml-auto text-[11px] text-slate-400 dark:text-ndark-muted">
        Tüm sayılar deterministic; AI yalnızca özetler.
      </div>
    </div>
  );
}

function CommandButton({
  label,
  icon,
  loading,
  active,
  error,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  loading: boolean;
  active?: boolean;
  error: string | null;
  onClick: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <Button size="sm" variant={active ? 'primary' : 'outline'} disabled={loading} onClick={onClick}>
        {loading ? <RefreshCw size={12} className="animate-spin" /> : icon}
        {label}
      </Button>
      {error && (
        <Badge tint="rose" className="font-normal">
          hata
        </Badge>
      )}
    </div>
  );
}
