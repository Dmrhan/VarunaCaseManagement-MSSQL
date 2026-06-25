import { Fragment, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Filter, Loader2, ShieldCheck } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextInput, TextArea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { caseService, lookupService, type SmartTicketTaxonomyResponse } from '@/services/caseService';
import { CASE_STATUSES, type Case, type CaseStatus, type CaseTaggingReview, type TaggingVerdict } from '@/features/cases/types';
import { formatDateTime } from '@/lib/format';

/**
 * Vaka Etiket Doğrulama Ekranı — Supervisor / Admin / SystemAdmin.
 *
 * Bilgi bankası seed'i için: vakanın 9 etiketinin (5 açılış + 4 kapanış,
 * kapanış sadece Smart Ticket kökenli + Çözüldü vakalarda dolu) her birini
 * AYRI AYRI Doğru/Yanlış/Belirsiz olarak işaretler ve yanlış/belirsiz
 * olanlar için kendi taxonomyType dropdown'ından "doğru etiket" seçtirir.
 * Bu kayıt başka bir akışı beslemez — sadece audit/bilgi bankası amaçlı.
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
  { prefix: 'opening', field: 'Platform',          label: 'Platform',          customField: 'platform',          taxonomyType: 'platform' },
  { prefix: 'opening', field: 'BusinessProcess',   label: 'İş Süreci',         customField: 'businessProcess',   taxonomyType: 'businessProcess' },
  { prefix: 'opening', field: 'OperationType',     label: 'İşlem Tipi',        customField: 'operationType',     taxonomyType: 'operationType' },
  { prefix: 'opening', field: 'AffectedObject',    label: 'Etkilenen Nesne',   customField: 'affectedObject',    taxonomyType: 'affectedObject' },
  { prefix: 'opening', field: 'Impact',            label: 'Etki',              customField: 'impact',            taxonomyType: 'impact' },
  { prefix: 'closing', field: 'RootCauseGroup',    label: 'Kök Neden Grubu',   customField: 'rootCauseGroup',    taxonomyType: 'rootCauseGroup' },
  { prefix: 'closing', field: 'RootCauseDetail',   label: 'Kök Neden Detayı',  customField: 'rootCauseDetail',   taxonomyType: 'rootCauseDetail' },
  { prefix: 'closing', field: 'ResolutionType',    label: 'Çözüm Tipi',        customField: 'resolutionType',    taxonomyType: 'resolutionType' },
  { prefix: 'closing', field: 'PermanentPrevention', label: 'Kalıcı Önlem',    customField: 'permanentPrevention', taxonomyType: 'permanentPrevention' },
];

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

// Tablo hücresi için genişletilebilir metin — scrollHeight > clientHeight ise
// "Devamını göster" butonu gösterilir; içerik sığıyorsa buton render edilmez.
// CaseDetailPage.tsx:2998 ExpandableDescription ile aynı overflow-ölçüm pattern'i.
function ExpandableCell({ text }: { text: string }) {
  const [expanded, setExpanded]         = useState(false);
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

// Kolon genişlikleri (px).
const COL_WIDTHS: Record<string, number> = {
  caseNo: 155,
  status: 100,
  description: 280,
  resolutionNote: 280,
  createdAt: 150,
  note: 220,
  reviewer: 180,
  save: 100,
};
for (const def of TAG_DEFS) {
  const key = tagKey(def);
  COL_WIDTHS[`${key}:value`]     = 180;
  COL_WIDTHS[`${key}:verdict`]   = 150;
  COL_WIDTHS[`${key}:corrected`] = 360;
}

// Sol sabit karar alanının toplam genişliği.
const LEFT_PANEL_WIDTH =
  COL_WIDTHS.caseNo + COL_WIDTHS.status + COL_WIDTHS.description + COL_WIDTHS.resolutionNote + COL_WIDTHS.createdAt;

// İç div'in yatay scroll oluşturması için gereken minimum genişlik.
const TOTAL_WIDTH = Object.values(COL_WIDTHS).reduce((a, b) => a + b, 0);

// Header sınıf sabitleri
const HDR = 'flex items-center px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted';

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

export function CaseTaggingReviewPage({ onSelectCase }: CaseTaggingReviewPageProps) {
  const [dateFrom, setDateFrom] = useState(() => loadSavedFilters()?.dateFrom ?? '');
  const [dateTo, setDateTo]     = useState(() => loadSavedFilters()?.dateTo ?? '');
  const [statuses, setStatuses] = useState<CaseStatus[]>(() => loadSavedFilters()?.statuses ?? ['Çözüldü']);
  const [teamId, setTeamId]     = useState(() => loadSavedFilters()?.teamId ?? '');
  const [page, setPage]         = useState(1);
  const pageSize = 25;

  const teams = lookupService.teams();

  const [loading, setLoading]   = useState(false);
  const [exporting, setExporting] = useState(false);
  const [items, setItems]       = useState<Case[]>([]);
  const [total, setTotal]       = useState(0);
  const [reviews, setReviews]   = useState<Map<string, CaseTaggingReview>>(new Map());
  const [drafts, setDrafts]     = useState<Map<string, RowDraft>>(new Map());
  const [taxonomiesByCompany, setTaxonomiesByCompany] = useState<Map<string, SmartTicketTaxonomyResponse['taxonomies']>>(new Map());

  const { toast } = useToast();

  // Tek scroll container — yatay ve dikey scroll aynı element'te, sync gerekmez.
  const scrollRef = useRef<HTMLDivElement>(null);

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
          const key    = tagKey(def);
          const prefix = def.prefix === 'opening' ? 'Ac' : 'Ka';
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
      patch[correctedCodeField(def)] = f.correctedCode || null;
    }
    const result = await caseService.updateTaggingReview(
      caseId,
      patch as Parameters<typeof caseService.updateTaggingReview>[1],
    );
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

      {/*
        Tek scroll container yaklaşımı:
        - Sol hücreler (Vaka/Statü/Açıklama/Çözüm Notu) sticky left-0 → yatay scroll'da sabit.
        - Sağ hücreler aynı flex row içinde → satır yüksekliği otomatik eşit (items-stretch).
        - border-bottom row wrapper'da → sol ve sağ boyunca tek çizgi.
        - İki ayrı tablo/panel ve height sync ihtiyacı yok.
      */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200 dark:border-ndark-border"
      >
        <div style={{ minWidth: TOTAL_WIDTH }}>

          {/* ── BAŞLIK (iki satırlı, sticky top) ── */}
          <div className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50 dark:border-ndark-border dark:bg-ndark-card">

            {/* Başlık satır 1 — etiket grup başlıkları */}
            <div className="flex">
              {/* Sol köşe (sticky left) */}
              <div
                className="sticky left-0 z-30 shrink-0 border-r border-slate-200 bg-slate-50 dark:border-ndark-border dark:bg-ndark-card"
                style={{ width: LEFT_PANEL_WIDTH }}
              />
              {/* Etiket grup başlıkları */}
              {TAG_DEFS.map((def) => {
                const key = tagKey(def);
                const groupW = COL_WIDTHS[`${key}:value`] + COL_WIDTHS[`${key}:verdict`] + COL_WIDTHS[`${key}:corrected`];
                return (
                  <div
                    key={key}
                    className={`${HDR} justify-center border-l border-slate-200 dark:border-ndark-border`}
                    style={{ width: groupW, minWidth: groupW }}
                  >
                    {def.prefix === 'opening' ? 'Açılış' : 'Kapanış'}: {def.label}
                  </div>
                );
              })}
              {/* Not / Kontrol Eden başlıkları */}
              <div className={`${HDR} border-l border-slate-200 dark:border-ndark-border`} style={{ width: COL_WIDTHS.note, minWidth: COL_WIDTHS.note }}>
                Not
              </div>
              <div className={HDR} style={{ width: COL_WIDTHS.reviewer, minWidth: COL_WIDTHS.reviewer }}>
                Kontrol Eden
              </div>
              {/* Kaydet sticky-right */}
              <div
                className="sticky right-0 z-30 shrink-0 bg-slate-50 dark:bg-ndark-card"
                style={{ width: COL_WIDTHS.save }}
              />
            </div>

            {/* Başlık satır 2 — kolon alt başlıkları */}
            <div className="flex border-t border-slate-100 dark:border-ndark-border">
              {/* Sol kolon başlıkları (sticky left) */}
              <div
                className="sticky left-0 z-30 flex shrink-0 border-r border-slate-200 bg-slate-50 dark:border-ndark-border dark:bg-ndark-card"
                style={{ width: LEFT_PANEL_WIDTH }}
              >
                <div className={HDR} style={{ width: COL_WIDTHS.caseNo }}>Vaka</div>
                <div className={HDR} style={{ width: COL_WIDTHS.status }}>Statü</div>
                <div className={HDR} style={{ width: COL_WIDTHS.description }}>Açıklama</div>
                <div className={HDR} style={{ width: COL_WIDTHS.resolutionNote }}>Çözüm Notu</div>
                <div className={HDR} style={{ width: COL_WIDTHS.createdAt }}>Oluşturma Tarihi</div>
              </div>
              {/* Etiket alt başlıkları */}
              {TAG_DEFS.map((def) => {
                const key = tagKey(def);
                return (
                  <Fragment key={`${key}-sub`}>
                    <div className={`${HDR} border-l border-slate-200 dark:border-ndark-border`} style={{ width: COL_WIDTHS[`${key}:value`], minWidth: COL_WIDTHS[`${key}:value`] }}>
                      Değer
                    </div>
                    <div className={`${HDR} border-l border-slate-100 dark:border-ndark-border`} style={{ width: COL_WIDTHS[`${key}:verdict`], minWidth: COL_WIDTHS[`${key}:verdict`] }}>
                      Kontrol
                    </div>
                    <div className={`${HDR} whitespace-nowrap border-l border-slate-100 dark:border-ndark-border`} style={{ width: COL_WIDTHS[`${key}:corrected`], minWidth: COL_WIDTHS[`${key}:corrected`] }}>
                      Doğru Etiket
                    </div>
                  </Fragment>
                );
              })}
              {/* Not / Kontrol Eden alt başlık boş */}
              <div className="border-l border-slate-200 dark:border-ndark-border" style={{ width: COL_WIDTHS.note, minWidth: COL_WIDTHS.note }} />
              <div style={{ width: COL_WIDTHS.reviewer, minWidth: COL_WIDTHS.reviewer }} />
              {/* Kaydet sticky-right */}
              <div
                className="sticky right-0 z-30 shrink-0 bg-slate-50 dark:bg-ndark-card"
                style={{ width: COL_WIDTHS.save }}
              />
            </div>
          </div>

          {/* ── YÜKLENIYOR ── */}
          {loading && (
            <div className="flex items-center justify-center py-10 text-slate-400 dark:text-ndark-dim">
              <Loader2 size={16} className="animate-spin text-brand-500" />
            </div>
          )}

          {/* ── BOŞ DURUM ── */}
          {!loading && items.length === 0 && (
            <div className="py-10 text-center text-xs text-slate-400 dark:text-ndark-dim">
              Filtreyle eşleşen vaka yok.
            </div>
          )}

          {/* ── VERİ SATIRLARI ──
              Her <div> bir kayıt satırı. Sol ve sağ hücreler aynı flex row içinde
              olduğundan items-stretch sayesinde yükseklikleri otomatik eşit.
              border-bottom row düzeyinde → sol ve sağ boyunca tek çizgi.
          */}
          {!loading &&
            items.map((c) => {
              const review   = reviews.get(c.id);
              const draft    = drafts.get(c.id) ?? draftFromReview(review);
              const taxonomies = taxonomiesByCompany.get(c.companyId);

              return (
                <div
                  key={c.id}
                  className="flex items-stretch border-b border-slate-100 dark:border-ndark-border"
                >
                  {/* Sol sabit hücreler (sticky left-0) */}
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-stretch border-r border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card"
                    style={{ width: LEFT_PANEL_WIDTH }}
                  >
                    {/* Vaka */}
                    <div className="px-3 py-2" style={{ width: COL_WIDTHS.caseNo, minWidth: COL_WIDTHS.caseNo }}>
                      <button
                        type="button"
                        className="font-medium text-brand-600 hover:underline dark:text-ndark-link"
                        onClick={() => onSelectCase(c.id)}
                      >
                        {c.caseNumber}
                      </button>
                      <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-ndark-muted" title={c.title}>
                        {c.title}
                      </div>
                    </div>
                    {/* Statü */}
                    <div className="flex items-start px-3 py-2" style={{ width: COL_WIDTHS.status, minWidth: COL_WIDTHS.status }}>
                      <Badge tint="slate">{STATUS_LABELS_SHORT[c.status]}</Badge>
                    </div>
                    {/* Açıklama */}
                    <div className="px-3 py-2 text-xs" style={{ width: COL_WIDTHS.description, minWidth: COL_WIDTHS.description }}>
                      {c.description
                        ? <ExpandableCell text={c.description} />
                        : <span className="text-slate-400 dark:text-ndark-dim">—</span>}
                    </div>
                    {/* Çözüm Notu */}
                    <div className="px-3 py-2 text-xs" style={{ width: COL_WIDTHS.resolutionNote, minWidth: COL_WIDTHS.resolutionNote }}>
                      {c.resolutionNote
                        ? <ExpandableCell text={c.resolutionNote} />
                        : <span className="text-slate-400 dark:text-ndark-dim">—</span>}
                    </div>
                    {/* Oluşturma Tarihi */}
                    <div className="px-3 py-2 text-xs whitespace-nowrap" style={{ width: COL_WIDTHS.createdAt, minWidth: COL_WIDTHS.createdAt }}>
                      {formatDateTime(c.createdAt)}
                    </div>
                  </div>

                  {/* Sağ kayan etiket hücreleri */}
                  {TAG_DEFS.map((def) => {
                    const key               = tagKey(def);
                    const value             = originalLabel(c, def);
                    const field             = draft.fields[key];
                    const correctedDisabled = field.verdict === '' || field.verdict === 'Dogru';
                    const options           = taxonomies?.[def.taxonomyType] ?? [];

                    return (
                      <Fragment key={key}>
                        {/* Değer */}
                        <div
                          className="border-l border-slate-100 px-3 py-2 text-xs dark:border-ndark-border"
                          style={{ width: COL_WIDTHS[`${key}:value`], minWidth: COL_WIDTHS[`${key}:value`] }}
                        >
                          <div className="line-clamp-2" title={value ?? undefined}>
                            {value ?? <span className="text-slate-400 dark:text-ndark-dim">—</span>}
                          </div>
                        </div>
                        {/* Kontrol */}
                        <div
                          className="border-l border-slate-100 px-3 py-2 dark:border-ndark-border"
                          style={{ width: COL_WIDTHS[`${key}:verdict`], minWidth: COL_WIDTHS[`${key}:verdict`] }}
                        >
                          <Select
                            value={field.verdict}
                            onChange={(e) => {
                              const v = e.target.value as TaggingVerdict | '';
                              updateFieldDraft(c.id, def, {
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
                        </div>
                        {/* Doğru Etiket */}
                        <div
                          className="border-l border-slate-100 px-3 py-2 dark:border-ndark-border"
                          style={{ width: COL_WIDTHS[`${key}:corrected`], minWidth: COL_WIDTHS[`${key}:corrected`] }}
                        >
                          <Select
                            value={correctedDisabled ? '' : field.correctedCode}
                            disabled={correctedDisabled}
                            title={correctedDisabled ? 'Önce Yanlış/Belirsiz işaretleyin' : undefined}
                            onChange={(e) => updateFieldDraft(c.id, def, { correctedCode: e.target.value })}
                            className="h-8 py-1 text-xs"
                          >
                            <option value="">—</option>
                            {options.map((o) => (
                              <option key={o.code} value={o.code}>{o.label}</option>
                            ))}
                          </Select>
                        </div>
                      </Fragment>
                    );
                  })}

                  {/* Not */}
                  <div
                    className="border-l border-slate-100 px-3 py-2 dark:border-ndark-border"
                    style={{ width: COL_WIDTHS.note, minWidth: COL_WIDTHS.note }}
                  >
                    <TextArea
                      value={draft.note}
                      onChange={(e) => updateDraft(c.id, { note: e.target.value })}
                      rows={2}
                      className="text-xs"
                      placeholder="Not…"
                    />
                  </div>

                  {/* Kontrol Eden */}
                  <div
                    className="px-3 py-2 text-xs text-slate-500 dark:text-ndark-muted"
                    style={{ width: COL_WIDTHS.reviewer, minWidth: COL_WIDTHS.reviewer }}
                  >
                    {review?.reviewerName ? (
                      <>
                        <div>{review.reviewerName}</div>
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
                      <span className="text-slate-400 dark:text-ndark-dim">—</span>
                    )}
                  </div>

                  {/* Kaydet (sticky right-0) */}
                  <div
                    className="sticky right-0 z-10 flex shrink-0 items-center bg-white px-3 py-2 dark:bg-ndark-card"
                    style={{ width: COL_WIDTHS.save }}
                  >
                    <Button size="sm" disabled={draft.saving} onClick={() => void saveRow(c.id)}>
                      {draft.saving ? <Loader2 size={12} className="animate-spin" /> : 'Kaydet'}
                    </Button>
                  </div>
                </div>
              );
            })}
        </div>
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
    </div>
  );
}
