import { useState } from 'react';
import { Check, Copy, MessageCircle, Wrench } from 'lucide-react';
import type { Case } from './types';

/**
 * Madde 2 — KB analyze cevabından çıkarılan iki normalized draft
 * (engineeringHandoff + customerReplyDraft) için ortak render bileşeni.
 *
 * Render politikası:
 *   - item.customFields.smartTicket.aiDrafts varsa render (koşullu).
 *   - Hangi alanlar varsa onlar render edilir; eksikler atlanır.
 *   - Her kart Kopyala buton — clipboard'a yazar, 1.5sn check icon.
 *   - Raw KB persist YOK — sadece normalized string'ler ve meta var.
 *
 * Kullanım:
 *   <KbDraftCard item={item} variant="closure" />
 *   <KbDraftCard item={item} variant="case-detail" />
 *
 * variant:
 *   - "closure"      → Stage 3 closure ekranında (kompakt; resolution
 *                       note input'unun üstünde)
 *   - "transfer"     → Stage 3 transfer ekranında (yalnız
 *                       engineeringHandoff göster; müşteri taslağı L1
 *                       transfer'i için anlamsız)
 *   - "case-detail"  → Case Detail Detay sekmesinde (genişletilmiş;
 *                       resolution note yakınında)
 */

interface KbDraftsShape {
  engineeringHandoff?: string;
  customerReplyDraft?: string;
  source?: string;
  capturedAt?: string;
  version?: number;
}

function readAiDrafts(item: Case): KbDraftsShape | null {
  const cf = item.customFields;
  if (!cf || typeof cf !== 'object') return null;
  const st = (cf as Record<string, unknown>).smartTicket;
  if (!st || typeof st !== 'object') return null;
  const drafts = (st as Record<string, unknown>).aiDrafts;
  if (!drafts || typeof drafts !== 'object') return null;
  return drafts as KbDraftsShape;
}

export function KbDraftCard({
  item,
  variant,
}: {
  item: Case;
  variant: 'closure' | 'transfer' | 'case-detail';
}) {
  const drafts = readAiDrafts(item);
  if (!drafts) return null;

  const showEngineering = !!drafts.engineeringHandoff;
  // Transfer mode'da müşteri yanıt taslağı gizli — L1 transfer akışında
  // müşteri ile iletişim taslağı anlamsız (vaka L2'ye gidiyor).
  const showCustomer = variant !== 'transfer' && !!drafts.customerReplyDraft;
  if (!showEngineering && !showCustomer) return null;

  const compact = variant === 'closure' || variant === 'transfer';

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {showEngineering && (
        <DraftPanel
          tone="emerald"
          icon={<Wrench size={12} />}
          title="Teknik Devir Notu (KB önerisi)"
          subtitle={compact ? null : 'L2/mühendislik ekibi için hazırlanmış öneri taslağı.'}
          content={drafts.engineeringHandoff!}
          compact={compact}
        />
      )}
      {showCustomer && (
        <DraftPanel
          tone="blue"
          icon={<MessageCircle size={12} />}
          title="Müşteri Yanıt Taslağı (KB önerisi)"
          subtitle={compact ? null : 'Müşteri ile paylaşılabilir taslak — kontrol et, gerekirse düzenle.'}
          content={drafts.customerReplyDraft!}
          compact={compact}
        />
      )}
    </div>
  );
}

function DraftPanel({
  tone,
  icon,
  title,
  subtitle,
  content,
  compact,
}: {
  tone: 'emerald' | 'blue';
  icon: React.ReactNode;
  title: string;
  subtitle: string | null;
  content: string;
  compact: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // navigator.clipboard reddederse fallback — alert göstermek yerine
      // toast'a ihtiyacımız olmadan sessiz fail.
    }
  }

  const toneClasses =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20'
      : 'border-blue-200 bg-blue-50/60 dark:border-blue-900/40 dark:bg-blue-950/20';

  const headerToneClasses =
    tone === 'emerald'
      ? 'text-emerald-800 dark:text-emerald-200'
      : 'text-blue-800 dark:text-blue-200';

  return (
    <div className={`rounded-md border px-3 py-2 ${toneClasses}`}>
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide ${headerToneClasses}`}>
          {icon}
          <span>{title}</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className={`flex items-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-[11px] font-medium hover:border-current/40 ${headerToneClasses}`}
          title="Panoya kopyala"
        >
          {copied ? (
            <>
              <Check size={11} />
              Kopyalandı
            </>
          ) : (
            <>
              <Copy size={11} />
              Kopyala
            </>
          )}
        </button>
      </div>
      {subtitle && (
        <p className="mt-1 text-[11px] text-slate-600 dark:text-ndark-muted">{subtitle}</p>
      )}
      <p
        className={`mt-1 whitespace-pre-wrap text-slate-800 dark:text-ndark-text ${
          compact ? 'text-xs' : 'text-sm'
        }`}
      >
        {content}
      </p>
    </div>
  );
}
