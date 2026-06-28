/**
 * M6.3b Faz 2 — Per-agent imza self-service modal.
 *
 * n4b S1: self-service (agent kendi profilinden) — admin kişisel imzaya
 * dokunmaz.
 * n4b S4: HTML rich (TipTap RichTextEditor reuse — composer'daki).
 * n4b S5: composer fallback chain agent > tenant > none — bu modal
 * agent imzasını set/clear eder.
 *
 * Save öncesi backend sanitize-html (M6.1 allowlist).
 * Modal trigger: App.tsx header user menu → "İmzam".
 */
import { useEffect, useState } from 'react';
import { Mail, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { RichTextEditor } from '@/features/cases/components/RichTextEditor';
import { userSignatureService } from '@/services/userSignatureService';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UserSignatureModal({ open, onClose }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [html, setHtml] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    void userSignatureService.getMySignature().then((s) => {
      if (!alive) return;
      setHtml(s ?? '');
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    try {
      // Boş HTML (sadece tag, metin yok) → null (kaldır).
      const trimmed = html.replace(/<[^>]+>/g, '').trim();
      const next = trimmed ? html : null;
      const saved = await userSignatureService.updateMySignature(next);
      if (saved !== undefined) {
        toast({ type: 'success', title: 'İmza kaydedildi', message: 'Mail yanıtlarında otomatik kullanılabilir.' });
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    try {
      const saved = await userSignatureService.updateMySignature(null);
      if (saved !== undefined) {
        setHtml('');
        toast({ type: 'success', title: 'İmza kaldırıldı', message: 'İmzanız sıfırlandı.' });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-ndark-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-ndark-border">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
              Mail İmzam
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ndark-bg"
            aria-label="Kapat"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4">
          <p className="mb-2 text-xs text-slate-600 dark:text-ndark-muted">
            Mail yanıtlarında "İmza" dropdown'undan seçince otomatik olarak eklenir.
            İmza ad/unvan/iletişim bilgilerinizi içerebilir; XSS'e karşı kaydederken sanitize edilir.
          </p>
          {loading ? (
            <div className="py-8 text-center text-xs text-slate-400">Yükleniyor…</div>
          ) : (
            <RichTextEditor
              value={html}
              onChange={setHtml}
              disabled={saving}
              placeholder="İmzanızı yazın…"
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-ndark-border">
          <Button type="button" variant="ghost" onClick={handleClear} disabled={saving || loading}>
            İmzayı Kaldır
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={saving || loading}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      </div>
    </div>
  );
}
