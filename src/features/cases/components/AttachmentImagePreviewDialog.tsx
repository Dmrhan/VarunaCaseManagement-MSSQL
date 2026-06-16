import { useEffect, useState } from 'react';
import { Download, AlertTriangle, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { caseService } from '@/services/caseService';
import { formatBytes } from '@/lib/format';

/**
 * Görüntü mü? MIME öncelik, dosya uzantısı fallback (MIME boş veya güvenilmez
 * olduğunda). Güvenli, dahili olarak servis edilen görüntü türleri kabul edilir.
 * SVG dahil — backend dosyayı stream eder, public CDN değil; XSS yüzeyi sınırlı.
 */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

export function isImageAttachment(file: {
  mimeType?: string | null;
  fileName?: string | null;
}): boolean {
  const mime = file.mimeType?.toLowerCase().trim();
  if (mime && mime.startsWith('image/')) return true;
  const name = file.fileName ?? '';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

interface PreviewableFile {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
}

interface Props {
  open: boolean;
  caseId: string;
  file: PreviewableFile | null;
  onClose: () => void;
}

/**
 * Görüntü ek dosyaları için hafif önizleme dialog'u. Backend'in mevcut
 * `/api/cases/:id/files/:fileId/download` endpoint'i signed URL döner; bu URL
 * `<img src=...>`'e konur. Public storage URL'i sızdırılmaz — kullanıcının
 * scope'una göre verilen geçici URL kullanılır.
 *
 * Tasarım:
 *   - Modal başlığı: dosya adı + boyut
 *   - Body: tek <img> object-contain, max-h-[70vh]
 *   - Footer: İndir butonu (klasik download akışı çalışır)
 *   - Esc / X close: Modal kendi davranışı (paylaşılan component)
 *   - URL fetch hatası: inline AlertTriangle + close button; toast yok
 *     (Modal bağlamında bildirimi inline'da bırakmak daha az gürültülü)
 */
export function AttachmentImagePreviewDialog({ open, caseId, file, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !file) {
      setUrl(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);
    void caseService
      .getFileDownloadUrl(caseId, file.id)
      .then((meta) => {
        if (cancelled) return;
        if (!meta) {
          setError('Önizleme URL\'i alınamadı.');
        } else {
          setUrl(meta.url);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError((err as Error)?.message ?? 'Önizleme yüklenemedi.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, caseId, file]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      title={
        file ? (
          <span className="flex items-baseline gap-2">
            <span className="truncate">{file.fileName}</span>
            <span className="flex-shrink-0 text-xs font-normal text-slate-500 dark:text-ndark-muted">
              {formatBytes(file.fileSize)}
            </span>
          </span>
        ) : null
      }
      footer={
        file && (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download size={12} />}
              onClick={() => void caseService.downloadFile(caseId, file.id)}
            >
              İndir
            </Button>
          </div>
        )
      }
    >
      <div className="flex min-h-[40vh] items-center justify-center bg-slate-50 dark:bg-ndark-card">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-ndark-muted">
            <Loader2 size={14} className="animate-spin" />
            <span>Önizleme yükleniyor…</span>
          </div>
        )}
        {error && !loading && (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm text-rose-700 dark:text-rose-300">
            <AlertTriangle size={20} />
            <span>{error}</span>
            <span className="text-xs text-slate-500 dark:text-ndark-muted">
              İndirme butonu hâlâ kullanılabilir.
            </span>
          </div>
        )}
        {url && !loading && !error && (
          <img
            src={url}
            alt={file?.fileName ?? ''}
            className="max-h-[70vh] w-auto max-w-full object-contain"
            onError={() => setError('Görüntü yüklenemedi.')}
          />
        )}
      </div>
    </Modal>
  );
}
