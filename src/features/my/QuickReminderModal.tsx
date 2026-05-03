import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Search, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, TextInput, TextArea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { caseService } from '@/services/caseService';
import { myService } from '@/services/myService';
import type { Case } from '@/features/cases/types';

/**
 * Edit modu için takvimden gelen reminder snapshot'ı. CalendarEvent'ten
 * üretilir — modal'a fresh fetch gerektirmez (gerekli alanlar zaten event'te).
 */
export interface ReminderEditTarget {
  id: string;
  caseId: string | null;
  caseLabel: string | null; // "VK-123 · Müşteri Adı" gibi; null = vakasız
  remindAt: string; // ISO
  message: string | null;
}

interface QuickReminderModalProps {
  open: boolean;
  onClose: () => void;
  /** Created/updated/deleted sonrası takvimi tazelemek için. */
  onCreated: () => void;
  /** Vaka detayından açılırsa pre-fill. */
  presetCaseId?: string;
  presetCaseLabel?: string;
  /** Takvim slot'undan açılırsa tarih+saat pre-fill (local TZ). */
  presetRemindAt?: Date | null;
  /** Edit modu — verilirse modal mevcut reminder'ı yükler, kaydet/sil sunar. */
  editTarget?: ReminderEditTarget | null;
  /** Verilirse seçili vakanın yanında "Aç" link butonu görünür → vaka detayı. */
  onOpenCase?: (caseId: string) => void;
}

/**
 * Mini hatırlatıcı oluşturma modal'ı.
 * Vaka arama → debounce'lu list call. Tarih+saat datetime-local input.
 *
 * Uyarı: tarayıcı datetime-local local timezone'a göre ISO döndürür;
 * server `new Date(remindAt)` ile parse edip UTC'ye çevirir.
 */
// datetime-local input formatına ISO/Date çevir (local TZ).
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function QuickReminderModal({
  open,
  onClose,
  onCreated,
  presetCaseId,
  presetCaseLabel,
  presetRemindAt,
  editTarget,
  onOpenCase,
}: QuickReminderModalProps) {
  const { toast } = useToast();
  const isEdit = Boolean(editTarget);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Case[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCase, setSelectedCase] = useState<{ id: string; label: string } | null>(null);
  const [remindAt, setRemindAt] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Modal kapanınca/açılınca state'i topla. Edit modunda editTarget'tan;
  // create modunda preset'lerden veya boştan başlat.
  useEffect(() => {
    if (!open) {
      setSearch('');
      setResults([]);
      setSelectedCase(null);
      setRemindAt('');
      setMessage('');
      setSubmitting(false);
      setDeleting(false);
      return;
    }
    if (editTarget) {
      setSelectedCase(
        editTarget.caseId && editTarget.caseLabel
          ? { id: editTarget.caseId, label: editTarget.caseLabel }
          : null,
      );
      setRemindAt(toDatetimeLocal(new Date(editTarget.remindAt)));
      setMessage(editTarget.message ?? '');
    } else if (presetCaseId && presetCaseLabel) {
      setSelectedCase({ id: presetCaseId, label: presetCaseLabel });
    }
  }, [open, editTarget, presetCaseId, presetCaseLabel]);

  // Create modunda default: presetRemindAt veya bir saat sonrası yuvarlanmış.
  // Edit modunda zaten yukarıda doğru tarihten doluyor.
  useEffect(() => {
    if (!open || remindAt || editTarget) return;
    const d = presetRemindAt ?? (() => {
      const x = new Date();
      x.setHours(x.getHours() + 1, 0, 0, 0);
      return x;
    })();
    setRemindAt(toDatetimeLocal(d));
  }, [open, remindAt, presetRemindAt, editTarget]);

  // Debounced case search.
  useEffect(() => {
    if (!open || selectedCase || search.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setSearching(true);
      // Pagination: backend full Case shape döndürüyor (notes/attachments/history
      // include ile). Search modal'ı için 10 kayıt yeter — tüm match'leri çekmenin
      // performans maliyeti yüksek, hele de search query'si genişse.
      const { items } = await caseService.list(
        {
          search,
          statuses: [],
          caseType: 'Tümü',
          priorities: [],
          teamId: '',
          personId: '',
          dateFrom: '',
          dateTo: '',
        },
        { page: 1, pageSize: 10 },
      );
      if (alive) {
        setResults(items);
        setSearching(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, search, selectedCase]);

  // Vakasız reminder için mesaj zorunlu (BE de aynı kuralı uyguluyor) — boş bir
  // şeyi hatırlatamayız.
  const canSubmit = useMemo(() => {
    if (!remindAt) return false;
    const dt = new Date(remindAt);
    if (Number.isNaN(dt.getTime()) || dt.getTime() <= Date.now()) return false;
    if (!selectedCase && !message.trim()) return false;
    return true;
  }, [selectedCase, remindAt, message]);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const isoRemind = new Date(remindAt).toISOString();
    const trimmedMessage = message.trim();
    let result;
    if (isEdit && editTarget) {
      result = await myService.updateReminder(editTarget.id, {
        caseId: selectedCase?.id ?? null,
        remindAt: isoRemind,
        message: trimmedMessage || null,
      });
    } else {
      result = await myService.createReminder({
        caseId: selectedCase?.id ?? null,
        remindAt: isoRemind,
        message: trimmedMessage || undefined,
      });
    }
    setSubmitting(false);
    if (!result) return; // apiFetch toast gösterdi
    toast({
      type: 'success',
      message: isEdit ? 'Hatırlatıcı güncellendi.' : 'Hatırlatıcı oluşturuldu.',
    });
    window.dispatchEvent(new Event('app:calendar-changed'));
    onCreated();
  }

  async function handleDelete() {
    if (!editTarget) return;
    if (!window.confirm('Bu hatırlatıcıyı silmek istediğine emin misin?')) return;
    setDeleting(true);
    const ok = await myService.deleteReminder(editTarget.id);
    setDeleting(false);
    if (!ok) return; // apiFetch toast gösterdi
    toast({ type: 'success', message: 'Hatırlatıcı silindi.' });
    window.dispatchEvent(new Event('app:calendar-changed'));
    onCreated();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Hatırlatıcıyı Düzenle' : 'Yeni Hatırlatıcı'}
      size="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          {isEdit ? (
            <Button
              variant="outline"
              leftIcon={<Trash2 size={14} />}
              onClick={handleDelete}
              disabled={submitting || deleting}
              className="text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
            >
              {deleting ? 'Siliniyor…' : 'Sil'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting || deleting}>
              Vazgeç
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || submitting || deleting}>
              {submitting
                ? isEdit
                  ? 'Kaydediliyor…'
                  : 'Oluşturuluyor…'
                : isEdit
                  ? 'Kaydet'
                  : 'Hatırlatıcı Oluştur'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <Field label="Vaka" hint="İsteğe bağlı — vakasız (kişisel) hatırlatıcı için boş bırak; not zorunlu olur.">
          {selectedCase ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text">
              <span className="min-w-0 truncate">{selectedCase.label}</span>
              <div className="flex shrink-0 items-center gap-3">
                {onOpenCase && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenCase(selectedCase.id);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline dark:text-brand-300 dark:hover:text-brand-200"
                    title="Vaka detayını aç"
                  >
                    <ExternalLink size={12} />
                    Aç
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedCase(null)}
                  className="text-xs text-slate-500 underline hover:text-slate-700 dark:text-ndark-muted dark:hover:text-ndark-text"
                >
                  Kaldır
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <TextInput
                  placeholder="Vaka no, başlık veya müşteri (en az 2 karakter, opsiyonel)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                  autoFocus
                />
              </div>
              {searching && (
                <div className="px-1 text-xs text-slate-400 dark:text-ndark-muted">Aranıyor…</div>
              )}
              {!searching && results.length > 0 && (
                <ul className="max-h-52 overflow-y-auto rounded-md border border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedCase({
                            id: c.id,
                            label: `${c.caseNumber} · ${c.title} · ${c.accountName}`,
                          })
                        }
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-ndark-bg"
                      >
                        <div className="font-mono text-xs text-slate-500 dark:text-ndark-muted">
                          {c.caseNumber}
                        </div>
                        <div className="truncate text-slate-900 dark:text-ndark-text">{c.title}</div>
                        <div className="truncate text-xs text-slate-500 dark:text-ndark-muted">
                          {c.accountName}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!searching && search.trim().length >= 2 && results.length === 0 && (
                <div className="px-1 text-xs text-slate-400 dark:text-ndark-muted">
                  Eşleşen vaka yok.
                </div>
              )}
            </div>
          )}
        </Field>

        <Field label="Tarih ve saat" required>
          <TextInput
            type="datetime-local"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
          />
        </Field>

        <Field
          label="Not"
          required={!selectedCase}
          hint={
            selectedCase
              ? 'İsteğe bağlı — neyi hatırlatacağına dair kısa metin.'
              : 'Vakasız hatırlatıcı için zorunlu — neyi hatırlamak istiyorsun?'
          }
        >
          <TextArea
            placeholder={
              selectedCase
                ? 'Müşteriyi tekrar ara, dosya talep et, vb.'
                : 'Aylık raporları gözden geçir, ekip toplantısı, vb.'
            }
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={300}
          />
        </Field>
      </div>
    </Modal>
  );
}
