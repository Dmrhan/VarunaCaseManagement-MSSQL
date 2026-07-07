/**
 * Performans Panosu FAZ 2b — Kişi Uzmanlık Profili (drill-down).
 * Performans panosunda kişi kartına tıklanınca açılır. 6 bölüm:
 * günlük süre trendi · uzmanlık parmak izi · en çok karşılaştığı sorunlar ·
 * çalıştığı ürün · en uzun işleri (tıklanınca vaka detayı) · çözüm imzası.
 * Backend: POST /api/analytics/person-detail (FAZ 2a).
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, Sparkles, Flame } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { analyticsService, type PersonDetailResponse, type EngagementResponse, type EngagementSignal } from '@/services/analyticsService';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

// Süre birimi — büyükse gün, değilse saat (yöneticinin dili).
function formatDuration(hours: number): string {
  if (hours >= 48) return `${Math.round(hours / 24)} gün`;
  return `${hours} saat`;
}

// Süre etiketi — saat/gün (yöneticinin dili).
function fmtHoursShort(h: number): string {
  if (h >= 48) return `${Math.round(h / 24)} gün`;
  return `${Math.round(h * 10) / 10} sa`;
}

// Günlük çözüm-süresi trendi. SVG SADECE grafik çizer (çizgi/alan/çubuk) —
// tüm metin/eksen/legend HTML (app fontu, ölçeklenmez). preserveAspectRatio="none"
// + non-scaling-stroke ile çizgi her genişlikte keskin. Y-ölçeği medyan aralığına
// göre (dibe yapışmaz); endpoint noktası + değeri HTML overlay.
function TrendChart({ data }: { data: PersonDetailResponse['dailyTrend'] }) {
  const pts = data.filter((d) => d.rollingMedianHours != null);
  if (pts.length < 2) {
    return <p className="py-8 text-center text-xs text-slate-400 dark:text-ndark-dim">Trend için yeterli gün yok.</p>;
  }
  const meds = pts.map((d) => d.rollingMedianHours as number);
  const maxVol = Math.max(...pts.map((d) => d.resolvedCount), 1);
  const loRaw = Math.min(...meds), hiRaw = Math.max(...meds);
  // Y aralığı: medyan varyasyonunu görünür kıl (düz veriyi bile ortalar), %30 pad.
  const span = Math.max(hiRaw - loRaw, hiRaw * 0.25, 0.1);
  const lo = Math.max(0, loRaw - span * 0.3);
  const hi = hiRaw + span * 0.3;
  const nx = (i: number) => (i / (pts.length - 1)) * 100;
  const ny = (v: number) => (1 - (v - lo) / (hi - lo || 1)) * 100;
  const linePts = pts.map((d, i) => `${nx(i).toFixed(2)},${ny(d.rollingMedianHours as number).toFixed(2)}`).join(' ');
  const last = pts[pts.length - 1];
  const lastX = nx(pts.length - 1), lastY = ny(last.rollingMedianHours as number);
  const mid = (hi + lo) / 2;

  return (
    <div>
      {/* Legend + endpoint değeri */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-[11px] text-slate-500 dark:text-ndark-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-[3px] w-4 rounded-full bg-violet-600" /> Tipik süre (7g)</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2 rounded-sm bg-sky-300" /> Günlük çözülen</span>
        </div>
        <span className="inline-flex items-baseline gap-1 rounded-md bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
          bugün <b className="tabular-nums">{fmtHoursShort(last.rollingMedianHours as number)}</b>
        </span>
      </div>

      {/* Y-ekseni + çizim alanı */}
      <div className="flex gap-2">
        <div className="flex h-[150px] w-12 flex-none flex-col justify-between py-[2px] text-right text-[10px] tabular-nums text-slate-400 dark:text-ndark-dim">
          <span>{fmtHoursShort(hi)}</span>
          <span>{fmtHoursShort(mid)}</span>
          <span>{fmtHoursShort(lo)}</span>
        </div>
        <div className="relative h-[150px] flex-1">
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible" aria-label="Günlük çözüm süresi trendi">
            <defs>
              <linearGradient id="pp-trend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* yatay ızgara */}
            {[0, 50, 100].map((gy) => (
              <line key={gy} x1="0" y1={gy} x2="100" y2={gy} className="stroke-slate-100 dark:stroke-ndark-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {/* günlük hacim çubukları */}
            {pts.map((d, i) => {
              const bh = (d.resolvedCount / maxVol) * 72;
              const bx = nx(i);
              return bh > 0 ? <rect key={i} x={bx - 0.9} y={100 - bh} width={1.8} height={bh} fill="#bfdbfe" opacity={0.75} vectorEffect="non-scaling-stroke" /> : null;
            })}
            {/* alan + çizgi */}
            <polygon points={`0,100 ${linePts} 100,100`} fill="url(#pp-trend)" />
            <polyline points={linePts} fill="none" stroke="#6d28d9" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {/* endpoint noktası (HTML — ölçeklenmez, yuvarlak kalır) */}
          <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-violet-700 shadow-sm dark:border-ndark-card"
            style={{ left: `${lastX}%`, top: `${lastY}%` }} />
        </div>
      </div>

      {/* X-ekseni */}
      <div className="mt-1.5 flex justify-between pl-14 text-[10.5px] text-slate-400 dark:text-ndark-dim">
        <span>{pts.length} gün önce</span>
        <span>bugün</span>
      </div>
    </div>
  );
}

function Section({ title, icon, hint, children }: { title: string; icon?: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-ndark-text">{icon}{title}</div>
        {hint && <p className="mb-3 text-[11.5px] text-slate-500 dark:text-ndark-muted">{hint}</p>}
        {children}
      </CardBody>
    </Card>
  );
}

function MiniBars({ rows }: { rows: { label: string; count: number; suffix?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[130px_1fr_auto] items-center gap-2.5">
          <span className="truncate text-xs text-slate-700 dark:text-ndark-text" title={r.label}>{r.label}</span>
          <span className="h-1.5 rounded bg-slate-100 dark:bg-ndark-bg"><span className="block h-full rounded bg-gradient-to-r from-sky-300 to-blue-500" style={{ width: `${Math.round((r.count / max) * 100)}%` }} /></span>
          <span className="text-[11px] tabular-nums text-slate-500 dark:text-ndark-muted">{r.suffix ?? r.count}</span>
        </div>
      ))}
    </div>
  );
}

// FAZ 2c — Etkinlik & Katkı. HASSAS: koçluk sinyali, karne değil.
// Tasarım kararı: tek düşük sinyal asla "gizlenme" demez; verdict sadece
// birden çok endişe üst üste binince "bakmaya değer" der (backend concern sayımı).
const VERDICT_UI: Record<string, { label: string; caption: string; ring: string; bg: string; dot: string; text: string }> = {
  active: {
    label: 'Aktif ve dengeli',
    caption: 'Sinyaller ekip normali içinde — güçlü, dengeli bir dönem.',
    ring: 'border-emerald-200 dark:border-emerald-900/50', bg: 'bg-emerald-50/70 dark:bg-emerald-950/30',
    dot: 'bg-emerald-500', text: 'text-emerald-800 dark:text-emerald-200',
  },
  mixed: {
    label: 'Bağlamıyla okunmalı',
    caption: 'Bazı sinyaller ekipten farklı; bu çoğu zaman uzmanlık ya da rol farkıdır. En doğrusu kişiyle konuşarak anlamak.',
    ring: 'border-sky-200 dark:border-sky-900/50', bg: 'bg-sky-50/70 dark:bg-sky-950/30',
    dot: 'bg-sky-500', text: 'text-sky-800 dark:text-sky-200',
  },
  watch: {
    label: 'Bir koçluk konuşmasına değer',
    caption: 'Birkaç sinyal birlikte ekip normalinin altında. Bir değerlendirme değil — destek gerekip gerekmediğini birlikte anlamak için iyi bir başlangıç.',
    ring: 'border-amber-200 dark:border-amber-900/50', bg: 'bg-amber-50/70 dark:bg-amber-950/30',
    dot: 'bg-amber-500', text: 'text-amber-800 dark:text-amber-200',
  },
  inconclusive: {
    label: 'Yorum için yeterli veri yok',
    caption: 'Bu dönemde güvenli bir okuma yapacak kadar iş yok.',
    ring: 'border-slate-200 dark:border-ndark-border', bg: 'bg-slate-50/70 dark:bg-ndark-bg',
    dot: 'bg-slate-400', text: 'text-slate-700 dark:text-ndark-text',
  },
};

function fmtSignal(v: number | null, unit: string): string {
  if (v == null) return '—';
  if (unit === '%') return `%${v}`;
  return `${v}${unit ? ` ${unit}` : ''}`;
}

function EngagementSection({ eng }: { eng: EngagementResponse }) {
  const v = eng.verdict;
  const ui = VERDICT_UI[v?.read ?? 'inconclusive'] ?? VERDICT_UI.inconclusive;
  const toneDot = (t: EngagementSignal['tone']) =>
    t === 'good' ? 'bg-emerald-500' : t === 'warn' ? 'bg-amber-500' : 'bg-slate-300 dark:bg-ndark-border';
  return (
    <Section
      title="Etkinlik & katkı — çalışma deseni ve yük dengesi"
      hint="Çözülen sayının ötesinde çalışma deseni. Tek metrik değil, birlikte okunan sinyaller — bir kişiyi bağlamıyla anlamak ve nerede destek gerektiğini görmek için."
    >
      <div className={`mb-4 flex items-start gap-3 rounded-xl border ${ui.ring} ${ui.bg} p-3.5`}>
        <span className={`mt-1 h-2.5 w-2.5 flex-none rounded-full ${ui.dot}`} />
        <div>
          <div className={`text-sm font-semibold ${ui.text}`}>{ui.label}</div>
          <div className="mt-0.5 text-[11.5px] text-slate-600 dark:text-ndark-muted">{ui.caption}</div>
          {v && (
            <div className="mt-1 text-[10.5px] text-slate-400 dark:text-ndark-dim">
              {v.concerns === 0
                ? `Tüm sinyaller ekip aralığında · bu dönem ${v.resolved} vaka çözdü`
                : `${v.concerns} sinyal ekip ortalamasının altında · bu dönem ${v.resolved} vaka çözdü`}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {eng.signals.map((s) => (
          <div key={s.key} className="rounded-lg border border-slate-100 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card" title={s.hint}>
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 flex-none rounded-full ${toneDot(s.tone)}`} />
              <span className="text-[11.5px] font-medium text-slate-600 dark:text-ndark-muted">{s.label}</span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-ndark-text">{fmtSignal(s.value, s.unit)}</span>
              <span className="text-[11px] text-slate-400 dark:text-ndark-dim">
                ekip {s.teamValue == null ? '—' : fmtSignal(s.teamValue, s.unit)}
              </span>
            </div>
            <div className="mt-1 text-[10.5px] leading-snug text-slate-400 dark:text-ndark-dim">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-[11.5px] leading-relaxed text-slate-500 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-muted">
        <span className="font-semibold text-slate-600 dark:text-ndark-text">Deseni nasıl okumalı?</span>{' '}
        Tek bir sinyalin ekipten farklı olması çoğu zaman <em>uzmanlıktır</em> (zor işlere odaklanma) ya da rol
        farkıdır — tek başına bir sonuç taşımaz. Anlamlı olan, birkaç sinyalin
        <em> aynı anda</em> ve zaman içinde birlikte seyretmesidir. Bu yüzden ekran tek sayıya değil, birlikte
        okunan desene bakar; kararı sayı değil, kişiyle yapılan konuşma verir.
      </div>
    </Section>
  );
}

export function PersonProfileView({
  personId,
  personName,
  from,
  to,
  teams,
  companies,
  onBack,
  onSelectCase,
}: {
  personId: string;
  personName: string;
  from: string;
  to: string;
  teams?: string[];
  companies?: string[];
  onBack: () => void;
  onSelectCase?: (id: string) => void;
}) {
  const [data, setData] = useState<PersonDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [engagement, setEngagement] = useState<EngagementResponse | null>(null);
  const scopeKey = `${teams?.join(',') ?? ''}|${companies?.join(',') ?? ''}`;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setEngagement(null);
    void analyticsService.personDetail(personId, from, to, teams, companies).then((out) => {
      if (alive) { setData(out ?? null); setLoading(false); }
    });
    void analyticsService.personEngagement(personId, from, to, teams, companies).then((out) => {
      if (alive) setEngagement(out ?? null);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, from, to, scopeKey]);

  const sig = data?.solutionSignature;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:text-ndark-muted dark:hover:bg-ndark-card">
          <ArrowLeft size={14} /> Geri
        </button>
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-violet-700 text-base font-bold text-white">{initials(personName)}</div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-ndark-text">{personName}</h1>
          <p className="text-xs text-slate-500 dark:text-ndark-muted">
            {loading ? 'Profil yükleniyor…' : `${data?.person?.resolved ?? 0} vaka çözdü · bu dönem`}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton height={170} />
          <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={150} />)}</div>
        </div>
      ) : !data || !data.person ? (
        <Card><CardBody><p className="py-8 text-center text-sm text-slate-500 dark:text-ndark-muted">Bu kişi için profil verisi bulunamadı.</p></CardBody></Card>
      ) : (
        <>
          <Section title="Çözüm süresi trendi — günlük" hint="Yön önemli: sayı değil eğim. Çizgi 7 günlük tipik süre, çubuklar günlük çözülen iş.">
            <TrendChart data={data.dailyTrend} />
          </Section>

          {engagement && engagement.signals.length > 0 && <EngagementSection eng={engagement} />}

          <Section title="Uzmanlık parmak izi" icon={<Sparkles size={14} className="text-violet-500" />} hint="Sadece çok yaptığı değil, ekipten belirgin hızlı çözdüğü konu gerçek uzmanlıktır.">
            <div className="space-y-3">
              {data.expertise.map((e) => (
                <div key={e.category}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-800 dark:text-ndark-text">
                      {e.category}
                      {e.tag === 'expert' && <span className="ml-2 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-300">Uzman</span>}
                      {e.tag === 'solid' && <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">Sağlam</span>}
                    </span>
                    <span className="text-[11px] tabular-nums text-slate-500 dark:text-ndark-muted"><b className="text-slate-700 dark:text-ndark-text">{e.count}</b> vaka · %{e.sharePct}</span>
                  </div>
                  <span className="block h-2 rounded bg-slate-100 dark:bg-ndark-bg">
                    <span className={`block h-full rounded ${e.tag === 'expert' ? 'bg-gradient-to-r from-violet-500 to-violet-700' : 'bg-gradient-to-r from-blue-400 to-blue-600'}`} style={{ width: `${Math.min(100, e.sharePct * 2)}%` }} />
                  </span>
                  {e.fasterPct != null && e.fasterPct >= 20
                    ? <div className="mt-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">▼ Bu konuda ekipten %{e.fasterPct} hızlı</div>
                    : <div className="mt-1 text-[11px] text-slate-400 dark:text-ndark-dim">≈ Ekip seviyesinde</div>}
                </div>
              ))}
            </div>
          </Section>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="En çok karşılaştığı sorunlar" hint="En sık uğraştığı somut alt-konular.">
              <MiniBars rows={data.problems.map((p) => ({ label: p.subCategory, count: p.count }))} />
            </Section>
            <Section title="Çalıştığı ürün / modül" hint="Hangi ürün hattında derinleşmiş.">
              <MiniBars rows={data.products.map((p) => ({ label: p.product, count: p.count, suffix: `%${p.sharePct}` }))} />
            </Section>
          </div>

          <Section title="En uzun süren işleri" hint="Bu kişinin göğüslediği en ağır işler. Tıklayınca vaka detayına gider. (Uzun ≠ kötü; zor iş de uzun sürer.)">
            <div className="divide-y divide-slate-100 dark:divide-ndark-border">
              {data.longestCases.map((c, i) => (
                <button key={c.id} type="button" onClick={() => onSelectCase?.(c.id)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-ndark-card">
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-400 dark:text-ndark-dim">
                      {c.caseNumber}{i === 0 && <span className="ml-1 inline-flex items-center gap-0.5 font-semibold text-amber-600"><Flame size={10} /> en uzun</span>}
                    </div>
                    <div className="truncate text-[13px] font-medium text-slate-800 dark:text-ndark-text">{c.title}</div>
                    <div className="text-[11px] text-slate-500 dark:text-ndark-muted">{c.category} · {c.subCategory}</div>
                  </div>
                  <div className="flex-none text-right">
                    <div className="text-sm font-bold tabular-nums text-slate-900 dark:text-ndark-text">{formatDuration(c.hours)}</div>
                    <div className={`text-[10.5px] ${c.reopened ? 'text-rose-600' : 'text-emerald-600'}`}>{c.reopened ? 'yeniden açıldı' : 'çözüldü'}</div>
                  </div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Çözüm imzası — bu kişi işleri nasıl çözüyor?" hint="Kapanış etiketlerinden çıkan çözüm karakteri — koçluk ve bilgi paylaşımı için.">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 dark:border-ndark-border dark:bg-ndark-bg">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 dark:text-ndark-dim">En sık kök neden</div>
                <div className="mt-1 text-[13px] font-semibold text-slate-800 dark:text-ndark-text">{sig?.rootCause?.[0]?.label ?? '—'}</div>
                {sig?.rootCause?.[0] && <div className="text-[11px] text-slate-500 dark:text-ndark-muted">kapanışların %{sig.rootCause[0].pct}'i</div>}
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 dark:border-ndark-border dark:bg-ndark-bg">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 dark:text-ndark-dim">Tipik çözüm yöntemi</div>
                <div className="mt-1 text-[13px] font-semibold text-slate-800 dark:text-ndark-text">{sig?.resolutionType?.[0]?.label ?? '—'}</div>
                {sig?.resolutionType?.[0] && <div className="text-[11px] text-slate-500 dark:text-ndark-muted">%{sig.resolutionType[0].pct}</div>}
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/40">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Kalıcı önleme uyguladığı</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{sig?.permanentPreventionPct == null ? '—' : `%${sig.permanentPreventionPct}`}</div>
                <div className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80">ekip ort. %{sig?.teamPermanentPreventionPct ?? '—'} — sorunu bir daha yaşatmama eğilimi</div>
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
