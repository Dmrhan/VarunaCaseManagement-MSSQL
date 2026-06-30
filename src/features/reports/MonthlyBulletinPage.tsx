/**
 * Aylık Müşteri Bülteni — Faz A (CS elle export edip müşteriye gönderir).
 *
 * 8 blok (kapsam dışı: Faz B DevOps defect/requirement):
 *   1. Özet kart (toplam vaka + çözülen + ortalama çözüm + SLA özet)
 *   2. Firma dağılımı (perAccountCompany — tek-şirketliyse gizli)
 *   3. Durum (4-kova: Açık / Üstlenildi / Bekletiliyor / Kapalı)
 *   4. Tip (Bilgi/Talep/Hata/Şikayet/Öneri)
 *   5. Kategori (top 10)
 *   6. SLA Uyum (response + resolution ayrı %)
 *   7. Kanal (Telefon/E-posta/Web/...)
 *   8. Öncelik (Low/Medium/High/Critical)
 *
 * Export (A5):
 *   - "PDF" — browser print-to-PDF (window.print + @media print CSS)
 *   - "Excel" — xlsx 8 sheet
 *
 * REUSE (yeni motor yazılmadı):
 *   - bulletinService.getMonthlyBulletin (tek endpoint)
 *   - lookupService.accounts (Account picker)
 *   - REQUEST_TYPE_LABELS / ORIGIN_LABELS — backend ENUM_MAPS reuse
 *   - recharts BarChart / PieChart pattern (TrendLine.tsx ile aynı)
 *
 * Help/explainability standardı:
 *   - Her blok kendini açıklasın (başlık + 1-cümle ne anlama gelir)
 *   - Empty state: "Bu dönemde X yok"
 *   - Privacy: agent ismi/iç not YOK (sadece aggregate)
 */

import { useCallback, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Calendar, FileSpreadsheet, FileText, Info } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { lookupService } from '@/services/caseService';
import { bulletinService, type BulletinPayload, type BulletinBucketRow } from '@/services/bulletinService';

// Bülten için statü/tip/kanal label çevirileri (backend ASCII saklar).
const REQUEST_TYPE_LABELS: Record<string, string> = {
  Bilgi: 'Bilgi',
  Talep: 'Talep',
  Hata: 'Hata',
  Sikayet: 'Şikayet',
  Şikayet: 'Şikayet',
  Oneri: 'Öneri',
  Öneri: 'Öneri',
};
const ORIGIN_LABELS: Record<string, string> = {
  Telefon: 'Telefon',
  Eposta: 'E-posta',
  'E-posta': 'E-posta',
  Web: 'Web',
  Chatbot: 'Chatbot',
  Diger: 'Diğer',
  Diğer: 'Diğer',
};
const PRIORITY_LABELS: Record<string, string> = {
  Low: 'Düşük',
  Medium: 'Orta',
  High: 'Yüksek',
  Critical: 'Kritik',
};
const CASE_TYPE_LABELS: Record<string, string> = {
  GeneralSupport: 'Genel Destek',
  ProactiveTracking: 'Proaktif Takip',
  ChurnPrevention: 'Churn Önleme',
  Onboarding: 'Onboarding',
};

const BUCKET_COLORS: Record<string, string> = {
  open: '#3b82f6',        // mavi
  inProgress: '#f59e0b',  // amber
  waiting: '#a855f7',     // mor
  closed: '#10b981',      // yeşil
};

const PIE_PALETTE = ['#3b82f6', '#f59e0b', '#a855f7', '#10b981', '#ef4444', '#06b6d4', '#84cc16', '#f97316'];

export function MonthlyBulletinPage() {
  const accounts = useMemo(() => lookupService.accounts(), []);
  const companies = useMemo(() => lookupService.companies(), []);
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? id;

  // Default: önceki ay (bültenin doğal kullanım kalıbı: "geçen ayı raporla")
  //
  // Codex P2 — Date drift fix: önceki implementasyon `new Date(y, m, 1)` ile
  // LOCAL midnight oluşturup .toISOString().slice(0, 10) yapıyordu. UTC+
  // zaman dilimlerinde (Europe/Istanbul UTC+3) local 01.06.2026 00:00 →
  // UTC 31.05.2026 21:00 → ISO "2026-05-31T21:00:00.000Z" → "2026-05-31".
  // Yani bir gün ERKEN. Şimdi YYYY-MM-DD'yi komponentlerden direkt kur.
  const defaultDates = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-indexed
    // Önceki ay başlangıcı = (y, m-1, 1); ay sonu = (y, m, 1) exclusive.
    // Yıl sınırı: Ocak'ta (m=0) önceki ay = Aralık (m=-1 → y-1, ay=11).
    const startY = m === 0 ? y - 1 : y;
    const startM = m === 0 ? 11 : m - 1;
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      from: `${startY}-${pad(startM + 1)}-01`,
      to: `${y}-${pad(m + 1)}-01`, // exclusive — bu ayın 1'i
    };
  }, []);

  const [accountId, setAccountId] = useState<string>('');
  const [from, setFrom] = useState<string>(defaultDates.from);
  const [to, setTo] = useState<string>(defaultDates.to);
  const [data, setData] = useState<BulletinPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const periodLabel = useMemo(() => {
    if (!from || !to) return '';
    return `${formatDate(from)} – ${formatDate(addDays(to, -1))}`;
  }, [from, to]);

  const load = useCallback(async () => {
    if (!accountId) {
      toast({ type: 'warn', message: 'Müşteri seç.' });
      return;
    }
    setLoading(true);
    const fromIso = new Date(from + 'T00:00:00.000Z').toISOString();
    const toIso = new Date(to + 'T00:00:00.000Z').toISOString();
    const r = await bulletinService.getMonthlyBulletin(accountId, fromIso, toIso);
    setLoading(false);
    if (r) setData(r);
  }, [accountId, from, to, toast]);

  return (
    <div className="space-y-4 p-4">
      {/* Header — non-print kısım */}
      <Card className="bulletin-controls report-no-print">
        <CardBody>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-ndark-text">
            <FileText size={18} /> Aylık Müşteri Bülteni
          </h2>
          <p className="mb-3 text-sm text-slate-500 dark:text-ndark-muted">
            Bir müşteri için seçili dönemin destek özet bülteni. CS ekibi bunu PDF veya Excel olarak müşteriye gönderir.
            Veriler yalnız aggregate sayımlardır — agent isimleri, iç notlar veya kişisel bilgi içermez.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <Field label="Müşteri" required>
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">— Müşteri seç —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Başlangıç" hint="Ay başı tarihi">
              <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Bitiş" hint="Sonraki ay başı (exclusive)">
              <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <Button
                variant="primary"
                onClick={() => void load()}
                disabled={loading || !accountId}
                leftIcon={<Calendar size={14} />}
              >
                {loading ? 'Yükleniyor…' : 'Hazırla'}
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <Button
                variant="ghost"
                disabled={!data}
                onClick={() => window.print()}
                leftIcon={<FileText size={14} />}
                title="PDF — tarayıcı print"
              >
                PDF
              </Button>
              <Button
                variant="ghost"
                disabled={!data}
                onClick={() => exportExcel(data!, accounts.find((a) => a.id === accountId)?.name ?? 'Bülten')}
                leftIcon={<FileSpreadsheet size={14} />}
                title="Excel — 8 sheet"
              >
                Excel
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : !data ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<FileText size={28} />}
              title="Bülten hazırlamak için müşteri ve dönem seç"
              description="Üstteki formdan müşteriyi seç, dönem aralığını gir ve Hazırla'ya bas."
            />
          </CardBody>
        </Card>
      ) : data.totals.count === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Info size={28} />}
              title="Bu dönemde vaka yok"
              description={`${data.account.name ?? 'Müşteri'} için ${periodLabel} aralığında açılmış vaka bulunamadı.`}
            />
          </CardBody>
        </Card>
      ) : (
        <BulletinReport
          data={data}
          accountName={data.account.name ?? accounts.find((a) => a.id === accountId)?.name ?? 'Müşteri'}
          periodLabel={periodLabel}
          companyName={companyName}
        />
      )}
    </div>
  );
}

/** Bülten içerik bloğu — print-friendly (PDF için). */
function BulletinReport({
  data,
  accountName,
  periodLabel,
  companyName,
}: {
  data: BulletinPayload;
  accountName: string;
  periodLabel: string;
  companyName: (id: string) => string;
}) {
  const { totals, account, perAccountCompany } = data;
  const showCompanyBreakdown = perAccountCompany.length > 1;

  return (
    <div className="bulletin-report printable-report space-y-4">
      {/* Marka header — PDF print için */}
      <div className="rounded-md border border-slate-200 bg-white p-6 dark:border-ndark-border dark:bg-ndark-card print:border-0">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-ndark-text">
              Aylık Destek Bülteni
            </h1>
            <p className="mt-1 text-base text-slate-600 dark:text-ndark-muted">
              {accountName}
            </p>
            <p className="text-sm text-slate-500 dark:text-ndark-muted">
              Dönem: {periodLabel}
            </p>
          </div>
          <div className="text-right text-xs text-slate-400">
            Univera Destek Bülteni
            <div>Oluşturma: {formatDate(new Date().toISOString())}</div>
          </div>
        </div>
      </div>

      {/* 1) Özet KPI kartı */}
      <Block
        title="Genel Özet"
        hint="Dönem içinde açılan, çözülen ve ortalama çözüm süresi."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Toplam Vaka" value={String(totals.count)} />
          <Kpi label="Çözülen" value={String(totals.resolvedCount)} />
          <Kpi
            label="Ort. Çözüm"
            value={totals.avgResolutionMinutes != null
              ? formatHours(totals.avgResolutionMinutes)
              : '—'}
          />
          <Kpi
            label="SLA Uyum"
            value={totals.slaResolutionCompliancePct != null
              ? `%${totals.slaResolutionCompliancePct.toFixed(0)}`
              : '—'}
          />
        </div>
      </Block>

      {/* 2) Firma dağılımı — tek-şirketliyse gizli */}
      {showCompanyBreakdown && (
        <Block
          title="Firma Dağılımı"
          hint="Müşterinin farklı şirket/lokasyonlarına göre vaka sayısı ve çözüm süresi."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-ndark-border">
                <tr>
                  <th className="px-3 py-2">Firma</th>
                  <th className="px-3 py-2 text-right">Vaka</th>
                  <th className="px-3 py-2 text-right">Çözülen</th>
                  <th className="px-3 py-2 text-right">Ort. Süre</th>
                  <th className="px-3 py-2 text-right">SLA Uyum</th>
                </tr>
              </thead>
              <tbody>
                {perAccountCompany.map((row) => {
                  const slaPct = row.resolvedCount > 0
                    ? (row.slaResolutionCompliantCount / row.resolvedCount) * 100
                    : null;
                  return (
                    <tr key={row.companyId} className="border-b border-slate-100 dark:border-ndark-border/60">
                      <td className="px-3 py-2 font-medium">{companyName(row.companyId)}</td>
                      <td className="px-3 py-2 text-right">{row.count}</td>
                      <td className="px-3 py-2 text-right">{row.resolvedCount}</td>
                      <td className="px-3 py-2 text-right">
                        {row.avgResolutionMinutes != null ? formatHours(row.avgResolutionMinutes) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {slaPct != null ? `%${slaPct.toFixed(0)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Block>
      )}

      {/* 3) Durum (4-kova) */}
      <Block
        title="Durum"
        hint="Vakaların mevcut durumu. Bekletiliyor: 3. partiden veya müşteriden yanıt beklenen + ertelenmiş vakalar."
      >
        <BucketBarChart rows={account.byStatus4} colorMap={BUCKET_COLORS} />
      </Block>

      {/* 4) Tip (Soru/Talep/Hata/Şikayet) */}
      <Block
        title="Talep Türü"
        hint="Müşterinin nasıl ulaştığı: bilgi soruları, talepler, hatalar, şikayetler ve öneriler."
      >
        <BucketDonut rows={mapLabels(account.byRequestType, REQUEST_TYPE_LABELS)} />
      </Block>

      {/* 5) Kategori */}
      <Block
        title="Kategori"
        hint="Vakaların hangi konularda yoğunlaştığı (en çok 10 kategori)."
      >
        <BucketBarChart rows={account.byCategory.slice(0, 10)} />
      </Block>

      {/* 6) SLA Uyum (KPI iki kart) */}
      <Block
        title="SLA Uyum"
        hint="İlk müdahale ve çözüm sürelerinin SLA hedeflerine uyum yüzdesi."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Kpi
            label="İlk Müdahale Uyumu"
            value={totals.slaResponseCompliancePct != null
              ? `%${totals.slaResponseCompliancePct.toFixed(0)}`
              : '—'}
            sub={`${totals.slaResponseCompliantCount}/${totals.responseMetCount} vaka`}
          />
          <Kpi
            label="Çözüm Uyumu"
            value={totals.slaResolutionCompliancePct != null
              ? `%${totals.slaResolutionCompliancePct.toFixed(0)}`
              : '—'}
            sub={`${totals.slaResolutionCompliantCount}/${totals.resolvedCount} vaka`}
          />
        </div>
      </Block>

      {/* 7) Kanal (E-posta/Telefon) */}
      <Block
        title="Kanal"
        hint="Vakaların hangi kanal üzerinden geldiği."
      >
        <BucketDonut rows={mapLabels(account.byOrigin, ORIGIN_LABELS)} />
      </Block>

      {/* 8) Öncelik */}
      <Block
        title="Öncelik"
        hint="Vakaların öncelik dağılımı."
      >
        <BucketBarChart rows={mapLabels(account.byPriority, PRIORITY_LABELS)} />
      </Block>

      {/* Footer — print için */}
      <div className="mt-6 border-t border-slate-200 pt-3 text-center text-xs text-slate-400 dark:border-ndark-border print:block">
        Bu bülten Univera Vaka Yönetim Sistemi tarafından otomatik üretilmiştir.
      </div>
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <div className="mb-3">
          <h3 className="text-base font-semibold text-slate-800 dark:text-ndark-text">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-ndark-muted">{hint}</p>}
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 dark:border-ndark-border dark:bg-ndark-card">
      <div className="text-xs text-slate-500 dark:text-ndark-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-ndark-text">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function BucketBarChart({
  rows,
  colorMap,
}: {
  rows: BulletinBucketRow[];
  colorMap?: Record<string, string>;
}) {
  if (rows.length === 0) {
    return <p className="rounded-md bg-slate-50 px-3 py-4 text-center text-sm text-slate-500 dark:bg-ndark-card dark:text-ndark-muted">Bu dönemde veri yok.</p>;
  }
  const data = rows.map((r) => ({
    name: r.label ?? r.key,
    value: r.count,
    fill: colorMap?.[r.key] ?? '#3b82f6',
  }));
  return (
    <div className="text-slate-500 dark:text-ndark-muted">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'currentColor' }} />
          <YAxis tick={{ fontSize: 11, fill: 'currentColor' }} />
          <Tooltip
            contentStyle={{ background: 'var(--color-background-primary, #fff)', borderRadius: 6, fontSize: 12 }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BucketDonut({ rows }: { rows: BulletinBucketRow[] }) {
  if (rows.length === 0) {
    return <p className="rounded-md bg-slate-50 px-3 py-4 text-center text-sm text-slate-500 dark:bg-ndark-card dark:text-ndark-muted">Bu dönemde veri yok.</p>;
  }
  const data = rows.map((r, i) => ({
    name: r.label ?? r.key,
    value: r.count,
    fill: PIE_PALETTE[i % PIE_PALETTE.length],
  }));
  return (
    <div className="text-slate-500 dark:text-ndark-muted">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: 'var(--color-background-primary, #fff)', borderRadius: 6, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function mapLabels(rows: BulletinBucketRow[], labelMap: Record<string, string>): BulletinBucketRow[] {
  return rows.map((r) => ({
    ...r,
    label: labelMap[r.key] ?? r.label ?? r.key,
  }));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00.000Z' : ''));
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function formatHours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} dk`;
  const h = minutes / 60;
  if (h < 48) return `${h.toFixed(1)} sa`;
  return `${(h / 24).toFixed(1)} gün`;
}

/**
 * A5 — Excel export — 8 sheet (özet + her blok ayrı).
 * Lazy-load xlsx (paket ~250KB; ana bundle'a girmesin).
 */
async function exportExcel(data: BulletinPayload, accountName: string) {
  const xlsx = await import('xlsx');
  const wb = xlsx.utils.book_new();

  const fmtSheet = (rows: BulletinBucketRow[], labelMap?: Record<string, string>) =>
    xlsx.utils.json_to_sheet(
      rows.map((r) => ({
        Etiket: labelMap?.[r.key] ?? r.label ?? r.key,
        Sayı: r.count,
      })),
    );

  // 1) Özet
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([
    { Anahtar: 'Toplam Vaka', Değer: data.totals.count },
    { Anahtar: 'Çözülen', Değer: data.totals.resolvedCount },
    { Anahtar: 'Ort. Çözüm (dk)', Değer: data.totals.avgResolutionMinutes ?? '' },
    { Anahtar: 'SLA Çözüm Uyumu %', Değer: data.totals.slaResolutionCompliancePct ?? '' },
    { Anahtar: 'SLA İlk Müdahale Uyumu %', Değer: data.totals.slaResponseCompliancePct ?? '' },
    { Anahtar: 'Aktif Ertelenmiş', Değer: data.account.snoozedActiveCount },
  ]), 'Özet');

  // 2) Firma dağılımı
  if (data.perAccountCompany.length > 0) {
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(
      data.perAccountCompany.map((r) => ({
        CompanyId: r.companyId,
        Vaka: r.count,
        Çözülen: r.resolvedCount,
        OrtSüreDk: r.avgResolutionMinutes ?? '',
        SLAÇözümUyumu: r.resolvedCount > 0
          ? Math.round((r.slaResolutionCompliantCount / r.resolvedCount) * 100)
          : '',
      })),
    ), 'Firma Dağılımı');
  }

  // 3-8) Diğer bloklar
  xlsx.utils.book_append_sheet(wb, fmtSheet(data.account.byStatus4), 'Durum');
  xlsx.utils.book_append_sheet(wb, fmtSheet(data.account.byRequestType, REQUEST_TYPE_LABELS), 'Tip');
  xlsx.utils.book_append_sheet(wb, fmtSheet(data.account.byCategory.slice(0, 50)), 'Kategori');
  xlsx.utils.book_append_sheet(wb, fmtSheet(data.account.byOrigin, ORIGIN_LABELS), 'Kanal');
  xlsx.utils.book_append_sheet(wb, fmtSheet(data.account.byPriority, PRIORITY_LABELS), 'Öncelik');
  xlsx.utils.book_append_sheet(wb, fmtSheet(data.account.byCaseType, CASE_TYPE_LABELS), 'Vaka Tipi');

  const fileName = `Bulten_${accountName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${data.meta.from.slice(0, 10)}.xlsx`;
  xlsx.writeFile(wb, fileName);
}

export default MonthlyBulletinPage;
