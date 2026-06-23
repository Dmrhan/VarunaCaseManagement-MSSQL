import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Filter, Loader2, ShieldCheck } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextInput, TextArea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { caseService } from '@/services/caseService';
import { CASE_STATUSES, type Case, type CaseStatus, type CaseTaggingReview, type TaggingVerdict } from '@/features/cases/types';

/**
 * Vaka Etiket Doğrulama Ekranı — Supervisor / Admin / SystemAdmin.
 *
 * Bilgi bankası seed'i için: her vakanın açılış (5 alan) ve kapanış (4 alan,
 * sadece Smart Ticket kökenli + Çözüldü vakalarda dolu) etiketlemesinin
 * doğruluğunu Doğru/Yanlış/Belirsiz olarak işaretler. Bu kayıt başka bir
 * akışı beslemez — sadece audit/rapor amaçlı.
 */

interface CaseTaggingReviewPageProps {
  onSelectCase: (id: string) => void;
}

const STATUS_LABELS_SHORT: Record<CaseStatus, string> = {
  'Açık': 'Açık',
  'İncelemede': 'İncelemede',
  '3rdPartyBekleniyor': '3.Parti',
  'Eskalasyon': 'Eskale Edildi',
  'Çözüldü': 'Çözüldü',
  'YenidenAcildi': 'Yeniden',
  'İptalEdildi': 'İptal',
};

const VERDICT_LABELS: Record<TaggingVerdict, string> = {
  Dogru: 'Doğru',
  Yanlis: 'Yanlış',
  Belirsiz: 'Belirsiz',
};

const OPENING_FIELDS: { key: string; label: string }[] = [
  { key: 'businessProcess', label: 'İş Süreci' },
  { key: 'operationType', label: 'İşlem Tipi' },
  { key: 'affectedObject', label: 'Etkilenen Nesne' },
  { key: 'impact', label: 'Etki' },
  { key: 'platform', label: 'Platform' },
];

const CLOSURE_FIELDS: { key: string; label: string }[] = [
  { key: 'rootCauseGroup', label: 'Kök Neden Grubu' },
  { key: 'rootCauseDetail', label: 'Kök Neden Detayı' },
  { key: 'resolutionType', label: 'Çözüm Tipi' },
  { key: 'permanentPrevention', label: 'Kalıcı Önlem' },
];

function extractLabels(obj: Record<string, unknown> | undefined, fields: { key: string; label: string }[]) {
  return fields.map((f) => ({
    label: f.label,
    value: (obj?.[`${f.key}Label`] as string | undefined) ?? null,
  }));
}

interface RowDraft {
  openingVerdict: TaggingVerdict | '';
  closingVerdict: TaggingVerdict | '';
  note: string;
  saving: boolean;
}

function draftFromReview(r: CaseTaggingReview | undefined): RowDraft {
  return {
    openingVerdict: r?.openingVerdict ?? '',
    closingVerdict: r?.closingVerdict ?? '',
    note: r?.note ?? '',
    saving: false,
  };
}

export function CaseTaggingReviewPage({ onSelectCase }: CaseTaggingReviewPageProps) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statuses, setStatuses] = useState<CaseStatus[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Case[]>([]);
  const [total, setTotal] = useState(0);
  const [reviews, setReviews] = useState<Map<string, CaseTaggingReview>>(new Map());
  const [drafts, setDrafts] = useState<Map<string, RowDraft>>(new Map());

  const { toast } = useToast();

  async function fetchPage() {
    setLoading(true);
    // apiFetch hata durumunda kendi toast'ını gösterir ve undefined/boş döner —
    // burada ek bir error state'i gerekmiyor.
    const result = await caseService.listTaggingReviews(
      { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, statuses: statuses.length ? statuses : undefined },
      { page, pageSize },
    );
    setItems(result.items);
    setTotal(result.total);
    setReviews(result.reviews);
    setDrafts(new Map(result.items.map((c) => [c.id, draftFromReview(result.reviews.get(c.id))])));
    setLoading(false);
  }

  useEffect(() => {
    void fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function toggleStatus(s: CaseStatus) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function updateDraft(caseId: string, patch: Partial<RowDraft>) {
    setDrafts((prev) => {
      const next = new Map(prev);
      const cur = next.get(caseId) ?? draftFromReview(reviews.get(caseId));
      next.set(caseId, { ...cur, ...patch });
      return next;
    });
  }

  async function saveRow(caseId: string) {
    const draft = drafts.get(caseId);
    if (!draft) return;
    updateDraft(caseId, { saving: true });
    const result = await caseService.updateTaggingReview(caseId, {
      openingVerdict: draft.openingVerdict || null,
      closingVerdict: draft.closingVerdict || null,
      note: draft.note || null,
    });
    if (result) {
      setReviews((prev) => new Map(prev).set(caseId, result));
      updateDraft(caseId, { saving: false });
      toast({ type: 'success', message: 'Kontrol kaydedildi.' });
    } else {
      updateDraft(caseId, { saving: false });
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-brand-500" />
            <h1 className="text-lg font-semibold text-slate-900 dark:text-ndark-text">
              Vaka Etiket Doğrulama Ekranı
            </h1>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-ndark-muted">
            Açılış ve kapanış etiketlemesinin doğruluğunu işaretleyin — bilgi bankası seed'i için.
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-end gap-2">
          <Field label="Başlangıç tarihi" className="w-36">
            <TextInput type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} max={dateTo || undefined} />
          </Field>
          <Field label="Bitiş tarihi" className="w-36">
            <TextInput type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} min={dateFrom || undefined} />
          </Field>
          <Button
            leftIcon={loading ? <Loader2 size={13} className="animate-spin" /> : <Filter size={13} />}
            disabled={loading}
            onClick={() => {
              setPage(1);
              void fetchPage();
            }}
          >
            {loading ? 'Yükleniyor…' : 'Filtrele'}
          </Button>
        </div>
      </div>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-slate-500 dark:text-ndark-muted">Statü:</span>
            {CASE_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  statuses.includes(s)
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-ndark-card dark:text-ndark-link'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:text-ndark-muted'
                }`}
              >
                {STATUS_LABELS_SHORT[s]}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200 dark:border-ndark-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:bg-ndark-card dark:text-ndark-muted">
            <tr>
              <th className="px-3 py-2">Vaka</th>
              <th className="px-3 py-2">Statü</th>
              <th className="px-3 py-2">Açıklama</th>
              <th className="px-3 py-2">Açılış Etiketleri</th>
              <th className="px-3 py-2">Açılış Kontrolü</th>
              <th className="px-3 py-2">Çözüm Notu</th>
              <th className="px-3 py-2">Kapanış Etiketleri</th>
              <th className="px-3 py-2">Kapanış Kontrolü</th>
              <th className="px-3 py-2">Not</th>
              <th className="px-3 py-2">Kontrol Eden</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-slate-400 dark:text-ndark-dim">
                  <Loader2 size={16} className="mx-auto animate-spin text-brand-500" />
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-slate-400 dark:text-ndark-dim">
                  Filtreyle eşleşen vaka yok.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((c) => {
                const st = c.customFields?.smartTicket as Record<string, unknown> | undefined;
                const cl = st?.closure as Record<string, unknown> | undefined;
                const opening = extractLabels(st, OPENING_FIELDS);
                const closing = extractLabels(cl, CLOSURE_FIELDS);
                const hasClosureData = closing.some((f) => f.value);
                const review = reviews.get(c.id);
                const draft = drafts.get(c.id) ?? draftFromReview(review);

                return (
                  <tr key={c.id} className="border-t border-slate-100 align-top dark:border-ndark-border">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="font-medium text-brand-600 hover:underline dark:text-ndark-link"
                        onClick={() => onSelectCase(c.id)}
                      >
                        {c.caseNumber}
                      </button>
                      <div className="mt-0.5 max-w-[220px] truncate text-xs text-slate-500 dark:text-ndark-muted" title={c.title}>
                        {c.title}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tint="slate">{STATUS_LABELS_SHORT[c.status]}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="line-clamp-4 max-w-[200px]" title={c.description}>
                        {c.description || <span className="text-slate-400 dark:text-ndark-dim">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {opening.every((f) => !f.value) ? (
                        <span className="text-slate-400 dark:text-ndark-dim">Veri yok</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {opening.map((f) => (
                            <li key={f.label}>
                              <span className="text-slate-400 dark:text-ndark-dim">{f.label}:</span>{' '}
                              {f.value ?? <span className="text-slate-400 dark:text-ndark-dim">—</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={draft.openingVerdict}
                        onChange={(e) => updateDraft(c.id, { openingVerdict: e.target.value as TaggingVerdict | '' })}
                        className="h-8 w-32 py-1 text-xs"
                      >
                        <option value="">—</option>
                        {(['Dogru', 'Yanlis', 'Belirsiz'] as TaggingVerdict[]).map((v) => (
                          <option key={v} value={v}>
                            {VERDICT_LABELS[v]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="line-clamp-4 max-w-[200px]" title={c.resolutionNote}>
                        {c.resolutionNote || <span className="text-slate-400 dark:text-ndark-dim">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {!hasClosureData ? (
                        <span className="text-slate-400 dark:text-ndark-dim">Veri yok / Smart Ticket değil</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {closing.map((f) => (
                            <li key={f.label}>
                              <span className="text-slate-400 dark:text-ndark-dim">{f.label}:</span>{' '}
                              {f.value ?? <span className="text-slate-400 dark:text-ndark-dim">—</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={draft.closingVerdict}
                        disabled={!hasClosureData}
                        title={!hasClosureData ? 'Kapanış verisi yok' : undefined}
                        onChange={(e) => updateDraft(c.id, { closingVerdict: e.target.value as TaggingVerdict | '' })}
                        className="h-8 w-32 py-1 text-xs"
                      >
                        <option value="">—</option>
                        {(['Dogru', 'Yanlis', 'Belirsiz'] as TaggingVerdict[]).map((v) => (
                          <option key={v} value={v}>
                            {VERDICT_LABELS[v]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <TextArea
                        value={draft.note}
                        onChange={(e) => updateDraft(c.id, { note: e.target.value })}
                        rows={2}
                        className="w-44 text-xs"
                        placeholder="Not…"
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-ndark-muted">
                      {review?.reviewerName ? (
                        <>
                          <div>{review.reviewerName}</div>
                          {review.reviewedAt && (
                            <div className="text-slate-400 dark:text-ndark-dim">
                              {new Date(review.reviewedAt).toLocaleString('tr-TR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400 dark:text-ndark-dim">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Button size="sm" disabled={draft.saving} onClick={() => void saveRow(c.id)}>
                        {draft.saving ? <Loader2 size={12} className="animate-spin" /> : 'Kaydet'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-ndark-muted">
        <span>{total} vaka</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            leftIcon={<ChevronLeft size={12} />}
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Önceki
          </Button>
          <span>
            Sayfa <strong>{page}</strong> / {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            rightIcon={<ChevronRight size={12} />}
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Sonraki
          </Button>
        </div>
      </div>
    </div>
  );
}
