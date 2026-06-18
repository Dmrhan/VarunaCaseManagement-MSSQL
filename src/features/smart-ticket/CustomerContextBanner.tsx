/**
 * Smart Ticket — Customer Context Banner.
 *
 * Sol panelde tek satır, kompakt müşteri bağlamı özeti. Müşteri seçildikten
 * sonra render edilir. AÇIKLAMA TEXTAREA aşağı itilmesin diye 50-60px
 * tutar. Detay drawer'da.
 *
 * State'e göre renk:
 *   - clear    : yeşil    (açık vaka yok, sinyal yok)
 *   - watch    : amber    (açık vaka veya SLA breach var)
 *   - critical : kırmızı  (duplicate aynı tipte açık vaka)
 */
import { ArrowRight, AlertTriangle, Check } from 'lucide-react';
import type { CustomerContextRiskState } from './customerHistory';

interface CustomerContextBannerProps {
  /** Müşterinin açık vaka sayısı (mevcut Smart Ticket state'inden) */
  openCount: number;
  /** Müşterinin son N kapalı vaka sayısı (banner mount fetch) */
  resolvedCount: number;
  /** computeBannerRiskState ile hesaplanır */
  riskState: CustomerContextRiskState;
  /** Mevcut form.caseType ile aynı tipte açık vaka var mı (duplicate-check) */
  hasDuplicate: boolean;
  /** Loading sırasında pulse animasyonu için (resolvedCount fetch in-flight) */
  loading?: boolean;
  /**
   * Açık vaka veya geçmiş çözüm fetch'i hata aldı mı. True ise banner
   * "0 açık vaka · Temiz" değil "Bilgi alınamadı" gösterir — L1 ajan
   * yanlış güvenmesin. Codex review (PR #88 #1) için eklendi.
   */
  fetchError?: boolean;
  /** "Bağlamı Aç" tıklaması — drawer toggle */
  onOpenDrawer: () => void;
}

const STATE_META: Record<
  CustomerContextRiskState,
  { wrap: string; text: string; icon: 'check' | 'alert'; iconClass: string; label: string }
> = {
  clear: {
    wrap: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/30 dark:bg-emerald-950/20',
    text: 'text-emerald-800 dark:text-emerald-200',
    icon: 'check',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    label: 'Temiz',
  },
  watch: {
    wrap: 'border-amber-200 bg-amber-50/70 dark:border-amber-900/30 dark:bg-amber-950/20',
    text: 'text-amber-900 dark:text-amber-100',
    icon: 'alert',
    iconClass: 'text-amber-600 dark:text-amber-400',
    label: 'İzlemede',
  },
  critical: {
    wrap: 'border-rose-300 bg-rose-50/80 dark:border-rose-900/50 dark:bg-rose-950/30',
    text: 'text-rose-900 dark:text-rose-100',
    icon: 'alert',
    iconClass: 'text-rose-600 dark:text-rose-400',
    label: 'Kritik',
  },
};

export function CustomerContextBanner({
  openCount,
  resolvedCount,
  riskState,
  hasDuplicate,
  loading = false,
  fetchError = false,
  onOpenDrawer,
}: CustomerContextBannerProps) {
  // Hata durumunda L1 ajan "0 açık vaka · Temiz" mesajına güvenmesin.
  // riskState'i watch'a çek + count'ları "—" göster + label "Bilgi alınamadı".
  const effectiveState: CustomerContextRiskState = fetchError ? 'watch' : riskState;
  const meta = STATE_META[effectiveState];

  // Özet parça: "3 açık · 5 geçmiş çözüm · İzlemede"
  // Loading: skeleton tarzı; error: count yerine "—".
  const parts: string[] = [];
  if (loading) {
    parts.push('Açık vakalar yükleniyor…');
  } else if (fetchError) {
    parts.push('— açık vaka', '— geçmiş çözüm', 'Bilgi alınamadı');
  } else {
    parts.push(`${openCount} açık vaka`, `${resolvedCount} geçmiş çözüm`, meta.label);
  }
  if (loading) parts.push(meta.label);

  return (
    <button
      type="button"
      onClick={onOpenDrawer}
      className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-brand-400 ${meta.wrap}`}
      aria-label="Müşteri bağlamı drawer'ını aç"
    >
      <div className="flex items-center gap-1.5">
        {meta.icon === 'check' ? (
          <Check size={13} className={meta.iconClass} />
        ) : (
          <AlertTriangle size={13} className={meta.iconClass} />
        )}
        <span className={`text-[11px] font-medium ${meta.text}`}>
          {parts.join(' · ')}
        </span>
        {hasDuplicate && !loading && !fetchError && (
          <span className="ml-1 rounded-full bg-rose-100 px-1.5 py-0 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
            Mükerrer riski
          </span>
        )}
      </div>
      <span className={`flex items-center gap-1 text-[11px] font-medium ${meta.text}`}>
        Bağlamı Aç
        <ArrowRight size={11} />
      </span>
    </button>
  );
}
