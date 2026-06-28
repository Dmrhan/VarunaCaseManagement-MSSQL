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
  // Codex P2 fix — load failure preserve: undefined → loadFailed.
  // Aksi halde mevcut imzası olan kullanıcıda load fail → modal boş
  // gösterir → save → backend null kaydeder → MEVCUT İMZA SİLİNİR.
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSignature = () => {
    let alive = true;
    setLoading(true);
    setLoadFailed(false);
    void userSignatureService.getMySignature().then((s) => {
      if (!alive) return;
      if (s === undefined) {
        // fetch fail — apiFetch zaten toast attı; editor'ı düzenleme dışı tut.
        setLoadFailed(true);
        setHtml('');
      } else {
        setHtml(s ?? '');
      }
      setLoading(false);
    });
    return () => { alive = false; };
  };

  useEffect(() => {
    if (!open) return;
    return loadSignature();
    // open değişiminde re-load. loadSignature stable kapsam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    if (loadFailed) return; // Codex P2 — yüklenemeyen imzayı yanlışlıkla silme.
    setSaving(true);
    try {
      // Codex P2 fix — image-only signature (logo) "boş" SAYILMAZ.
      // sanitize-html allowlist <img> izinli; strip-tags sonrası metin
      // yok ama <img> varsa imza geçerli.
      const textOnly = html.replace(/<[^>]+>/g, '').trim();
      const hasImg = /<img\b/i.test(html);
      const next = (textOnly || hasImg) ? html : null;
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
    if (loadFailed) return; // Codex P2 — yüklenemeyen durumda clear de yanıltıcı.
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
          ) : loadFailed ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
              <p className="mb-2 font-medium">İmza yüklenemedi</p>
              <p className="text-xs">
                Mevcut imzanız okunamadı. Bu durumda kaydetmek mevcut imzanızı yanlışlıkla
                silebilir; önce yeniden yüklemeyi deneyin.
              </p>
              <button
                type="button"
                onClick={loadSignature}
                className="mt-2 rounded bg-rose-100 px-3 py-1 text-xs font-medium text-rose-800 hover:bg-rose-200 dark:bg-rose-900/60 dark:text-rose-100 dark:hover:bg-rose-900"
              >
                Tekrar dene
              </button>
            </div>
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
          <Button type="button" variant="ghost" onClick={handleClear} disabled={saving || loading || loadFailed}>
            İmzayı Kaldır
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={saving || loading || loadFailed}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      </div>
    </div>
  );
}
