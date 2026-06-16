/**
 * Case Report Studio — Phase 1 UI.
 *
 * Sol panel: kategori-grup'lu column picker (search + checkbox).
 * Üst: filtre formu (date / company / status / priority / team / person / search).
 * Sağ üst: seçili kolon listesi + up/down ordering controls.
 * Orta: önizleme tablosu (50 satır).
 * Üst sağ: "Excel'e Aktar" butonu.
 *
 * Drag-and-drop YOK (Phase 1.5 — @dnd-kit ekleneceği zaman): mevcut
 * dependency'ler arasında drag-drop lib yoktu, sadece bu özellik için
 * yeni paket ekleme spec ile onaylanmamış. Up/Down arrow kontrolleri
 * yeterli ilk faz UX'i sağlıyor.
 *
 * Tenant scope tamamen backend'de enforce: buradaki filtre seçimleri
 * yalnız UX'tir, payload sızıntı yapsa bile backend allowedCompanyIds
 * intersect eder.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Filter as FilterIcon, GripVertical, Loader2, RefreshCw, Search, X } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { Card, CardBody } from '@/components/ui/Card';
import { lookupService } from '@/services/caseService';
import {
  reportService,
  type ReportColumnDef,
  type ReportColumnsResponse,
  type ReportFilters,
  type ReportPreviewResponse,
  type PivotResponse,
  type PivotMeasureFn,
  type PivotDrillResponse,
} from '@/services/reportService';
import { Modal } from '@/components/ui/Modal';
import { CASE_STATUSES, CASE_PRIORITIES } from '@/features/cases/types';

const PAGE_SIZE = 50;

function SectionTitle({ text }: { text: string }) {
  return <h3 className="text-sm font-semibold text-slate-700 dark:text-ndark-text">{text}</h3>;
}

/**
 * Phase 1.5: Seçili kolon satırı — @dnd-kit/sortable ile sürükle-bırak.
 * Yukarı/aşağı ok butonları erişilebilirlik + klavyesiz kullanıcı için
 * korunuyor (spec gereği fallback). Sürükle tutamacı (GripVertical) yalnız
 * pointer drag için listener'lı; klavye sortableKeyboardCoordinates sayesinde
 * Tab+Space ile çalışır.
 */
function SortableSelectedRow({
  id,
  index,
  label,
  total,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  id: string;
  index: number;
  label: string;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-card"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 active:cursor-grabbing dark:hover:bg-ndark-surface"
        aria-label="Sürükle"
        title="Sürükleyerek sırala"
      >
        <GripVertical size={11} />
      </button>
      <span className="w-6 text-[11px] text-slate-400">{index + 1}.</span>
      <span className="flex-1 truncate text-slate-700 dark:text-ndark-text">{label}</span>
      <button
        type="button"
        onClick={onMoveUp}
        disabled={index === 0}
        className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-ndark-surface"
        aria-label="Yukarı"
        title="Yukarı"
      >
        <ArrowUp size={11} />
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={index === total - 1}
        className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-ndark-surface"
        aria-label="Aşağı"
        title="Aşağı"
      >
        <ArrowDown size={11} />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"
        aria-label="Çıkar"
        title="Çıkar"
      >
        <X size={11} />
      </button>
    </li>
  );
}

// Phase 1.5: backend buildReportRows artık TR-formatlanmış string'leri
// döndürüyor (formatters.applyFormat); frontend yalnız ekran genişliği için
// uzun text'i truncate ediyor. Preview ve export aynı format kaynağını
// (server/lib/caseReport/formatters.js) kullanır → tek truth source.
function formatCellValue(value: unknown, type: ReportColumnDef['type']): string {
  if (value == null || value === '') return '';
  const s = typeof value === 'string' ? value : String(value);
  if (type === 'text' && s.length > 200) return s.slice(0, 200) + '…';
  return s;
}

export function CaseReportStudioPage() {
  const [columnsData, setColumnsData] = useState<ReportColumnsResponse | null>(null);
  const [loadingColumns, setLoadingColumns] = useState(true);
  const [columnsError, setColumnsError] = useState<string | null>(null);

  const [selectedColumnIds, setSelectedColumnIds] = useState<string[]>([
    'caseNumber',
    'title',
    'companyName',
    'accountName',
    'status',
    'priority',
    'assignedPersonName',
    'createdAt',
    'resolvedAt',
  ]);
  const [pickerSearch, setPickerSearch] = useState('');

  const [filters, setFilters] = useState<ReportFilters>({});
  const [previewData, setPreviewData] = useState<ReportPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);

  // Phase 3.1 — Pivot state
  const [mode, setMode] = useState<'list' | 'pivot'>('list');
  const [pivotRowId, setPivotRowId] = useState('status');
  const [pivotColId, setPivotColId] = useState('caseType');
  const [pivotMeasureFn, setPivotMeasureFn] = useState<PivotMeasureFn>('count');
  const [pivotMeasureColId, setPivotMeasureColId] = useState('');
  const [pivotData, setPivotData] = useState<PivotResponse | null>(null);
  const [pivotLoading, setPivotLoading] = useState(false);
  const [pivotError, setPivotError] = useState<string | null>(null);
  const [pivotExporting, setPivotExporting] = useState(false);
  // Phase 3.2 — Drill-down
  const [drillData, setDrillData] = useState<PivotDrillResponse | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillContext, setDrillContext] = useState<{ rowLabel: string; colLabel: string } | null>(null);

  const companies = useMemo(() => {
    try {
      return lookupService.companies();
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingColumns(true);
    void reportService.listColumns().then((res) => {
      if (cancelled) return;
      if (!res) {
        setColumnsError('Kolon listesi alınamadı.');
      } else {
        setColumnsData(res);
        setColumnsError(null);
      }
      setLoadingColumns(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const columnById = useMemo(() => {
    const m = new Map<string, ReportColumnDef>();
    if (columnsData) for (const c of columnsData.columns) m.set(c.id, c);
    return m;
  }, [columnsData]);

  function toggleColumn(id: string) {
    setSelectedColumnIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function moveColumn(id: string, delta: -1 | 1) {
    setSelectedColumnIds((prev) => {
      const i = prev.indexOf(id);
      if (i < 0) return prev;
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  // Phase 1.5 — @dnd-kit/sortable sensors. PointerSensor mouse/touch için,
  // KeyboardSensor erişilebilirlik için (Tab + Space + ok tuşları).
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSelectedColumnIds((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  async function runPreview() {
    if (selectedColumnIds.length === 0) {
      setPreviewError('Önce en az bir kolon seçin.');
      setPreviewData(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    const res = await reportService.preview(selectedColumnIds, filters, 1, PAGE_SIZE);
    setPreviewLoading(false);
    if (!res) {
      setPreviewError('Önizleme alınamadı.');
      return;
    }
    setPreviewData(res);
  }

  async function runExport() {
    if (selectedColumnIds.length === 0) return;
    setExporting(true);
    try {
      await reportService.exportXlsx(selectedColumnIds, filters);
    } finally {
      setExporting(false);
    }
  }

  // Phase 3.1 — Pivot fetch
  async function runPivot() {
    if (!pivotRowId || !pivotColId) {
      setPivotError('Satır ve kolon boyutu seçin.');
      return;
    }
    if (pivotMeasureFn !== 'count' && !pivotMeasureColId) {
      setPivotError(`'${pivotMeasureFn}' için sayısal bir ölçü kolonu seçin.`);
      return;
    }
    setPivotLoading(true);
    setPivotError(null);
    const res = await reportService.pivot({
      rowColumnId: pivotRowId,
      colColumnId: pivotColId,
      measure: {
        fn: pivotMeasureFn,
        ...(pivotMeasureFn !== 'count' && pivotMeasureColId ? { columnId: pivotMeasureColId } : {}),
      },
      filters,
    });
    setPivotLoading(false);
    if (!res) {
      setPivotError('Pivot raporu alınamadı.');
      return;
    }
    setPivotData(res);
  }

  // Phase 3.2 — Drill-down: cell tıklanınca arkaya yatan case'leri çek
  async function runDrill(rowLabel: string, colLabel: string) {
    if (!pivotData) return;
    setDrillContext({ rowLabel, colLabel });
    setDrillData(null);
    setDrillLoading(true);
    const res = await reportService.pivotDrill({
      rowColumnId: pivotData.row.id,
      colColumnId: pivotData.col.id,
      rowValue: rowLabel,
      colValue: colLabel,
      filters,
    });
    setDrillLoading(false);
    if (!res) return; // toast service tarafından
    setDrillData(res);
  }

  async function runPivotExport() {
    if (!pivotRowId || !pivotColId) return;
    if (pivotMeasureFn !== 'count' && !pivotMeasureColId) return;
    setPivotExporting(true);
    try {
      await reportService.pivotExportXlsx({
        rowColumnId: pivotRowId,
        colColumnId: pivotColId,
        measure: {
          fn: pivotMeasureFn,
          ...(pivotMeasureFn !== 'count' && pivotMeasureColId ? { columnId: pivotMeasureColId } : {}),
        },
        filters,
      });
    } finally {
      setPivotExporting(false);
    }
  }

  // Phase 3.2 — Pivotable dimension'lar: 4 source türü (aggregate dahil)
  const dimensionCandidates = useMemo(() => {
    if (!columnsData) return [] as ReportColumnDef[];
    return columnsData.columns; // tüm kolonlar dim olarak izinli (aggregate dahil)
  }, [columnsData]);

  // Measure column candidates: type='number'. count fn için her şey OK.
  const measureCandidates = useMemo(() => {
    if (!columnsData) return [] as ReportColumnDef[];
    return columnsData.columns.filter((c) => c.type === 'number');
  }, [columnsData]);

  const categoryEntries = useMemo(() => {
    if (!columnsData) return [] as { key: string; label: string; columns: ReportColumnDef[] }[];
    const groups = new Map<string, ReportColumnDef[]>();
    for (const col of columnsData.columns) {
      const list = groups.get(col.category) ?? [];
      list.push(col);
      groups.set(col.category, list);
    }
    const filteredSearch = pickerSearch.trim().toLowerCase();
    const result: { key: string; label: string; columns: ReportColumnDef[] }[] = [];
    for (const [key, cols] of groups) {
      const label = columnsData.categories[key as keyof typeof columnsData.categories] ?? key;
      const filtered = filteredSearch
        ? cols.filter(
            (c) =>
              c.label.toLowerCase().includes(filteredSearch) ||
              c.id.toLowerCase().includes(filteredSearch),
          )
        : cols;
      if (filtered.length > 0) result.push({ key, label, columns: filtered });
    }
    return result;
  }, [columnsData, pickerSearch]);

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-ndark-text">
            Vaka Rapor Stüdyosu
          </h1>
          {/* Phase 3.1 — Mod toggle */}
          <div className="inline-flex overflow-hidden rounded-md border border-slate-200 text-xs dark:border-ndark-border">
            <button
              type="button"
              onClick={() => setMode('list')}
              className={`px-3 py-1 ${mode === 'list' ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 dark:bg-ndark-card dark:text-ndark-muted'}`}
            >
              Liste
            </button>
            <button
              type="button"
              onClick={() => setMode('pivot')}
              className={`px-3 py-1 ${mode === 'pivot' ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 dark:bg-ndark-card dark:text-ndark-muted'}`}
            >
              Pivot
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {mode === 'list' && (
            <>
              <Button
                variant="outline"
                size="sm"
                leftIcon={previewLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                onClick={runPreview}
                disabled={previewLoading || selectedColumnIds.length === 0}
              >
                Önizlemeyi Yenile
              </Button>
              <Button
                size="sm"
                leftIcon={exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                onClick={runExport}
                disabled={exporting || selectedColumnIds.length === 0}
              >
                Excel'e Aktar
              </Button>
            </>
          )}
          {mode === 'pivot' && (
            <>
              <Button
                variant="outline"
                size="sm"
                leftIcon={pivotLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                onClick={runPivot}
                disabled={pivotLoading}
              >
                Pivot Hesapla
              </Button>
              <Button
                size="sm"
                leftIcon={pivotExporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                onClick={runPivotExport}
                disabled={pivotExporting || !pivotData || pivotData.rowLabels.length === 0}
              >
                Excel'e Aktar
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filtre formu */}
      <Card>
        <CardBody>
          <SectionTitle text="Filtreler" />
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Tarih Başlangıç (Açılış)">
              <TextInput
                type="date"
                value={filters.dateFrom ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value || undefined }))}
              />
            </Field>
            <Field label="Tarih Bitiş (Açılış)">
              <TextInput
                type="date"
                value={filters.dateTo ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value || undefined }))}
              />
            </Field>
            <Field label="Şirket">
              <Select
                value={(filters.companyIds as string) ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, companyIds: e.target.value ? e.target.value : undefined }))
                }
              >
                <option value="">— Hepsi —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Statü">
              <Select
                value={(filters.statuses as string) ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, statuses: e.target.value ? e.target.value : undefined }))
                }
              >
                <option value="">— Hepsi —</option>
                {CASE_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Öncelik">
              <Select
                value={(filters.priorities as string) ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, priorities: e.target.value ? e.target.value : undefined }))
                }
              >
                <option value="">— Hepsi —</option>
                {CASE_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <Field label="Arama (Vaka No / Başlık / Müşteri)">
              <TextInput
                value={filters.search ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || undefined }))}
                placeholder="örn. ödeme"
              />
            </Field>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-ndark-muted">
            <FilterIcon size={12} />
            <span>Şirket scope'u her zaman backend'de izinli şirketlerle kesişir.</span>
          </div>
        </CardBody>
      </Card>

      {mode === 'list' && (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr]">
        {/* Sol: column picker */}
        <Card>
          <CardBody className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <SectionTitle text="Kolonlar" />
              <span className="text-xs text-slate-500 dark:text-ndark-muted">
                Seçili: {selectedColumnIds.length}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Search size={12} className="text-slate-400" />
              <TextInput
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Kolon ara…"
                className="flex-1"
              />
            </div>
            {loadingColumns && (
              <p className="text-xs text-slate-500">
                <Loader2 size={11} className="inline animate-spin" /> Kolonlar yükleniyor…
              </p>
            )}
            {columnsError && (
              <p className="text-xs text-rose-600">{columnsError}</p>
            )}
            {categoryEntries.length === 0 && !loadingColumns && !columnsError && (
              <p className="text-xs text-slate-500">Eşleşen kolon yok.</p>
            )}
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {categoryEntries.map((g) => (
                <div key={g.key}>
                  <div className="text-[11px] font-semibold uppercase text-slate-500 dark:text-ndark-muted">
                    {g.label}
                  </div>
                  <ul className="space-y-0.5">
                    {g.columns.map((col) => {
                      const checked = selectedColumnIds.includes(col.id);
                      return (
                        <li key={col.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-ndark-card">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleColumn(col.id)}
                            />
                            <span className="flex-1 truncate text-slate-700 dark:text-ndark-text">{col.label}</span>
                            <span className="text-[10px] text-slate-400">{col.type}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Sağ: seçili kolonlar — sıralama */}
        <Card>
          <CardBody className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <SectionTitle text="Seçili Kolonlar" />
              <span className="text-xs text-slate-500 dark:text-ndark-muted">
                Sürükleyerek veya oklarla sıralayın
              </span>
            </div>
            {selectedColumnIds.length === 0 ? (
              <p className="text-xs text-slate-500">Henüz kolon seçilmedi.</p>
            ) : (
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={selectedColumnIds} strategy={verticalListSortingStrategy}>
                  <ul className="space-y-1">
                    {selectedColumnIds.map((id, idx) => {
                      const col = columnById.get(id);
                      if (!col) return null;
                      return (
                        <SortableSelectedRow
                          key={id}
                          id={id}
                          index={idx}
                          label={col.label}
                          total={selectedColumnIds.length}
                          onMoveUp={() => moveColumn(id, -1)}
                          onMoveDown={() => moveColumn(id, 1)}
                          onRemove={() => toggleColumn(id)}
                        />
                      );
                    })}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
          </CardBody>
        </Card>
      </div>
      )}

      {mode === 'list' && (
      /* Önizleme tablosu */
      <Card>
        <CardBody className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle text="Önizleme" />
            {previewData && (
              <span className="text-xs text-slate-500 dark:text-ndark-muted">
                Toplam {previewData.total} · Sayfa {previewData.page} (×{previewData.pageSize})
              </span>
            )}
          </div>
          {previewError && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
              {previewError}
            </p>
          )}
          {!previewData && !previewLoading && !previewError && (
            <p className="text-xs text-slate-500">
              "Önizlemeyi Yenile" ile sorgu çalıştırın.
            </p>
          )}
          {previewLoading && (
            <p className="text-xs text-slate-500">
              <Loader2 size={11} className="inline animate-spin" /> Önizleme yükleniyor…
            </p>
          )}
          {previewData && previewData.rows.length === 0 && !previewLoading && (
            <p className="text-xs text-slate-500">Filtrelere göre sonuç yok.</p>
          )}
          {previewData && previewData.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-ndark-border dark:bg-ndark-card">
                    {previewData.columns.map((c) => (
                      <th
                        key={c.id}
                        className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-slate-700 dark:text-ndark-text"
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.rows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-slate-100 hover:bg-slate-50 dark:border-ndark-border dark:hover:bg-ndark-card"
                    >
                      {previewData.columns.map((c) => (
                        <td
                          key={c.id}
                          className="max-w-[280px] truncate px-2 py-1 text-slate-700 dark:text-ndark-text"
                          title={String(row[c.id] ?? '')}
                        >
                          {formatCellValue(row[c.id], c.type)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
      )}

      {/* Phase 3.1 — Pivot Mode */}
      {mode === 'pivot' && (
        <>
          <Card>
            <CardBody className="space-y-2">
              <SectionTitle text="Pivot Yapılandırma" />
              <p className="text-xs text-slate-500 dark:text-ndark-muted">
                Satır × Kolon × Ölçü. Aggregate kolonları Phase 3.2'de eklenecek; şimdilik
                Case alanları (Smart Ticket dahil) seçilebilir.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Satır Boyutu">
                  <Select value={pivotRowId} onChange={(e) => setPivotRowId(e.target.value)}>
                    <option value="">— Seç —</option>
                    {dimensionCandidates.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Kolon Boyutu">
                  <Select value={pivotColId} onChange={(e) => setPivotColId(e.target.value)}>
                    <option value="">— Seç —</option>
                    {dimensionCandidates.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Ölçü Fonksiyonu">
                  <Select
                    value={pivotMeasureFn}
                    onChange={(e) => setPivotMeasureFn(e.target.value as PivotMeasureFn)}
                  >
                    <option value="count">Sayım (count)</option>
                    <option value="sum">Toplam (sum)</option>
                    <option value="avg">Ortalama (avg)</option>
                    <option value="min">En küçük (min)</option>
                    <option value="max">En büyük (max)</option>
                  </Select>
                </Field>
                <Field
                  label="Ölçü Kolonu"
                  hint={pivotMeasureFn === 'count' ? 'count fonksiyonunda gerek yok' : 'Sayısal kolon'}
                >
                  <Select
                    value={pivotMeasureColId}
                    onChange={(e) => setPivotMeasureColId(e.target.value)}
                    disabled={pivotMeasureFn === 'count'}
                  >
                    <option value="">— Seç —</option>
                    {measureCandidates.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <SectionTitle text="Pivot Tablosu" />
                {pivotData && (
                  <span className="text-xs text-slate-500 dark:text-ndark-muted">
                    {pivotData.total} satır pivotlandı · {pivotData.rowLabels.length} × {pivotData.colLabels.length}
                  </span>
                )}
              </div>
              {pivotError && (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                  {pivotError}
                </p>
              )}
              {!pivotData && !pivotLoading && !pivotError && (
                <p className="text-xs text-slate-500">"Pivot Hesapla" ile sorgu çalıştırın.</p>
              )}
              {pivotLoading && (
                <p className="text-xs text-slate-500">
                  <Loader2 size={11} className="inline animate-spin" /> Pivot hesaplanıyor…
                </p>
              )}
              {pivotData && pivotData.rowLabels.length === 0 && !pivotLoading && (
                <p className="text-xs text-slate-500">Filtrelere göre sonuç yok.</p>
              )}
              {pivotData && pivotData.rowLabels.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 dark:border-ndark-border dark:bg-ndark-card">
                        <th className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-2 py-1.5 text-left font-medium text-slate-700 dark:bg-ndark-card dark:text-ndark-text">
                          {pivotData.row.label} ↓ / {pivotData.col.label} →
                        </th>
                        {pivotData.colLabels.map((c) => (
                          <th key={c} className="whitespace-nowrap px-2 py-1.5 text-right font-medium text-slate-700 dark:text-ndark-text">
                            {c}
                          </th>
                        ))}
                        <th className="whitespace-nowrap px-2 py-1.5 text-right font-semibold text-slate-700 dark:text-ndark-text">
                          Toplam
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pivotData.rowLabels.map((r) => (
                        <tr key={r} className="border-b border-slate-100 hover:bg-slate-50 dark:border-ndark-border dark:hover:bg-ndark-card">
                          <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1 font-medium text-slate-700 dark:bg-ndark-surface dark:text-ndark-text">
                            {r}
                          </td>
                          {pivotData.colLabels.map((c) => {
                            const v = pivotData.matrix[r]?.[c];
                            const display = formatPivotCell(v, pivotData.measure.fn);
                            const clickable = v != null && display !== '—' && display !== '0';
                            return (
                              <td key={c} className="px-2 py-1 text-right text-slate-700 dark:text-ndark-text">
                                {clickable ? (
                                  <button
                                    type="button"
                                    onClick={() => void runDrill(r, c)}
                                    className="text-brand-700 hover:underline dark:text-brand-300"
                                    title="Bu hücreye katkı veren vakaları gör"
                                  >
                                    {display}
                                  </button>
                                ) : (
                                  display
                                )}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1 text-right font-semibold text-slate-700 dark:text-ndark-text">
                            {formatPivotCell(pivotData.rowTotals[r], pivotData.measure.fn)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-300 bg-slate-50 dark:border-ndark-border dark:bg-ndark-card">
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-2 py-1 font-semibold text-slate-700 dark:bg-ndark-card dark:text-ndark-text">
                          Toplam
                        </td>
                        {pivotData.colLabels.map((c) => (
                          <td key={c} className="px-2 py-1 text-right font-semibold text-slate-700 dark:text-ndark-text">
                            {formatPivotCell(pivotData.colTotals[c], pivotData.measure.fn)}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right font-bold text-slate-900 dark:text-ndark-text">
                          {formatPivotCell(pivotData.grandTotal, pivotData.measure.fn)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Phase 3.2 — Drill-down modal */}
          <Modal
            open={drillContext != null}
            onClose={() => { setDrillContext(null); setDrillData(null); }}
            size="3xl"
            title={
              drillContext ? (
                <span className="text-sm">
                  Hücre detayı: <strong>{drillContext.rowLabel}</strong> × <strong>{drillContext.colLabel}</strong>
                  {drillData && <span className="ml-2 text-xs font-normal text-slate-500">— {drillData.total} vaka</span>}
                </span>
              ) : null
            }
          >
            <div className="p-3">
              {drillLoading && (
                <p className="text-xs text-slate-500">
                  <Loader2 size={11} className="inline animate-spin" /> Vakalar yükleniyor…
                </p>
              )}
              {drillData && drillData.rows.length === 0 && !drillLoading && (
                <p className="text-xs text-slate-500">Bu hücreye katkı veren vaka yok.</p>
              )}
              {drillData && drillData.rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 dark:border-ndark-border dark:bg-ndark-card">
                        {drillData.columns.map((c) => (
                          <th key={c.id} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-slate-700 dark:text-ndark-text">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {drillData.rows.map((row, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 dark:border-ndark-border dark:hover:bg-ndark-card">
                          {drillData.columns.map((c) => (
                            <td
                              key={c.id}
                              className="max-w-[260px] truncate px-2 py-1 text-slate-700 dark:text-ndark-text"
                              title={String(row[c.id] ?? '')}
                            >
                              {formatCellValue(row[c.id], c.type)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}

function formatPivotCell(value: number | null | undefined, fn: PivotMeasureFn): string {
  if (value == null) return '—';
  if (!Number.isFinite(value)) return '—';
  if (fn === 'avg') return value.toFixed(2);
  // count/sum/min/max → integer veya float ise 0-2 ondalık
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}
