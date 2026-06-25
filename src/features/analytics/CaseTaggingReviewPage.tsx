import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Filter, Loader2, ShieldCheck, Tag } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextInput, TextArea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { caseService, lookupService, type SmartTicketTaxonomyResponse } from '@/services/caseService';
import { CASE_STATUSES, type Case, type CaseStatus, type CaseTaggingReview, type TaggingVerdict } from '@/features/cases/types';
import { formatDateTime } from '@/lib/format';

/**
 * Vaka Etiket Doğrulama Ekranı — Supervisor / Admin / SystemAdmin.
 *
 * Ana tablo: vaka özeti kolonları + "Etiketleri Doğrula" butonu.
 * Etiket doğrulama işi: satır başına modal'da yapılır.
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

type TaxonomyType = keyof SmartTicketTaxonomyResponse['taxonomies'];

interface TagDef {
  prefix: 'opening' | 'closing';
  field: string;
  label: string;
  customField: string;
  taxonomyType: TaxonomyType;
}

const TAG_DEFS: TagDef[] = [
  { prefix: 'opening', field: 'Platform',            label: 'Platform',          customField: 'platform',            taxonomyType: 'platform' },
  { prefix: 'opening', field: 'BusinessProcess',     label: 'İş Süreci',         customField: 'businessProcess',     taxonomyType: 'businessProcess' },
  { prefix: 'opening', field: 'OperationType',       label: 'İşlem Tipi',        customField: 'operationType',       taxonomyType: 'operationType' },
  { prefix: 'opening', field: 'AffectedObject',      label: 'Etkilenen Nesne',   customField: 'affectedObject',      taxonomyType: 'affectedObject' },
  { prefix: 'opening', field: 'Impact',              label: 'Etki',              customField: 'impact',              taxonomyType: 'impact' },
  { prefix: 'closing', field: 'RootCauseGroup',      label: 'Kök Neden Grubu',   customField: 'rootCauseGroup',      taxonomyType: 'rootCauseGroup' },
  { prefix: 'closing', field: 'RootCauseDetail',     label: 'Kök Neden Detayı',  customField: 'rootCauseDetail',     taxonomyType: 'rootCauseDetail' },
  { prefix: 'closing', field: 'ResolutionType',      label: 'Çözüm Tipi',        customField: 'resolutionType',      taxonomyType: 'resolutionType' },
  { prefix: 'closing', field: 'PermanentPrevention', label: 'Kalıcı Önlem',      customField: 'permanentPrevention', taxonomyType: 'permanentPrevention' },
];

const OPENING_DEFS = TAG_DEFS.filter((d) => d.prefix === 'opening');
const CLOSING_DEFS = TAG_DEFS.filter((d) => d.prefix === 'closing');

function tagKey(def: TagDef) {
  return `${def.prefix}${def.field}`;
}

function verdictField(def: TagDef): keyof CaseTaggingReview {
  return `${tagKey(def)}Verdict` as keyof CaseTaggingReview;
}

function correctedCodeField(def: TagDef): keyof CaseTaggingReview {
  return `${tagKey(def)}CorrectedCode` as keyof CaseTaggingReview;
}

function originalLabel(c: Case, def: TagDef): string | null {
  const smartTicket = (c.customFields?.smartTicket ?? {}) as Record<string, unknown>;
  const src = def.prefix === 'opening' ? smartTicket : ((smartTicket.closure ?? {}) as Record<string, unknown>);
  return (src?.[`${def.customField}Label`] as string | undefined) ?? null;
}

interface FieldDraft {
  verdict: TaggingVerdict | '';
  correctedCode: string;
}

interface RowDraft {
  note: string;
  saving: boolean;
  fields: Record<string, FieldDraft>;
}

function draftFromReview(r: CaseTaggingReview | undefined): RowDraft {
  const fields: Record<string, FieldDraft> = {};
  for (const def of TAG_DEFS) {
    fields[tagKey(def)] = {
      verdict: ((r?.[verdictField(def)] as TaggingVerdict | null) ?? '') as TaggingVerdict | '',
      correctedCode: (r?.[correctedCodeField(def)] as string | null) ?? '',
    };
  }
  return { note: r?.note ?? '', saving: false, fields };
}

/** Açılış/kapanış bölümü için kaç alanın verdict'i dolu — özet satırı için. */
function countVerdicts(draft: RowDraft, defs: TagDef[]): number {
  return defs.filter((d) => draft.fields[tagKey(d)]?.verdict !== '').length;
}

// Tablo hücresi için genişletilebilir metin
function ExpandableCell({ text }: { text: string }) {
  const [expanded, setExpanded]           = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) { setIsOverflowing(false); return; }
    const measure = () => { if (!expanded) setIsOverflowing(el.scrollHeight > el.clientHeight + 1); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  useEffect(() => { setExpanded(false); }, [text]);

  return (
    <div>
      <div ref={ref} className={!expanded ? 'line-clamp-2' : ''} title={!expanded ? text : undefined}>
        {text}
      </div>
      {isOverflowing && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded((v) => !v); }}
          aria-expanded={expanded}
          className="mt-0.5 text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {expanded ? 'Gizle' : 'Devamını göster'}
        </button>
      )}
    </div>
  );
}

const FILTER_KEY = 'varuna:tagging-review-filters-v2';

function formatUtcDateTime(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function loadSavedFilters() {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { dateFrom: string; dateTo: string; statuses: CaseStatus[]; teamId: string };
  } catch {
    return null;
  }
}

// ── Modal içi etiket formu ──────────────────────────────────────────────────

interface TaggingModalProps {
  case_: Case;
  review: CaseTaggingReview | undefined;
  draft: RowDraft;
  taxonomies: SmartTicketTaxonomyResponse['taxonomies'] | undefined;
  onUpdateField: (def: TagDef, patch: Partial<FieldDraft>) => void;
  onUpdateNote: (note: string) => void;
  onSave: () => Promise<void>;
  onClose: () => void;
}

function TaggingModal({
  case_,
  review,
  draft,
  taxonomies,
  onUpdateField,
  onUpdateNote,
  onSave,
  onClose,
}: TaggingModalProps) {
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSave() {
    // Yanlış → Doğru Etiket zorunlu
    const missing = TAG_DEFS.filter((def) => {
      const f = draft.fields[tagKey(def)];
      return f.verdict === 'Yanlis' && !f.correctedCode;
    });
    if (missing.length > 0) {
      setValidationError(
        `"Yanlış" işaretlenen ${missing.length} etiket için Doğru Etiket seçilmeli: ${missing.map((d) => d.label).join(', ')}`,
      );
      return;
    }
    setValidationError(null);
    await onSave();
  }

  const title = (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold">{case_.caseNumber}</span>
      <Badge tint="slate">{STATUS_LABELS_SHORT[case_.status]}</Badge>
      {case_.accountName && <span className="text-slate-500">{case_.accountName}</span>}
      {case_.companyName && <span className="text-slate-400 text-xs">/ {case_.companyName}</span>}
    </span>
  );

  const hasClosingData = CLOSING_DEFS.some((def) => originalLabel(case_, def) !== null);

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="3xl"
      height="88vh"
      bodyClassName="flex flex-col overflow-hidden"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            {validationError && (
              <p className="text-xs text-red-600 dark:text-red-400">{validationError}</p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={onClose} disabled={draft.saving}>
            Vazgeç
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={draft.saving}>
            {draft.saving ? <><Loader2 size={12} className="mr-1.5 animate-spin" />Kaydediliyor…</> : 'Kaydet'}
          </Button>
        </div>
      }
    >
      {/* İki sütun: sol metin, sağ form */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:flex-row lg:overflow-hidden">

        {/* Sol — açıklama + çözüm notu */}
        <div className="flex flex-col gap-3 lg:w-80 lg:shrink-0 lg:overflow-y-auto">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
              Açıklama
            </p>
            {case_.description
              ? <ExpandableCell text={case_.description} />
              : <span className="text-xs text-slate-400 dark:text-ndark-dim">—</span>}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
              Çözüm Notu
            </p>
            {case_.resolutionNote
              ? <ExpandableCell text={case_.resolutionNote} />
              : <span className="text-xs text-slate-400 dark:text-ndark-dim">—</span>}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
              Değerlendirme Notu
            </p>
            <TextArea
              value={draft.note}
              onChange={(e) => onUpdateNote(e.target.value)}
              rows={3}
              className="text-xs"
              placeholder="Not…"
            />
          </div>
          {review?.reviewerName && (
            <div className="text-xs text-slate-400 dark:text-ndark-dim">
              Son değerlendiren: <span className="text-slate-600 dark:text-ndark-muted">{review.reviewerName}</span>
              {review.reviewedAt && (
                <span className="ml-1">
                  ({new Date(review.reviewedAt).toLocaleString('tr-TR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })})
                </span>
              )}
            </div>
          )}
        </div>

        {/* Sağ — etiket formu */}
        <div className="min-w-0 flex-1 overflow-y-auto lg:overflow-y-auto">
          {/* Açılış Etiketleri */}
          <TagSection
            title="Açılış Etiketleri"
            defs={OPENING_DEFS}
            case_={case_}
            draft={draft}
            taxonomies={taxonomies}
            onUpdateField={onUpdateField}
          />

          {/* Kapanış Etiketleri */}
          {hasClosingData ? (
            <TagSection
              title="Kapanış Etiketleri"
              defs={CLOSING_DEFS}
              case_={case_}
              draft={draft}
              taxonomies={taxonomies}
              onUpdateField={onUpdateField}
            />
          ) : (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-ndark-text">Kapanış Etiketleri</p>
              <p className="text-xs text-slate-400 dark:text-ndark-dim">Bu vaka için kapanış etiketi verisi yok.</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface TagSectionProps {
  title: string;
  defs: TagDef[];
  case_: Case;
  draft: RowDraft;
  taxonomies: SmartTicketTaxonomyResponse['taxonomies'] | undefined;
  onUpdateField: (def: TagDef, patch: Partial<FieldDraft>) => void;
}

function TagSection({ title, defs, case_, draft, taxonomies, onUpdateField }: TagSectionProps) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-ndark-text">{title}</p>
      {/* Başlık satırı */}
      <div className="mb-1 grid grid-cols-[1fr_120px_1fr] gap-2 px-2 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-ndark-dim">
        <span>Etiket Adı / Mevcut</span>
        <span>Kontrol</span>
        <span>Doğru Etiket</span>
      </div>
      <div className="divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-ndark-border dark:border-ndark-border">
        {defs.map((def) => {
          const key             = tagKey(def);
          const field           = draft.fields[key];
          const label           = originalLabel(case_, def);
          const options         = taxonomies?.[def.taxonomyType] ?? [];
          const correctedDisabled = field.verdict === '' || field.verdict === 'Dogru';

          return (
            <div key={key} className="grid grid-cols-[1fr_120px_1fr] items-center gap-2 px-2 py-2">
              {/* Etiket Adı + Mevcut */}
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-ndark-text">{def.label}</div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-ndark-muted">
                  {label ?? <span className="text-slate-300 dark:text-ndark-dim">—</span>}
                </div>
              </div>
              {/* Kontrol */}
              <Select
                value={field.verdict}
                onChange={(e) => {
                  const v = e.target.value as TaggingVerdict | '';
                  onUpdateField(def, {
                    verdict: v,
                    ...(v !== 'Yanlis' && v !== 'Belirsiz' ? { correctedCode: '' } : {}),
                  });
                }}
                className="h-8 py-1 text-xs"
              >
                <option value="">—</option>
                {(['Dogru', 'Yanlis', 'Belirsiz'] as TaggingVerdict[]).map((v) => (
                  <option key={v} value={v}>{VERDICT_LABELS[v]}</option>
                ))}
              </Select>
              {/* Doğru Etiket */}
              <Select
                value={correctedDisabled ? '' : field.correctedCode}
                disabled={correctedDisabled}
                title={
                  field.verdict === 'Yanlis' && !field.correctedCode
                    ? 'Yanlış işaretlendi — Doğru Etiket zorunlu'
                    : correctedDisabled
                    ? 'Önce Yanlış/Belirsiz işaretleyin'
                    : undefined
                }
                onChange={(e) => onUpdateField(def, { correctedCode: e.target.value })}
                className={`h-8 py-1 text-xs ${
                  field.verdict === 'Yanlis' && !field.correctedCode && !correctedDisabled
                    ? 'border-red-400 ring-1 ring-red-400'
                    : ''
                }`}
              >
                <option value="">—</option>
                {options.map((o) => (
                  <option key={o.code} value={o.code}>{o.label}</option>
                ))}
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Ana sayfa ───────────────────────────────────────────────────────────────

export function CaseTaggingReviewPage({ onSelectCase }: CaseTaggingReviewPageProps) {
  const [dateFrom, setDateFrom] = useState(() => loadSavedFilters()?.dateFrom ?? '');
  const [dateTo, setDateTo]     = useState(() => loadSavedFilters()?.dateTo ?? '');
  const [statuses, setStatuses] = useState<CaseStatus[]>(() => loadSavedFilters()?.statuses ?? ['Çözüldü']);
  const [teamId, setTeamId]     = useState(() => loadSavedFilters()?.teamId ?? '');
  const [page, setPage]         = useState(1);
  const pageSize = 25;

  const teams = lookupService.teams();

  const [loading, setLoading]     = useState(false);
  const [exporting, setExporting] = useState(false);
  const [items, setItems]         = useState<Case[]>([]);
  const [total, setTotal]         = useState(0);
  const [reviews, setReviews]     = useState<Map<string, CaseTaggingReview>>(new Map());
  const [drafts, setDrafts]       = useState<Map<string, RowDraft>>(new Map());
  const [taxonomiesByCompany, setTaxonomiesByCompany] = useState<Map<string, SmartTicketTaxonomyResponse['taxonomies']>>(new Map());

  // Modal durumu
  const [modalCaseId, setModalCaseId] = useState<string | null>(null);

  const { toast } = useToast();

  async function fetchPage(pageOverride?: number) {
    setLoading(true);
    const result = await caseService.listTaggingReviews(
      {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        statuses: statuses.length ? statuses : undefined,
        teamId: teamId || undefined,
      },
      { page: pageOverride ?? page, pageSize },
    );
    setItems(result.items);
    setTotal(result.total);
    setReviews(result.reviews);
    setDrafts(new Map(result.items.map((c) => [c.id, draftFromReview(result.reviews.get(c.id))])));
    setLoading(false);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { items, reviews } = await caseService.exportTaggingReviews({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        statuses: statuses.length ? statuses : undefined,
        teamId: teamId || undefined,
      });

      const VERDICT_TR: Record<string, string> = { Dogru: 'Doğru', Yanlis: 'Yanlış', Belirsiz: 'Belirsiz' };

      const rows = items.map((c) => {
        const r = reviews.get(c.id);
        const row: Record<string, string> = {
          'Vaka No':              c.caseNumber,
          'Statü':                c.status,
          'Vaka Açılış':          formatUtcDateTime(c.createdAt),
          'Müşteri':              c.accountName ?? '',
          'Şirket':               c.companyName ?? '',
          'Değerlendiren':        r?.reviewerName ?? '',
          'Değerlendirme Tarihi': formatUtcDateTime(r?.reviewedAt),
          'Not':                  r?.note ?? '',
        };
        for (const def of TAG_DEFS) {
          const key      = tagKey(def);
          const prefix   = def.prefix === 'opening' ? 'Ac' : 'Ka';
          const verdictRaw = r?.[verdictField(def)] as string | null;
          const labelRaw   = r?.[`${key}CorrectedLabel` as keyof CaseTaggingReview] as string | null;
          row[`${prefix}:${def.label} Kontrol`]      = verdictRaw ? (VERDICT_TR[verdictRaw] ?? verdictRaw) : '';
          row[`${prefix}:${def.label} Doğru Etiket`] = labelRaw ?? '';
        }
        row['Son Güncelleme'] = formatUtcDateTime(r?.reviewedAt);
        return row;
      });

      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Etiket Doğrulama');
      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `Etiket_Dogrulama_${date}.xlsx`);
    } catch {
      toast({ type: 'error', message: 'Excel export başarısız.' });
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify({ dateFrom, dateTo, statuses, teamId }));
    } catch {}
  }, [dateFrom, dateTo, statuses, teamId]);

  useEffect(() => {
    void fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    const missing = Array.from(new Set(items.map((c) => c.companyId))).filter((id) => !taxonomiesByCompany.has(id));
    if (!missing.length) return;
    void Promise.all(missing.map((id) => lookupService.smartTicketTaxonomies(id))).then((results) => {
      setTaxonomiesByCompany((prev) => {
        const next = new Map(prev);
        for (const r of results) next.set(r.companyId, r.taxonomies);
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

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

  function updateFieldDraft(caseId: string, def: TagDef, patch: Partial<FieldDraft>) {
    setDrafts((prev) => {
      const next = new Map(prev);
      const cur = next.get(caseId) ?? draftFromReview(reviews.get(caseId));
      const curField = cur.fields[tagKey(def)];
      next.set(caseId, { ...cur, fields: { ...cur.fields, [tagKey(def)]: { ...curField, ...patch } } });
      return next;
    });
  }

  async function saveRow(caseId: string) {
    const draft = drafts.get(caseId);
    if (!draft) return;
    updateDraft(caseId, { saving: true });
    const patch: Record<string, unknown> = { note: draft.note || null };
    for (const def of TAG_DEFS) {
      const f = draft.fields[tagKey(def)];
      patch[verdictField(def)]       = f.verdict || null;
      // Doğru → correctedCode null gönder
      patch[correctedCodeField(def)] = f.verdict === 'Dogru' ? null : (f.correctedCode || null);
    }
    const result = await caseService.updateTaggingReview(
      caseId,
      patch as Parameters<typeof caseService.updateTaggingReview>[1],
    );
    if (result) {
      setReviews((prev) => new Map(prev).set(caseId, result));
      updateDraft(caseId, { saving: false });
      toast({ type: 'success', message: 'Kontrol kaydedildi.' });
      setModalCaseId(null);
    } else {
      updateDraft(caseId, { saving: false });
    }
  }

  function openModal(caseId: string) {
    // Modal açılırken taxonomy eksikse yükle
    const c = items.find((x) => x.id === caseId);
    if (c && !taxonomiesByCompany.has(c.companyId)) {
      void lookupService.smartTicketTaxonomies(c.companyId).then((r) => {
        setTaxonomiesByCompany((prev) => new Map(prev).set(r.companyId, r.taxonomies));
      });
    }
    setModalCaseId(caseId);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const modalCase   = modalCaseId ? items.find((c) => c.id === modalCaseId) : undefined;
  const modalDraft  = modalCaseId ? (drafts.get(modalCaseId) ?? draftFromReview(reviews.get(modalCaseId))) : undefined;
  const modalReview = modalCaseId ? reviews.get(modalCaseId) : undefined;
  const modalTaxonomies = modalCase ? taxonomiesByCompany.get(modalCase.companyId) : undefined;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Başlık + filtreler */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-brand-500" />
            <h1 className="text-lg font-semibold text-slate-900 dark:text-ndark-text">
              Vaka Etiket Doğrulama Ekranı
            </h1>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-ndark-muted">
            Her etiketi ayrı ayrı Doğru/Yanlış/Belirsiz işaretleyin; yanlış/belirsiz olanlar için doğru etiketi seçin — bilgi bankası seed'i için.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <Field label="Başlangıç tarihi" className="w-36">
            <TextInput type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} max={dateTo || undefined} />
          </Field>
          <Field label="Bitiş tarihi" className="w-36">
            <TextInput type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} min={dateFrom || undefined} />
          </Field>
          <Field label="Takım" className="w-48">
            <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Tüm takımlar</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
          <Button
            leftIcon={loading ? <Loader2 size={13} className="animate-spin" /> : <Filter size={13} />}
            disabled={loading}
            onClick={() => { setPage(1); void fetchPage(1); }}
          >
            {loading ? 'Yükleniyor…' : 'Filtrele'}
          </Button>
          <Button
            variant="outline"
            leftIcon={exporting ? <Loader2 size={13} className="animate-spin" /> : undefined}
            disabled={exporting || loading}
            onClick={() => void handleExport()}
          >
            {exporting ? 'Aktarılıyor…' : "Excel'e Aktar"}
          </Button>
        </div>
      </div>

      {/* Statü filtreleri */}
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

      {/* Ana tablo */}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200 dark:border-ndark-border">
        {/* Başlık */}
        <div className="sticky top-0 z-10 grid grid-cols-[140px_90px_120px_160px_140px_1fr_1fr_110px_110px_150px_80px] border-b border-slate-200 bg-slate-50 dark:border-ndark-border dark:bg-ndark-card">
          {['Vaka No', 'Statü', 'Vaka Açılış', 'Müşteri', 'Şirket', 'Açıklama', 'Çözüm Notu', 'Açılış Özeti', 'Kapanış Özeti', 'Kontrol Eden', ''].map((h) => (
            <div key={h} className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
              {h}
            </div>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-10 text-slate-400 dark:text-ndark-dim">
            <Loader2 size={16} className="animate-spin text-brand-500" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="py-10 text-center text-xs text-slate-400 dark:text-ndark-dim">
            Filtreyle eşleşen vaka yok.
          </div>
        )}

        {!loading && items.map((c) => {
          const review = reviews.get(c.id);
          const draft  = drafts.get(c.id) ?? draftFromReview(review);

          const openingCount  = countVerdicts(draft, OPENING_DEFS);
          const closingCount  = countVerdicts(draft, CLOSING_DEFS);
          const hasClosing    = CLOSING_DEFS.some((def) => originalLabel(c, def) !== null);

          return (
            <div
              key={c.id}
              className="grid grid-cols-[140px_90px_120px_160px_140px_1fr_1fr_110px_110px_150px_80px] items-center border-b border-slate-100 hover:bg-slate-50/50 dark:border-ndark-border dark:hover:bg-ndark-card/60"
            >
              {/* Vaka No */}
              <div className="px-3 py-2">
                <button
                  type="button"
                  className="text-sm font-medium text-brand-600 hover:underline dark:text-ndark-link"
                  onClick={() => onSelectCase(c.id)}
                >
                  {c.caseNumber}
                </button>
                <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-ndark-muted" title={c.title}>
                  {c.title}
                </div>
              </div>
              {/* Statü */}
              <div className="px-3 py-2">
                <Badge tint="slate">{STATUS_LABELS_SHORT[c.status]}</Badge>
              </div>
              {/* Vaka Açılış */}
              <div className="px-3 py-2 text-xs text-slate-600 dark:text-ndark-muted">
                {formatDateTime(c.createdAt)}
              </div>
              {/* Müşteri */}
              <div className="truncate px-3 py-2 text-xs text-slate-700 dark:text-ndark-text" title={c.accountName ?? undefined}>
                {c.accountName ?? <span className="text-slate-400">—</span>}
              </div>
              {/* Şirket */}
              <div className="truncate px-3 py-2 text-xs text-slate-700 dark:text-ndark-text" title={c.companyName ?? undefined}>
                {c.companyName ?? <span className="text-slate-400">—</span>}
              </div>
              {/* Açıklama */}
              <div className="px-3 py-2 text-xs">
                {c.description
                  ? <ExpandableCell text={c.description} />
                  : <span className="text-slate-400 dark:text-ndark-dim">—</span>}
              </div>
              {/* Çözüm Notu */}
              <div className="px-3 py-2 text-xs">
                {c.resolutionNote
                  ? <ExpandableCell text={c.resolutionNote} />
                  : <span className="text-slate-400 dark:text-ndark-dim">—</span>}
              </div>
              {/* Açılış Özeti */}
              <div className="px-3 py-2 text-xs text-slate-600 dark:text-ndark-muted">
                {openingCount > 0
                  ? <span className="font-medium text-brand-600 dark:text-ndark-link">{openingCount}/{OPENING_DEFS.length}</span>
                  : <span className="text-slate-400">—</span>}
              </div>
              {/* Kapanış Özeti */}
              <div className="px-3 py-2 text-xs text-slate-600 dark:text-ndark-muted">
                {!hasClosing
                  ? <span className="text-slate-400">—</span>
                  : closingCount > 0
                    ? <span className="font-medium text-brand-600 dark:text-ndark-link">{closingCount}/{CLOSING_DEFS.length}</span>
                    : <span className="text-slate-400">0/{CLOSING_DEFS.length}</span>}
              </div>
              {/* Kontrol Eden */}
              <div className="px-3 py-2 text-xs text-slate-600 dark:text-ndark-muted">
                {review?.reviewerName ? (
                  <>
                    <div className="truncate font-medium" title={review.reviewerName}>{review.reviewerName}</div>
                    {review.reviewedAt && (
                      <div className="text-slate-400 dark:text-ndark-dim">
                        {new Date(review.reviewedAt).toLocaleString('tr-TR', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </div>
              {/* Aksiyon */}
              <div className="px-3 py-2">
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<Tag size={11} />}
                  onClick={() => openModal(c.id)}
                >
                  Doğrula
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sayfalama */}
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
          <span>Sayfa <strong>{page}</strong> / {totalPages}</span>
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

      {/* Etiket Doğrulama Modalı */}
      {modalCase && modalDraft && (
        <TaggingModal
          case_={modalCase}
          review={modalReview}
          draft={modalDraft}
          taxonomies={modalTaxonomies}
          onUpdateField={(def, patch) => updateFieldDraft(modalCase.id, def, patch)}
          onUpdateNote={(note) => updateDraft(modalCase.id, { note })}
          onSave={() => saveRow(modalCase.id)}
          onClose={() => setModalCaseId(null)}
        />
      )}
    </div>
  );
}
