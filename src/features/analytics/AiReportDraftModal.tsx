import { useState } from 'react';
import { AlertTriangle, Check, Copy, FileText } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  aiErrorMessage,
  type AiError,
  type OperationsReportResponse,
} from '@/services/aiService';

interface AiReportDraftModalProps {
  open: boolean;
  data: OperationsReportResponse | null;
  loading: boolean;
  error: AiError | null;
  onClose: () => void;
}

/**
 * Markdown rapor taslağı modalı.
 * Sunucudan dönen markdown'i ham metin olarak gösterir (mevcut markdown
 * renderer yoksa ekstra bağımlılık eklemiyoruz). Kullanıcı "Kopyala" ile
 * panoya kopyalar.
 */
export function AiReportDraftModal({ open, data, loading, error, onClose }: AiReportDraftModalProps) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    if (!data?.markdown) return;
    try {
      await navigator.clipboard.writeText(data.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // sessiz: panoya yazılamazsa kullanıcı kendisi seçip kopyalayabilir
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      height="80vh"
      title={(
        <span className="inline-flex items-center gap-2">
          <FileText size={14} className="text-violet-500" />
          Rapor Taslağı
        </span>
      )}
      footer={(
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-slate-400 dark:text-ndark-muted">
            {data?.scope?.narrative ?? ''}
            {data?.usageLogId && <> · usageLogId <code className="font-mono">{data.usageLogId}</code></>}
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <Button size="sm" variant="outline" onClick={copyToClipboard}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Kopyalandı' : 'Kopyala'}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onClose}>Kapat</Button>
          </div>
        </div>
      )}
    >
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} height={12} />)}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-900/30 dark:text-rose-200">
          <AlertTriangle size={14} className="mt-0.5" />
          <span>{aiErrorMessage(error)}</span>
        </div>
      )}

      {!loading && !error && data && (
        <pre className="whitespace-pre-wrap break-words rounded-md bg-slate-50 px-4 py-3 font-mono text-xs leading-relaxed text-slate-800 dark:bg-ndark-bg dark:text-ndark-text">
          {data.markdown}
        </pre>
      )}
    </Modal>
  );
}
