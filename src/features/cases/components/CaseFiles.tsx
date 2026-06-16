/**
 * Shared Case Files module.
 *
 * Extracted from CaseDetailPage.tsx so the L1 Case Resolution Console
 * can reuse the exact same files/evidence experience (drag-drop +
 * click upload, per-file progress queue, download, delete, size/count
 * validation) WITHOUT a second implementation.
 *
 * Public exports:
 *   - FilesTab — full files section (upload zone + progress queue +
 *                file list). Parent owns the case item and the update
 *                callback; backend calls (`caseService.addFile`,
 *                `removeFile`, `downloadFile`) are unchanged.
 *
 * No backend / service change. All limits (`CASE_FILE_MAX_SIZE`
 * 25MB, `CASE_FILE_MAX_COUNT` 20) come from `../types` exactly as the
 * old CaseDetailPage used them.
 */

import { useEffect, useRef, useState } from 'react';
import { Download, Eye, Paperclip, Trash2, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { caseService } from '@/services/caseService';
import { formatBytes, formatDateTime } from '@/lib/format';
import {
  CASE_FILE_MAX_COUNT,
  CASE_FILE_MAX_SIZE,
  type Case,
  type CaseFile,
} from '../types';
import {
  AttachmentImagePreviewDialog,
  isImageAttachment,
} from './AttachmentImagePreviewDialog';

interface UploadProgress {
  fileName: string;
  fileSize: number;
  percent: number;
  status: 'queued' | 'uploading' | 'finalizing' | 'done' | 'error';
  errorMessage?: string;
}

export function FilesTab({
  item,
  onItemUpdated,
  onUploadingChange,
}: {
  item: Case;
  onItemUpdated: (c: Case) => void;
  /** Opsiyonel — parent active upload state'i izlemek isterse. Smart Ticket
   *  Stage 3 closure files section'da "Vakayı Kapat" butonu upload sırasında
   *  disable edilir. Verilmezse default davranış (Case Detail Files tab'ı)
   *  hiçbir değişiklik görmez. */
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadProgress[]>([]);
  const [previewFile, setPreviewFile] = useState<CaseFile | null>(null);

  useEffect(() => {
    onUploadingChange?.(uploading);
  }, [uploading, onUploadingChange]);

  const remainingSlots = CASE_FILE_MAX_COUNT - item.files.length;
  const maxMb = Math.round(CASE_FILE_MAX_SIZE / (1024 * 1024));

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    if (list.length > remainingSlots) {
      toast({
        type: 'warn',
        message: `Bu vakaya en fazla ${remainingSlots} dosya daha eklenebilir (toplam limit ${CASE_FILE_MAX_COUNT}).`,
      });
      return;
    }

    const oversized = list.filter((f) => f.size > CASE_FILE_MAX_SIZE);
    if (oversized.length > 0) {
      toast({
        type: 'error',
        message: `${oversized.length} dosya ${maxMb} MB sınırını aşıyor: ${oversized.map((f) => f.name).join(', ')}`,
      });
      return;
    }

    setUploading(true);
    setUploadQueue(
      list.map((f) => ({
        fileName: f.name,
        fileSize: f.size,
        percent: 0,
        status: 'queued',
      })),
    );

    let lastCase: Case | null = null;
    let successCount = 0;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setUploadQueue((q) =>
        q.map((u, idx) => (idx === i ? { ...u, status: 'uploading' } : u)),
      );

      const result = await caseService.addFile(item.id, file, (percent) => {
        setUploadQueue((q) =>
          q.map((u, idx) =>
            idx === i
              ? { ...u, percent, status: percent >= 100 ? 'finalizing' : 'uploading' }
              : u,
          ),
        );
      });

      if (!result || 'error' in result) {
        const errMsg = result && 'error' in result ? result.error : 'Yükleme başarısız';
        setUploadQueue((q) =>
          q.map((u, idx) =>
            idx === i ? { ...u, status: 'error', errorMessage: errMsg } : u,
          ),
        );
        if (result && 'error' in result) {
          toast({ type: 'error', message: result.error });
        }
        continue;
      }

      setUploadQueue((q) =>
        q.map((u, idx) => (idx === i ? { ...u, status: 'done', percent: 100 } : u)),
      );
      lastCase = result.caseUpdated;
      successCount += 1;
    }

    setUploading(false);

    if (lastCase) onItemUpdated(lastCase);
    if (successCount > 0) {
      toast({
        type: 'success',
        message:
          successCount === 1 ? 'Dosya yüklendi ✓' : `${successCount} dosya yüklendi ✓`,
        duration: 2000,
      });
    }

    window.setTimeout(() => setUploadQueue([]), 3000);
  }

  async function handleRemove(file: CaseFile) {
    if (!window.confirm(`"${file.fileName}" dosyasını silmek istediğinizden emin misiniz?`)) {
      return;
    }
    const updated = await caseService.removeFile(item.id, file.id);
    if (updated) {
      onItemUpdated(updated);
      toast({ type: 'success', message: 'Dosya silindi.', duration: 2000 });
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      void uploadFiles(e.dataTransfer.files);
    }
  }

  return (
    <>
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Maks. {maxMb} MB / dosya · {CASE_FILE_MAX_COUNT} dosya / vaka.{' '}
          <span className="text-slate-400">
            ({item.files.length}/{CASE_FILE_MAX_COUNT})
          </span>
        </p>
        <Button
          size="sm"
          variant="outline"
          leftIcon={<UploadCloud size={12} />}
          onClick={() => inputRef.current?.click()}
          disabled={uploading || remainingSlots <= 0}
        >
          {uploading ? 'Yükleniyor…' : 'Dosya Seç'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void uploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-6 text-center text-sm transition ${
          dragActive
            ? 'border-brand-500 bg-brand-50 text-brand-700'
            : 'border-slate-300 bg-slate-50/50 text-slate-500 hover:border-brand-400 hover:bg-brand-50/40'
        }`}
      >
        <UploadCloud size={20} className={dragActive ? 'text-brand-600' : 'text-slate-400'} />
        <span>
          Dosyaları buraya sürükleyin veya{' '}
          <span className="font-medium text-brand-700">tıklayın</span>
        </span>
        <span className="text-[11px] text-slate-400">
          Birden fazla dosya seçilebilir
        </span>
      </div>

      {uploadQueue.length > 0 && (
        <ul className="space-y-2 rounded-md bg-slate-50/80 p-2 ring-1 ring-slate-200">
          {uploadQueue.map((u, i) => {
            const statusLabel: Record<UploadProgress['status'], string> = {
              queued: 'Sırada bekliyor',
              uploading: `Yükleniyor… %${u.percent}`,
              finalizing: 'Kaydediliyor…',
              done: 'Yüklendi ✓',
              error: u.errorMessage ?? 'Hata',
            };
            const barColor =
              u.status === 'error'
                ? 'bg-rose-500'
                : u.status === 'done'
                  ? 'bg-emerald-500'
                  : 'bg-brand-500';
            return (
              <li key={`${u.fileName}-${i}`} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 truncate text-slate-700">
                    <Paperclip size={11} className="flex-shrink-0 text-slate-400" />
                    <span className="truncate font-medium">{u.fileName}</span>
                    <span className="flex-shrink-0 text-slate-400">
                      ({formatBytes(u.fileSize)})
                    </span>
                  </span>
                  <span
                    className={`flex-shrink-0 font-medium ${
                      u.status === 'error'
                        ? 'text-rose-600'
                        : u.status === 'done'
                          ? 'text-emerald-600'
                          : 'text-brand-700'
                    }`}
                  >
                    {statusLabel[u.status]}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full ${barColor} transition-all duration-200`}
                    style={{
                      width:
                        u.status === 'finalizing' || u.status === 'done'
                          ? '100%'
                          : u.status === 'error'
                            ? '100%'
                            : `${u.percent}%`,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {item.files.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          Bu vakaya henüz dosya eklenmedi.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md ring-1 ring-slate-200">
          {item.files.map((f) => {
            const previewable = isImageAttachment(f);
            return (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Paperclip size={14} className="text-slate-400" />
                <span className="flex-1 truncate text-slate-800" title={f.fileName}>
                  {f.fileName}
                </span>
                <span className="hidden text-xs text-slate-500 sm:inline">
                  {formatBytes(f.fileSize)}
                </span>
                <span className="hidden text-xs text-slate-500 md:inline">
                  {formatDateTime(f.uploadedAt)}
                </span>
                {previewable && (
                  <button
                    type="button"
                    onClick={() => setPreviewFile(f)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-700"
                    title="Önizle"
                    aria-label="Önizle"
                  >
                    <Eye size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void caseService.downloadFile(item.id, f.id)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-700"
                  title="İndir"
                >
                  <Download size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(f)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
                  title="Sil"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
    <AttachmentImagePreviewDialog
      open={previewFile != null}
      caseId={item.id}
      file={previewFile}
      onClose={() => setPreviewFile(null)}
    />
    </>
  );
}
