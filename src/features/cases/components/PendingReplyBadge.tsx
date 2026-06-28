/**
 * M6.3b Faz 1 — "Yanıt bekliyor" rozeti.
 *
 * SEMANTİK (Codex review fix):
 *   pendingCustomerReply=true durumu = son inbound > son outbound
 *   = "müşteri yeni mail attı, agent henüz cevap vermedi"
 *   → AGENT'IN cevap vermesi BEKLENİYOR.
 *
 * Bu nedenle badge yaşı (tooltip duration) MÜŞTERİNİN BEKLEYEN
 * mail'inin yaşı olmalı — yani lastEmailInboundAt. lastEmailOutboundAt
 * (agent'ın eski cevabı) yanıltıcı: 10 gün önce mail attıysak ve
 * müşteri bugün yanıt verdiyse "10 gün önce" göstermek yanlış.
 *
 * Endüstri araştırması (Zendesk/Freshdesk/Freshservice/BoldDesk):
 *  - Renk: amber/sarı (waiting) — kırmızı/urgency DEĞİL
 *  - İkon: ⏳ (saat) — bekleyiş sinyali
 *  - Tooltip: müşterinin yanıtladığından bu yana geçen süre
 *
 * State kaynağı: Case.pendingCustomerReply (K4 türetilmiş, transitionStatus
 * terminal guard + M6.3 Codex P2 zinciri matrisi). Manuel override YOK.
 *
 * Render konumları:
 *  - CasesListPage satırı (status pill yanı)
 *  - CaseDetailPage header (caseNumber yanı)
 *
 * Bileşen SAFE: pendingCustomerReply false/undefined → null render.
 */
import { Clock } from 'lucide-react';

interface Props {
  pending: boolean | undefined;
  /**
   * Müşterinin bekleyen mail'inin timestamp'i (ISO). Tooltip duration
   * BU değerden hesaplanır — agent'ın eski outbound'undan DEĞİL.
   * Codex review fix: pending durumunun semantik kaynağı son inbound.
   */
  lastEmailInboundAt?: string | null;
  /** Compact varyant — liste satırı için. Default false (detay header). */
  size?: 'sm' | 'md';
}

function durationHours(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return 0;
  return diffMs / (1000 * 60 * 60);
}

function formatDuration(hours: number | null): string {
  if (hours === null) return '';
  if (hours < 1) return 'bir saatten az önce';
  if (hours < 24) return `${Math.floor(hours)} saat önce`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 gün önce' : `${days} gün önce`;
}

export function PendingReplyBadge({ pending, lastEmailInboundAt, size = 'md' }: Props) {
  if (!pending) return null;
  const hours = durationHours(lastEmailInboundAt);
  const durationText = formatDuration(hours);
  const tooltip = lastEmailInboundAt
    ? `Müşteri ${durationText} yanıt verdi — agent cevabı bekleniyor`
    : 'Müşteri yanıtı geldi — agent cevabı bekleniyor';

  const sizeClass = size === 'sm'
    ? 'px-1.5 py-0.5 text-[10px]'
    : 'px-2 py-1 text-xs';

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 rounded-full font-medium bg-amber-100 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800/50 ${sizeClass}`}
      role="status"
      aria-label={tooltip}
    >
      <Clock size={size === 'sm' ? 10 : 12} aria-hidden="true" />
      <span>Yanıt bekliyor</span>
    </span>
  );
}
