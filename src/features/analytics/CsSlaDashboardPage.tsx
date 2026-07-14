/**
 * CsSlaDashboardPage — CS Yönetim Panosu (SLA İzleme). 2026-07-13
 *
 * n4b dönemindeki Power BI panosunun Varuna içi birebiri. Yetki: TÜM roller
 * (bilinçli). Veri: GET /api/analytics/sla-dashboard.
 *
 * DAVRANIŞ SÖZLEŞMESİ (kullanıcı akış istekleri + 21 bulguluk denetim):
 *  1. Açılış VERİ ÇEKMEZ — yalnız ucuz optionsOnly çağrısı dropdown'ları
 *     doldurur. Varsayılan taslak = içinde bulunulan YIL (performans:
 *     Filtrele tam-tenant yerine yıl penceresi tarar; kullanıcı yılı
 *     kaldırarak bilinçli tüm-zamanlar sorgusu atabilir).
 *  2. Seçimler TASLAKTA birikir; sorgu yalnız "Filtrele" ile atılır.
 *     Uygulanmıştan sapınca buton vurgulanır + "uygulanmadı" uyarısı.
 *  3. Seçenek listeleri sorgu sonrası KASKAD (kendini-dışla) daralır;
 *     listeden düşen seçim panelde sabit kalır, tek tek kaldırılabilir.
 *  4. "Filtreleri Temizle" SORGU ATMAZ; taslak varsayılana, tablo boşa,
 *     seçenekler açılış evrenine döner.
 *  5. Sayfalama/sayfa-boyutu uygulanmış filtrede anında; Export uygulanmış
 *     filtrenin TAM setini indirir (taslak uygulanmadıysa uyarır).
 *  6. Eşzamanlı sorgu yarışına karşı yalnız SON isteğin yanıtı işlenir.
 *  7. Ay, Yıl seçilmeden kilitli (sunucu yılsız ayı yok sayar — sessiz
 *     yanlış sonuç tuzağı).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, FilterX, Loader2, RefreshCw, Search, SearchX } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import {
  analyticsService,
  type SlaDashboardFilters,
  type SlaDashboardResponse,
  type SlaDashboardRow,
} from '../../services/analyticsService';
// Codex #532 P2: Expert eksikti — paylaşılan sabiti reuse et (L1/L2/L3/Expert)
import { SUPPORT_LEVELS, SUPPORT_LEVEL_LABELS } from '../cases/types';

const STATUS_TR: Record<string, string> = {
  Acik: 'Açık',
  Incelemede: 'İncelemede',
  ThirdPartyWaiting: '3rd Party',
  Eskalasyon: 'Eskalasyon',
  Cozuldu: 'Çözüldü',
  YenidenAcildi: 'Yeniden Açıldı',
  IptalEdildi: 'İptal Edildi',
};
const PRIORITY_TR: Record<string, string> = {
  Low: 'Düşük',
  Medium: 'Orta',
  High: 'Yüksek',
  Critical: 'Kritik',
};
const OPEN_AGE_OPTIONS = ['0-1', '1-3', '3-7', '7+'];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1];
const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];
const PAGE_SIZES = [20, 50, 100];
/** Varsayılan taslak — performans penceresi (sözleşme md. 1). */
const DEFAULT_DRAFT: SlaDashboardFilters = { year: CURRENT_YEAR };

const nf = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('tr-TR');

/** Kalan-süre hücresi: değer + orta çizgili mini veri çubuğu (mockup'taki). */
function BarCell({ value, span, unit }: { value: number | null; span: number; unit: string }) {
  if (value == null) return <span className="text-slate-400 dark:text-ndark-dim">—</span>;
  const pct = Math.min((Math.abs(value) / span) * 50, 50);
  const tone = value < 0 ? 'crit' : value < span * 0.15 ? 'warn' : 'ok';
  const textCls =
    tone === 'crit'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-emerald-600 dark:text-emerald-400';
  const fillCls = tone === 'crit' ? 'bg-red-600' : tone === 'warn' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex min-w-[130px] items-center justify-end gap-2" title={`${nf.format(value)} ${unit}`}>
      <span className={`min-w-[56px] text-right font-semibold tabular-nums ${textCls}`}>
        {nf.format(value)}
      </span>
      <span className="relative h-2 w-16 shrink-0 overflow-hidden rounded-full bg-slate-200 dark:bg-ndark-bg">
        <span className="absolute inset-y-0 left-1/2 w-px bg-slate-400/60" />
        <span
          className={`absolute inset-y-0 rounded-full ${fillCls}`}
          style={value < 0 ? { right: '50%', width: `${pct}%` } : { left: '50%', width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

function UyumPill({ value }: { value: boolean | null }) {
  if (value == null) return <span className="text-slate-400 dark:text-ndark-dim">—</span>;
  return value ? (
    <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
      Evet
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">
      Hayır
    </span>
  );
}

function DeptChip({ label }: { label: string | null }) {
  if (!label) return <span className="text-slate-400 dark:text-ndark-dim">—</span>;
  return (
    <span className="inline-block rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-muted">
      {label}
    </span>
  );
}

/**
 * Checkbox'lı filtre dropdown'u — çoklu (default) ya da tekil mod.
 * Denetim düzeltmeleri: 12+ seçenekte arama kutusu; seçili-ama-listede-yok
 * değerler panelin başında kalır (kaskad daralmada seçim kaybolmaz, geri
 * alınabilir); disabled modu (Ay, Yıl'sız kilitli).
 */
function MultiDropdown({
  label,
  options,
  values,
  onChange,
  multiple = true,
  disabled = false,
  disabledHint,
}: {
  label: string;
  options: Array<{ v: string; l: string }>;
  values: string[];
  onChange: (vals: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const labelOf = (v: string) => options.find((o) => o.v === v)?.l;
  const summary =
    values.length === 0
      ? 'Tümü'
      : values.length === 1
        ? (labelOf(values[0]) ?? '1 seçili')
        : `${values.length} seçili`;
  const toggle = (v: string) => {
    if (!multiple) {
      onChange(values.includes(v) ? [] : [v]);
      setOpen(false);
      return;
    }
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };
  const qNorm = q.trim().toLocaleLowerCase('tr');
  const shown = qNorm ? options.filter((o) => o.l.toLocaleLowerCase('tr').includes(qNorm)) : options;
  // Kaskad daralmada listeden düşen seçimler — panelde sabit kalır
  const missing = values.filter((v) => !options.some((o) => o.v === v));

  return (
    <div className="relative" ref={ref}>
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
        {label}
      </span>
      <button
        type="button"
        disabled={disabled}
        title={disabled ? disabledHint : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-1 rounded-lg border bg-white px-2 py-1.5 text-left text-xs outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-ndark-card ${
          values.length
            ? 'border-brand-400 text-brand-700 dark:text-ndark-link'
            : 'border-slate-200 text-slate-800 dark:border-ndark-border dark:text-ndark-text'
        }`}
      >
        <span className="truncate">{disabled ? (disabledHint ?? 'Tümü') : summary}</span>
        <ChevronDown size={12} className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-60 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-ndark-border dark:bg-ndark-card">
          {options.length > 12 && (
            <div className="sticky top-0 mb-1 flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 dark:border-ndark-border dark:bg-ndark-card">
              <Search size={11} className="shrink-0 text-slate-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ara…"
                className="w-full bg-transparent text-xs text-slate-800 outline-none dark:text-ndark-text"
              />
            </div>
          )}
          {values.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mb-0.5 w-full rounded px-2 py-1 text-left text-[11px] font-semibold text-brand-600 hover:bg-brand-50/60 dark:text-ndark-link dark:hover:bg-ndark-bg"
            >
              Seçimi temizle
            </button>
          )}
          {missing.map((v) => (
            <label
              key={`missing-${v}`}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:text-ndark-muted dark:hover:bg-ndark-bg"
              title="Bu seçim, diğer filtrelerin daralttığı listede yok; buradan kaldırabilirsiniz"
            >
              <input type="checkbox" checked onChange={() => toggle(v)} className="accent-brand-600" />
              <span className="truncate italic">{labelOf(v) ?? v} (listede değil)</span>
            </label>
          ))}
          {shown.map((o) => (
            <label
              key={o.v}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:text-ndark-text dark:hover:bg-ndark-bg"
            >
              <input
                type="checkbox"
                checked={values.includes(o.v)}
                onChange={() => toggle(o.v)}
                className="accent-brand-600"
              />
              <span className="truncate">{o.l}</span>
            </label>
          ))}
          {shown.length === 0 && missing.length === 0 && (
            <div className="px-2 py-2 text-[11px] text-slate-400 dark:text-ndark-dim">
              {qNorm ? 'Aramayla eşleşen yok' : 'Seçenek yok'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  onSelectCase?: (caseId: string) => void;
}

export function CsSlaDashboardPage({ onSelectCase }: Props) {
  // Sözleşme md. 1-2: taslak varsayılanı = bu yıl; veri ancak Filtrele'yle.
  const [draft, setDraft] = useState<SlaDashboardFilters>(DEFAULT_DRAFT);
  const [applied, setApplied] = useState<SlaDashboardFilters | null>(null);
  const [data, setData] = useState<SlaDashboardResponse | null>(null);
  const [options, setOptions] = useState<SlaDashboardResponse['options'] | null>(null);
  const initialOptionsRef = useRef<SlaDashboardResponse['options'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();
  // Sözleşme md. 6 — yarış guard'ı: yalnız SON isteğin yanıtı işlenir.
  const reqIdRef = useRef(0);

  const load = useCallback(async (f: SlaDashboardFilters) => {
    const myId = ++reqIdRef.current;
    setLoading(true);
    const res = await analyticsService.getSlaDashboard(f);
    if (myId !== reqIdRef.current) return; // eski istek — yeni durumu ezme
    if (res) {
      setData(res);
      setOptions(res.options); // kaskad seçenekler sorgu sonucundan
      setLoadFailed(false);
    } else {
      setLoadFailed(true); // varsa eski data korunur; başlıkta uyarı çıkar
    }
    setLoading(false);
  }, []);

  // Açılış: yalnız ucuz seçenek çağrısı (vaka taraması yok) — tablo boş bekler.
  useEffect(() => {
    void (async () => {
      const res = await analyticsService.getSlaDashboardOptions();
      if (res) {
        setOptions((prev) => prev ?? res.options); // ilk sorgu erken bittiyse ezme
        initialOptionsRef.current = res.options;
      }
    })();
  }, []);

  useEffect(() => {
    if (applied) void load(applied);
  }, [applied, load]);

  const set = (patch: Partial<SlaDashboardFilters>) =>
    setDraft((d) => ({ ...d, ...patch }));

  // dirty: dizi SIRASINDAN bağımsız (denetim: aynı küme farklı sıra ≠ değişiklik)
  const normalizeF = (f: SlaDashboardFilters) =>
    JSON.stringify({
      y: f.year ?? null, m: f.month ?? null,
      c: [...(f.companyId ?? [])].sort(), w: [...(f.waitingDept ?? [])].sort(),
      l: [...(f.supportLevel ?? [])].sort(), s: [...(f.status ?? [])].sort(),
      a: [...(f.accountId ?? [])].sort(), o: [...(f.openAge ?? [])].sort(),
      r: [...(f.requestType ?? [])].sort(),
    });
  // Uyarı yalnız uygulanmış bir sorgudan SAPINCA anlamlı (açılışta değil)
  const dirty = applied !== null && normalizeF(draft) !== normalizeF(applied);
  const applyFilters = () => setApplied({ ...draft, page: 1, pageSize: applied?.pageSize });
  // Sözleşme md. 4: Temizle SORGU ATMAZ — varsayılan taslağa döner.
  const clearFilters = () => {
    // Codex #532 P2: uçan bir load() varsa iptal et — yoksa geç dönen yanıt
    // temizlenen tabloyu geri doldurur (reqIdRef bump = o yanıt yok sayılır).
    reqIdRef.current += 1;
    setLoading(false);
    setDraft(DEFAULT_DRAFT);
    setApplied(null);
    setData(null);
    setLoadFailed(false);
    if (initialOptionsRef.current) setOptions(initialOptionsRef.current);
  };

  const kpis = data?.kpis;
  const pct = (n: number, d: number) => (d > 0 ? `%${nf.format((n / d) * 100).replace(',00', ',0')}` : '—');

  // Excel export — uygulanmış filtrenin TAM seti (sözleşme md. 5)
  async function handleExport() {
    if (!applied) return;
    setExporting(true);
    try {
      const res = await analyticsService.exportSlaDashboard(applied);
      if (!res) return;
      const rows = res.rows.map((r) => ({
        'Müşteri (Proje)': r.accountName ?? '',
        'Öncelik': PRIORITY_TR[r.priority ?? ''] ?? r.priority ?? '',
        'Bölüm': r.teamName ?? '',
        'Vaka No': r.caseNumber,
        'DevOps No': r.devopsIds.join(', '),
        'Sahibi': r.ownerName ?? '',
        'Bekleyen Bölüm': r.waitingDept,
        'Durum': STATUS_TR[r.status] ?? r.status,
        'Support Seviyesi': r.supportLevel ?? '',
        'Çözüm Uyum': r.resolutionOnTarget == null ? '' : r.resolutionOnTarget ? 'Evet' : 'Hayır',
        'Hedef Çözüm (gün)': r.resolutionTargetDays,
        'Geçen (gün)': r.resolutionElapsedDays,
        'Kalan (gün)': r.resolutionRemainingDays,
        'Müdahale Uyum': r.responseOnTarget == null ? '' : r.responseOnTarget ? 'Evet' : 'Hayır',
        'Hedef Müdahale (dk)': r.responseTargetMin,
        'Müd. Kalan (dk)': r.responseRemainingMin,
        'Müd. Geçen (dk)': r.responseElapsedMin,
      }));
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'SLA İzleme');
      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `SLA_Izleme_${date}.xlsx`);
      if (res.exportTruncated) {
        toast({ type: 'info', message: 'Satır tavanı aşıldı — ilk 20.000 satır aktarıldı; filtreyi daraltın.' });
      }
    } catch {
      toast({ type: 'error', message: 'Excel export başarısız.' });
    } finally {
      setExporting(false);
    }
  }

  const filterDefs = useMemo(
    () => [
      {
        key: 'companyId',
        label: 'Şirket',
        multiple: true,
        disabled: false,
        disabledHint: undefined as string | undefined,
        values: draft.companyId ?? [],
        options: (options?.companies ?? []).map((c) => ({ v: c.id, l: c.name })),
        onChange: (vals: string[]) => set({ companyId: vals }),
      },
      {
        key: 'year',
        label: 'Yıl',
        multiple: false,
        disabled: false,
        disabledHint: undefined as string | undefined,
        values: draft.year ? [String(draft.year)] : [],
        options: YEARS.map((y) => ({ v: String(y), l: String(y) })),
        onChange: (vals: string[]) =>
          set({ year: vals[0] ? Number(vals[0]) : null, month: vals[0] ? draft.month : null }),
      },
      {
        key: 'month',
        label: 'Ay',
        multiple: false,
        // Denetim: yılsız ay sunucuda yok sayılır (sessiz yanlış sonuç) — kilitli
        disabled: !draft.year,
        disabledHint: 'Önce yıl seçin',
        values: draft.month ? [String(draft.month)] : [],
        options: MONTHS.map((m, i) => ({ v: String(i + 1), l: m })),
        onChange: (vals: string[]) => set({ month: vals[0] ? Number(vals[0]) : null }),
      },
      {
        key: 'waitingDept',
        label: 'Bekleyen Bölüm',
        multiple: true,
        disabled: false,
        disabledHint: undefined as string | undefined,
        values: draft.waitingDept ?? [],
        options: (options?.waitingDepts ?? []).map((d) => ({ v: d, l: d })),
        onChange: (vals: string[]) => set({ waitingDept: vals }),
      },
      {
        key: 'supportLevel',
        label: 'Support L1-L2',
        multiple: true,
        disabled: false,
        disabledHint: undefined as string | undefined,
        values: draft.supportLevel ?? [],
        options: SUPPORT_LEVELS.map((lv) => ({ v: lv, l: SUPPORT_LEVEL_LABELS[lv] })),
        onChange: (vals: string[]) => set({ supportLevel: vals }),
      },
      {
        key: 'status',
        label: 'Vaka Durumu',
        multiple: true,
        disabled: false,
        disabledHint: undefined as string | undefined,
        values: draft.status ?? [],
        options: (options?.statuses ?? []).map((s) => ({ v: s, l: s })),
        onChange: (vals: string[]) => set({ status: vals }),
      },
      {
        key: 'accountId',
        label: 'Müşteri (Proje)',
        multiple: true,
        disabled: false,
        disabledHint: undefined as string | undefined,
        values: draft.accountId ?? [],
        options: (options?.accounts ?? []).map((a) => ({ v: a.id, l: a.name })),
        onChange: (vals: string[]) => set({ accountId: vals }),
      },
      {
        key: 'openAge',
        label: 'Açık Kalma Aralığı',
        multiple: true,
        disabled: false,
        disabledHint: undefined as string | undefined,
        values: draft.openAge ?? [],
        options: OPEN_AGE_OPTIONS.map((b) => ({ v: b, l: `${b} gün` })),
        onChange: (vals: string[]) => set({ openAge: vals }),
      },
      {
        key: 'requestType',
        label: 'Bildirim Tipi',
        multiple: true,
        disabled: false,
        disabledHint: undefined as string | undefined,
        values: draft.requestType ?? [],
        options: (options?.requestTypes ?? []).map((t) => ({ v: t, l: t })),
        onChange: (vals: string[]) => set({ requestType: vals }),
      },
    ],
    // Denetim P1 düzeltmesi: options bağımlılığı olmadan açılış seçenekleri
    // dropdown'lara hiç yansımıyordu ([draft, data] yanlıştı).
    [draft, options],
  );

  // Varsayılan yıl "filtre sayısına" girmez — sayaç bilinçli seçimleri sayar
  const activeFilterCount =
    (draft.companyId?.length ?? 0) +
    (draft.year && draft.year !== CURRENT_YEAR ? 1 : 0) +
    (draft.month ? 1 : 0) +
    (draft.waitingDept?.length ?? 0) +
    (draft.supportLevel?.length ?? 0) +
    (draft.status?.length ?? 0) +
    (draft.accountId?.length ?? 0) +
    (draft.openAge?.length ?? 0) +
    (draft.requestType?.length ?? 0);
  const showClear = activeFilterCount > 0 || applied !== null;

  // Uygulanan filtre özeti — "neye bakıyorum?" ekranda görünür (denetim ux)
  const appliedChips = useMemo(() => {
    if (!applied || !data) return [];
    const chips: string[] = [];
    if (applied.year) chips.push(`Yıl: ${applied.year}${applied.month ? ' · ' + MONTHS[applied.month - 1] : ''}`);
    if (applied.companyId?.length) {
      const names = applied.companyId.map((id) => options?.companies.find((c) => c.id === id)?.name ?? 'şirket');
      chips.push(`Şirket: ${names.join(', ')}`);
    }
    if (applied.status?.length) chips.push(`Durum: ${applied.status.join(', ')}`);
    if (applied.waitingDept?.length) chips.push(`Bekleyen: ${applied.waitingDept.join(', ')}`);
    if (applied.supportLevel?.length) chips.push(`Seviye: ${applied.supportLevel.join(', ')}`);
    if (applied.accountId?.length) {
      const names = applied.accountId
        .map((id) => options?.accounts.find((a) => a.id === id)?.name)
        .filter(Boolean) as string[];
      chips.push(names.length === applied.accountId.length
        ? `Müşteri: ${names.join(', ')}`
        : `Müşteri: ${applied.accountId.length} seçili`);
    }
    if (applied.openAge?.length) chips.push(`Açık kalma: ${applied.openAge.join(', ')} gün`);
    if (applied.requestType?.length) chips.push(`Tip: ${applied.requestType.join(', ')}`);
    return chips.length ? chips : ['Filtre yok — tüm liste'];
  }, [applied, data, options]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5">
      {/* Başlık + araçlar */}
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-xl font-bold text-slate-800 dark:text-ndark-text">
          CS Yönetim Panosu — SLA İzleme
        </h1>
        <div className="ml-auto flex items-center gap-2">
          {showClear && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-red-400 hover:text-red-600 dark:border-ndark-border dark:text-ndark-muted"
              title="Taslağı varsayılana, tabloyu boşa döndürür — sorgu atmaz"
            >
              <FilterX size={13} /> Filtreleri Temizle{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={!applied || exporting || loading}
            className="relative inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-600 disabled:opacity-50 dark:border-ndark-border dark:text-ndark-muted"
            title={dirty
              ? 'Dikkat: taslak filtre uygulanmadı — export UYGULANAN filtreyle iner'
              : "Filtrelenmiş tüm listeyi Excel'e aktar"}
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {exporting ? 'Aktarılıyor…' : "Excel'e Aktar"}
            {dirty && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500" />}
          </button>
          <button
            type="button"
            onClick={() => applied && void load(applied)}
            disabled={!applied || loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-600 disabled:opacity-50 dark:border-ndark-border dark:text-ndark-muted"
            title="Yenile (uygulanan filtreyle)"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Yenile
          </button>
        </div>
      </div>
      <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-500 dark:text-ndark-muted">
        Tüm vakaların <b>çözüm ve müdahale SLA</b> durumu tek tabloda: hedef, geçen ve kalan
        süreler; gecikenler kırmızı çubukla öne çıkar ve liste gecikeni öne alarak sıralanır.
      </p>

      {/* Filtreler — seçimler taslakta birikir, Filtrele ile uygulanır */}
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-9">
        {filterDefs.map((f) => (
          <MultiDropdown
            key={f.key}
            label={f.label}
            options={f.options}
            values={f.values}
            multiple={f.multiple}
            disabled={f.disabled}
            disabledHint={f.disabledHint}
            onChange={f.onChange}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2.5">
        {dirty && (
          <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
            Filtre değişti — henüz uygulanmadı
          </span>
        )}
        <button
          type="button"
          onClick={applyFilters}
          disabled={loading}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
            applied === null || dirty
              ? 'bg-brand-600 text-white hover:bg-brand-700'
              : 'border border-slate-200 text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-ndark-border dark:text-ndark-muted'
          }`}
        >
          {loading && <Loader2 size={12} className="animate-spin" />}
          Filtrele
        </button>
      </div>

      {/* Ana tablo */}
      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-ndark-border">
          <div className="text-sm font-bold text-slate-800 dark:text-ndark-text">
            Vaka SLA Dökümü{' '}
            <span className="text-[11px] font-normal text-slate-400 dark:text-ndark-dim">
              · geciken önce
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-ndark-dim">
            {loadFailed && (
              <span className="font-semibold text-red-600 dark:text-red-400">
                Son sorgu başarısız{data ? ' — eski sonuç gösteriliyor' : ''}
              </span>
            )}
            <span>
              {data && kpis ? `${nf0.format(kpis.totalCount)} kayıt` : '—'}
              {data ? ` · ${new Date(data.generatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          </div>
        </div>
        {data && appliedChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-1.5 dark:border-ndark-border/50">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-ndark-dim">
              Uygulanan:
            </span>
            {appliedChips.map((c) => (
              <span
                key={c}
                className="inline-block max-w-[300px] truncate rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-600 dark:bg-ndark-bg dark:text-ndark-muted"
              >
                {c}
              </span>
            ))}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1560px] border-collapse whitespace-nowrap text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-[10.5px] font-bold tracking-wide text-slate-500 dark:bg-ndark-bg dark:text-ndark-muted">
                <th className="px-2.5 py-2">Müşteri (Proje)</th>
                <th className="px-2.5 py-2">Öncelik</th>
                <th className="px-2.5 py-2">Bölüm</th>
                <th className="px-2.5 py-2">Vaka No</th>
                <th className="px-2.5 py-2">DevOps No</th>
                <th className="px-2.5 py-2">Sahibi</th>
                <th className="px-2.5 py-2">Bekleyen Bölüm</th>
                <th className="px-2.5 py-2">Çözüm Uyum</th>
                <th className="px-2.5 py-2 text-right">Hedef Çözüm (gün)</th>
                <th className="px-2.5 py-2 text-right">Geçen (gün)</th>
                <th className="px-2.5 py-2 text-right">Kalan (gün)</th>
                <th className="px-2.5 py-2">Müdahale Uyum</th>
                <th className="px-2.5 py-2 text-right">Hedef Müd. (dk)</th>
                <th className="px-2.5 py-2 text-right">Müd. Kalan (dk)</th>
                <th className="px-2.5 py-2 text-right">Müd. Geçen (dk)</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={15} className="px-4 py-12 text-center text-slate-400 dark:text-ndark-dim">
                    <Loader2 size={20} className="mx-auto mb-2 animate-spin" />
                    Sorgu çalışıyor…
                  </td>
                </tr>
              )}
              {!loading && (data?.rows ?? []).map((r: SlaDashboardRow) => (
                <tr
                  key={r.id}
                  className="border-t border-slate-100 hover:bg-brand-50/40 dark:border-ndark-border/50 dark:hover:bg-ndark-bg/40"
                >
                  <td className="px-2.5 py-1.5">
                    {r.accountName ? (
                      <span className="font-semibold text-slate-800 dark:text-ndark-text">{r.accountName}</span>
                    ) : (
                      <span className="italic text-slate-400 dark:text-ndark-dim">— müşteri eşleşmedi</span>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-slate-600 dark:text-ndark-muted">
                    {PRIORITY_TR[r.priority ?? ''] ?? r.priority ?? '—'}
                  </td>
                  <td className="px-2.5 py-1.5"><DeptChip label={r.teamName} /></td>
                  <td className="px-2.5 py-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectCase?.(r.id)}
                      className="font-semibold text-brand-600 hover:underline dark:text-ndark-link"
                      title="Vakayı aç"
                    >
                      {r.caseNumber}
                    </button>
                  </td>
                  <td className="px-2.5 py-1.5 tabular-nums text-slate-500 dark:text-ndark-muted">
                    {r.devopsIds.length ? r.devopsIds.join(', ') : '—'}
                  </td>
                  <td className="px-2.5 py-1.5 text-slate-700 dark:text-ndark-text">{r.ownerName ?? '—'}</td>
                  <td className="px-2.5 py-1.5"><DeptChip label={r.waitingDept} /></td>
                  <td className="px-2.5 py-1.5"><UyumPill value={r.resolutionOnTarget} /></td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-600 dark:text-ndark-muted">
                    {r.resolutionTargetDays != null ? nf.format(r.resolutionTargetDays) : '—'}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-600 dark:text-ndark-muted">
                    {nf.format(r.resolutionElapsedDays)}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <BarCell value={r.resolutionRemainingDays} span={3} unit="gün" />
                  </td>
                  <td className="px-2.5 py-1.5"><UyumPill value={r.responseOnTarget} /></td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-600 dark:text-ndark-muted">
                    {r.responseTargetMin != null ? nf0.format(r.responseTargetMin) : '—'}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <BarCell value={r.responseRemainingMin} span={480} unit="dk" />
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-600 dark:text-ndark-muted">
                    {nf0.format(r.responseElapsedMin)}
                  </td>
                </tr>
              ))}
              {!loading && !data && !loadFailed && (
                <tr>
                  <td colSpan={15} className="px-4 py-12 text-center text-slate-400 dark:text-ndark-dim">
                    <Download size={20} className="mx-auto mb-2 rotate-180" />
                    Açılışta veri çekilmez (sunucu dostu). Filtreleri seçip <b>Filtrele</b>'ye basın —
                    varsayılan {CURRENT_YEAR} yılıdır; yılı kaldırıp tüm zamanları da sorgulayabilirsiniz.
                  </td>
                </tr>
              )}
              {!loading && !data && loadFailed && (
                <tr>
                  <td colSpan={15} className="px-4 py-12 text-center text-red-500 dark:text-red-400">
                    <SearchX size={20} className="mx-auto mb-2" />
                    Sorgu başarısız oldu — <b>Filtrele</b>'ye tekrar basarak yeniden deneyin.
                  </td>
                </tr>
              )}
              {!loading && data && data.rows.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-slate-400 dark:text-ndark-dim">
                    <SearchX size={20} className="mx-auto mb-2" />
                    Filtreye uyan vaka yok — filtreleri gevşetmeyi deneyin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-4 border-t border-slate-200 px-4 py-2 text-[10.5px] text-slate-400 dark:border-ndark-border dark:text-ndark-dim">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3.5 rounded-full bg-red-600" /> gecikmiş (kalan &lt; 0)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3.5 rounded-full bg-amber-500" /> sınırda
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3.5 rounded-full bg-emerald-500" /> hedef içinde
          </span>
          <span>· Bekleyen Bölüm = 3rd-party adı / havuz / atanmış takım / müşteri türetimi</span>
          <span>· DevOps No yalnız yazılıma eskale vakalarda dolu</span>
        </div>
      </div>

      {/* Sayfalama + sayfa boyutu */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-500 dark:text-ndark-muted">
        <button
          type="button"
          disabled={!data || (data.page ?? 1) <= 1 || loading}
          onClick={() => setApplied((f) => ({ ...(f ?? {}), page: 1 }))}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 hover:border-brand-400 hover:text-brand-600 disabled:opacity-40 dark:border-ndark-border dark:bg-ndark-card"
        >
          « İlk
        </button>
        <button
          type="button"
          disabled={!data || (data.page ?? 1) <= 1 || loading}
          onClick={() => setApplied((f) => ({ ...(f ?? {}), page: Math.max((data?.page ?? 1) - 1, 1) }))}
          className="rounded-md border border-slate-200 bg-white px-3 py-1 hover:border-brand-400 hover:text-brand-600 disabled:opacity-40 dark:border-ndark-border dark:bg-ndark-card"
        >
          ‹ Önceki
        </button>
        <span>
          Sayfa {data?.page ?? '—'} / {data?.totalPages ?? '—'}
        </span>
        <button
          type="button"
          disabled={!data || (data.page ?? 1) >= (data.totalPages ?? 1) || loading}
          onClick={() =>
            setApplied((f) => ({ ...(f ?? {}), page: Math.min((data?.page ?? 1) + 1, data?.totalPages ?? 1) }))
          }
          className="rounded-md border border-slate-200 bg-white px-3 py-1 hover:border-brand-400 hover:text-brand-600 disabled:opacity-40 dark:border-ndark-border dark:bg-ndark-card"
        >
          Sonraki ›
        </button>
        <button
          type="button"
          disabled={!data || (data.page ?? 1) >= (data.totalPages ?? 1) || loading}
          onClick={() => setApplied((f) => ({ ...(f ?? {}), page: data?.totalPages ?? 1 }))}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 hover:border-brand-400 hover:text-brand-600 disabled:opacity-40 dark:border-ndark-border dark:bg-ndark-card"
        >
          Son »
        </button>
        <label className="ml-2 inline-flex items-center gap-1.5">
          <span className="text-[11px] text-slate-400 dark:text-ndark-dim">Sayfa boyutu</span>
          <select
            disabled={!data || loading}
            value={String(applied?.pageSize ?? 20)}
            onChange={(e) =>
              setApplied((f) => ({ ...(f ?? {}), pageSize: Number(e.target.value), page: 1 }))
            }
            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs outline-none disabled:opacity-40 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      {/* 5 KPI kartı — kaynaktaki gibi en altta */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-ndark-border dark:bg-ndark-card">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
            Toplam Vaka
          </div>
          <div className="mt-1.5 text-3xl font-extrabold tabular-nums text-brand-600 dark:text-ndark-link">
            {data && kpis ? nf0.format(kpis.totalCount) : '—'}
          </div>
        </div>
        {(
          [
            { lbl: 'Çözüm SLA Uyum (adet)', k: kpis?.resolution, isPct: false },
            { lbl: 'Çözüm SLA Uyum %', k: kpis?.resolution, isPct: true },
            { lbl: 'Müdahale SLA Uyum (adet)', k: kpis?.response, isPct: false },
            { lbl: 'Müdahale SLA Uyum %', k: kpis?.response, isPct: true },
          ] as const
        ).map((c) => (
          <div
            key={c.lbl}
            className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-ndark-border dark:bg-ndark-card"
          >
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
              {c.lbl}
            </div>
            <div className="mt-1.5 flex gap-4">
              <div className="flex-1">
                <div className="text-[10px] font-bold text-slate-400 dark:text-ndark-dim">EVET</div>
                <div className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {data && c.k ? (c.isPct ? pct(c.k.evet, c.k.withDue) : nf0.format(c.k.evet)) : '—'}
                </div>
              </div>
              <div className="flex-1">
                <div className="text-[10px] font-bold text-slate-400 dark:text-ndark-dim">HAYIR</div>
                <div className="text-lg font-bold tabular-nums text-red-600 dark:text-red-400">
                  {data && c.k ? (c.isPct ? pct(c.k.hayir, c.k.withDue) : nf0.format(c.k.hayir)) : '—'}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
