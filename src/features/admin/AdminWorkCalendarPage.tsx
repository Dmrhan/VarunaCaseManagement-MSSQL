/**
 * AdminWorkCalendarPage — Çalışma Takvimi & SLA Süre Kuralları. Faz 2, 2026-07-14.
 *
 * SLA iş-saati epiği (tek-versiyon dalı #538). YALNIZ SystemAdmin
 * (App.canShowAdminView + route assertSystemAdmin çift kapı). Onaylı mockup
 * (artifact 70494155, öğle molası dahil) birebir: şirket seçici → haftalık
 * mesai + mola → resmi tatiller (ay-grid görsel + liste) → SLA duraklatma
 * kuralları → örnek hesaplama (kaydetmeden, sunucu motoru) → kesim tarihi.
 *
 * Kural: takvim matematiği FE'de YOK — örnek hesap dahil her şey sunucudaki
 * businessTime motorundan gelir (tek doğruluk kaynağı).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Copy, Loader2, Lock, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import { lookupService } from '@/services/caseService';
import {
  adminService,
  type WorkCalendar,
  type WorkCalendarDay,
  type WorkCalendarPreviewResult,
} from '../../services/adminService';

const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
/** Onaylı varsayılan: Pzt-Cu 08:30-18:00 + mola 12:00-13:00 (net 8,5 sa/gün). */
const DEFAULT_DAYS: WorkCalendarDay[] = [1, 2, 3, 4, 5].map((day) => ({ day, startMin: 510, endMin: 1080 }));

const toHHMM = (min: number | null | undefined) =>
  min == null ? '' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fmtMin = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} sa ${r} dk` : `${h} sa`;
};

/** Taslak durum — dirty kıyası için normalize edilir. */
interface Draft {
  days: Array<{ day: number; enabled: boolean; startMin: number; endMin: number }>;
  breakEnabled: boolean;
  breakStartMin: number;
  breakEndMin: number;
  isActive: boolean;
  pauseOnCustomerWait: boolean;
  effectiveFrom: string; // 'YYYY-MM-DD' | ''
}

function draftFromCalendar(cal: WorkCalendar | null): Draft {
  const src = cal?.workDays?.length ? cal.workDays : DEFAULT_DAYS;
  const byDay = new Map(src.map((d) => [d.day, d]));
  return {
    days: [1, 2, 3, 4, 5, 6, 7].map((day) => {
      const w = byDay.get(day);
      return { day, enabled: !!w, startMin: w?.startMin ?? 510, endMin: w?.endMin ?? 1080 };
    }),
    breakEnabled: cal ? cal.breakStartMin != null : true,
    breakStartMin: cal?.breakStartMin ?? 720,
    breakEndMin: cal?.breakEndMin ?? 780,
    isActive: cal?.isActive ?? true,
    pauseOnCustomerWait: cal?.pauseOnCustomerWait ?? false,
    effectiveFrom: cal?.effectiveFrom ? cal.effectiveFrom.slice(0, 10) : '',
  };
}

/**
 * 24 SAAT zaman seçici — native time girdisi tarayıcı diline göre
 * AM/PM gösterebiliyor (saha bulgusu); select ile format DETERMİNİSTİK.
 * 15 dk adım; kayıtlı değer adım dışındaysa listeye eklenir.
 */
function TimeSelect({ value, onChange, disabled }: { value: number; onChange: (m: number) => void; disabled?: boolean }) {
  const opts = useMemo(() => {
    const base = Array.from({ length: 96 }, (_, i) => i * 15);
    return base.includes(value) ? base : [...base, value].sort((a, b) => a - b);
  }, [value]);
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs tabular-nums outline-none disabled:opacity-50 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text"
    >
      {opts.map((m) => (
        <option key={m} value={m}>{toHHMM(m)}</option>
      ))}
    </select>
  );
}

const shiftMonth = (ym: string, delta: number): string => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
};

const isoToTr = (iso: string) => (iso ? iso.split('-').reverse().join('.') : '');
const trToIso = (t: string): string | null => {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t.trim());
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const iso = `${m[3]}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso; // 31.02 gibi taşmalar NaN
};

/**
 * GG.AA.YYYY tarih girişi — native date girdisi tarayıcı diline göre
 * AA/GG/YYYY gösterebiliyor (saha bulgusu); metin girişi + doğrulama ile
 * format sabit. Geçersiz girişte eski değere geri döner.
 */
function DateInputTR({ value, onChange, className }: { value: string; onChange: (iso: string) => void; className?: string }) {
  const [text, setText] = useState(isoToTr(value));
  useEffect(() => setText(isoToTr(value)), [value]);
  const commit = () => {
    if (!text.trim()) { onChange(''); return; }
    const iso = trToIso(text);
    if (iso) onChange(iso);
    else setText(isoToTr(value));
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="GG.AA.YYYY"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      className={className ?? 'w-28 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs tabular-nums dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text'}
    />
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? 'bg-brand-600' : 'bg-slate-300 dark:bg-ndark-border'
      }`}
      aria-pressed={on}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  );
}

export function AdminWorkCalendarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const companies = useMemo(() => lookupService.companies(), []);
  const [companyId, setCompanyId] = useState<string>('');
  const [cal, setCal] = useState<WorkCalendar | null>(null);
  const [draft, setDraft] = useState<Draft>(draftFromCalendar(null));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<WorkCalendarPreviewResult[] | null>(null);
  // Tatil ekleme satırı
  const [hDate, setHDate] = useState('');
  const [hName, setHName] = useState('');
  const [hHalf, setHHalf] = useState(false);
  const [hHalfEnd, setHHalfEnd] = useState(780);
  const [calMonth, setCalMonth] = useState(() => new Date().toISOString().slice(0, 7)); // 'YYYY-MM'
  const [copySource, setCopySource] = useState('');

  useEffect(() => {
    if (!companyId && companies.length) setCompanyId(companies[0].id);
  }, [companies, companyId]);

  const load = useCallback(async (cid: string) => {
    setLoading(true);
    const data = await adminService.workCalendar.get(cid);
    setCal(data);
    setDraft(draftFromCalendar(data));
    setPreview(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (companyId) void load(companyId);
  }, [companyId, load]);

  const normalize = (d: Draft) => JSON.stringify(d);
  const dirty = normalize(draft) !== normalize(draftFromCalendar(cal));

  const draftPayload = () => ({
    workDays: draft.days
      .filter((d) => d.enabled && d.endMin > d.startMin)
      .map(({ day, startMin, endMin }) => ({ day, startMin, endMin })),
    breakStartMin: draft.breakEnabled ? draft.breakStartMin : null,
    breakEndMin: draft.breakEnabled ? draft.breakEndMin : null,
    isActive: draft.isActive,
    pauseOnCustomerWait: draft.pauseOnCustomerWait,
    effectiveFrom: draft.effectiveFrom ? `${draft.effectiveFrom}T00:00:00.000Z` : null,
  });

  async function handleSave() {
    if (!companyId) return;
    const payload = draftPayload();
    if (!payload.workDays.length) {
      toast({ type: 'error', message: 'En az bir çalışma günü tanımlanmalı.' });
      return;
    }
    setSaving(true);
    const saved = await adminService.workCalendar.save(companyId, payload);
    if (saved) {
      setCal(saved);
      setDraft(draftFromCalendar(saved));
      toast({ type: 'success', message: 'Çalışma takvimi kaydedildi.' });
    }
    setSaving(false);
  }

  async function handleAddHoliday() {
    if (!companyId || !hDate || !hName.trim()) {
      toast({ type: 'error', message: 'Tarih ve tatil adı zorunlu.' });
      return;
    }
    if (!cal) {
      toast({ type: 'error', message: 'Önce takvimi kaydedin — tatiller kayıtlı takvime bağlanır.' });
      return;
    }
    const created = await adminService.workCalendar.addHoliday(companyId, {
      date: hDate,
      name: hName.trim(),
      isHalfDay: hHalf,
      halfDayEndMin: hHalf ? hHalfEnd : null,
    });
    if (created) {
      setHDate('');
      setHName('');
      setHHalf(false);
      await load(companyId);
    }
  }

  async function handleRemoveHoliday(id: string) {
    if (!companyId) return;
    await adminService.workCalendar.removeHoliday(companyId, id);
    await load(companyId);
  }

  async function handleCopy() {
    if (!companyId || !copySource) return;
    const r = await adminService.workCalendar.copyFrom(companyId, copySource);
    if (r) {
      toast({ type: 'success', message: `${r.copied} tatil kopyalandı${r.skipped ? `, ${r.skipped} mevcut atlandı` : ''}.` });
      await load(companyId);
    }
  }

  async function handlePreview() {
    const payload = draftPayload();
    if (!payload.workDays.length) return;
    // Senaryolar: gelecek haftadan sabit örnekler kafa karıştırır — "önümüzdeki
    // Cuma 17:50", "yarın 11:30" gibi bağıl anlar kullan (sunucu hesaplar).
    const now = new Date();
    const nextDay = (dow: number, h: number, m: number) => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + ((dow + 7 - (d.getUTCDay() || 7)) % 7 || 7));
      d.setUTCHours(h - 3, m, 0, 0); // TR yerel → UTC (sabit +3)
      return d.toISOString();
    };
    const res = await adminService.workCalendar.preview(
      { ...payload, holidays: (cal?.holidays ?? []).map((h) => ({ date: h.date, isHalfDay: h.isHalfDay, halfDayEndMin: h.halfDayEndMin })) },
      [
        { startIso: nextDay(5, 17, 50), addMinutes: 30 },
        { startIso: nextDay(2, 11, 30), addMinutes: 240 },
        { startIso: nextDay(2, 9, 0), addMinutes: 24 * 60 },
      ],
    );
    if (res) setPreview(res.results);
  }

  // Ay-grid: seçili ayın günleri; tatiller renkli (salt görsel — ekleme formdan)
  const monthGrid = useMemo(() => {
    const [y, m] = calMonth.split('-').map(Number);
    if (!y || !m) return null;
    const first = new Date(Date.UTC(y, m - 1, 1));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const firstDow = (first.getUTCDay() + 6) % 7; // Pzt=0
    const holByDay = new Map(
      (cal?.holidays ?? [])
        .filter((h) => h.date.slice(0, 7) === calMonth)
        .map((h) => [Number(h.date.slice(8, 10)), h.isHalfDay ? 'half' : 'full']),
    );
    const enabledDays = new Set(draft.days.filter((d) => d.enabled).map((d) => d.day));
    return { daysInMonth, firstDow, holByDay, enabledDays };
  }, [calMonth, cal, draft.days]);

  const fmtIso = (iso: string | null | undefined) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
  };

  const weeklyNet = useMemo(() => {
    const brk = draft.breakEnabled ? Math.max(0, draft.breakEndMin - draft.breakStartMin) : 0;
    return draft.days
      .filter((d) => d.enabled && d.endMin > d.startMin)
      .reduce((sum, d) => {
        const gross = d.endMin - d.startMin;
        // Mola bu günün penceresiyle kesişiyorsa düş
        const overlap = draft.breakEnabled
          ? Math.max(0, Math.min(draft.breakEndMin, d.endMin) - Math.max(draft.breakStartMin, d.startMin))
          : 0;
        return sum + gross - Math.min(overlap, brk);
      }, 0);
  }, [draft]);

  if (user?.role !== 'SystemAdmin') {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-ndark-muted">
        <Lock size={16} className="mb-2" /> Bu ekran yalnız SystemAdmin rolüyle görüntülenebilir.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays size={18} className="text-brand-600" />
        <h1 className="text-lg font-bold text-slate-800 dark:text-ndark-text">
          Çalışma Takvimi &amp; SLA Süre Kuralları
        </h1>
        <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
          🔒 Yalnız SystemAdmin
        </span>
      </div>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500 dark:text-ndark-muted">
        SLA süreleri bu takvime göre hesaplanır: mesai dışı saatler, hafta sonu ve tatiller sayaca
        dahil edilmez. Her şirketin takvimi ayrıdır; takvim tanımlanmayan şirket eski (7/24) davranışta
        kalır — geçişi şirket şirket açabilirsiniz.
      </p>

      {/* Şirket seçici + durum */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">Şirket</span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            cal && cal.isActive && cal.effectiveFrom
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              : 'border border-slate-200 bg-slate-50 text-slate-500 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-muted'
          }`}
        >
          {cal && cal.isActive && cal.effectiveFrom
            ? `● İş-saati aktif (${cal.effectiveFrom.slice(0, 10)}'den beri)`
            : cal
              ? '○ Takvim kayıtlı — kesim tarihi bekleniyor'
              : '○ Tanımsız — eski (7/24) davranış'}
        </span>
        {loading && <Loader2 size={15} className="animate-spin text-slate-400" />}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* 1 · Haftalık mesai + mola */}
        <section className="rounded-xl border border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
          <header className="border-b border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-800 dark:border-ndark-border dark:text-ndark-text">
            1 · Haftalık Mesai Penceresi
            <span className="ml-2 text-[10px] font-normal text-slate-400 dark:text-ndark-dim">yerel saat · Europe/İstanbul</span>
          </header>
          <div className="px-4 py-2">
            {draft.days.map((d, i) => (
              <div key={d.day} className={`flex items-center gap-2.5 border-b border-slate-100 py-1.5 last:border-0 dark:border-ndark-border/40 ${d.enabled ? '' : 'opacity-50'}`}>
                <span className="w-20 text-xs font-semibold text-slate-700 dark:text-ndark-text">{DAY_NAMES[i]}</span>
                <Toggle on={d.enabled} onChange={(v) => setDraft((p) => ({ ...p, days: p.days.map((x, j) => (j === i ? { ...x, enabled: v } : x)) }))} />
                <TimeSelect value={d.startMin} disabled={!d.enabled}
                  onChange={(v) => setDraft((p) => ({ ...p, days: p.days.map((x, j) => (j === i ? { ...x, startMin: v } : x)) }))} />
                <span className="text-xs text-slate-400">–</span>
                <TimeSelect value={d.endMin} disabled={!d.enabled}
                  onChange={(v) => setDraft((p) => ({ ...p, days: p.days.map((x, j) => (j === i ? { ...x, endMin: v } : x)) }))} />
              </div>
            ))}
          </div>
          <div className="border-t border-slate-200 px-4 py-2.5 dark:border-ndark-border">
            <div className="flex items-center gap-2.5">
              <Toggle on={draft.breakEnabled} onChange={(v) => setDraft((p) => ({ ...p, breakEnabled: v }))} />
              <span className="text-xs font-semibold text-slate-700 dark:text-ndark-text">Öğle Arası (mola)</span>
              <span className="ml-auto inline-flex items-center gap-1.5">
                <TimeSelect value={draft.breakStartMin} disabled={!draft.breakEnabled}
                  onChange={(v) => setDraft((p) => ({ ...p, breakStartMin: v }))} />
                <span className="text-xs text-slate-400">–</span>
                <TimeSelect value={draft.breakEndMin} disabled={!draft.breakEnabled}
                  onChange={(v) => setDraft((p) => ({ ...p, breakEndMin: v }))} />
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400 dark:text-ndark-dim">
              Tüm çalışma günlerine uygulanır ve mesaiden düşülür; öğleni kesen SLA sayacı bu aralığı saymaz.
            </p>
            <div className="mt-2 flex justify-between border-t border-dashed border-slate-200 pt-2 text-xs dark:border-ndark-border">
              <span className="text-slate-500 dark:text-ndark-muted">Haftalık net mesai <span className="text-slate-400 dark:text-ndark-dim">(mola düşülmüş)</span></span>
              <b className="tabular-nums text-brand-600 dark:text-ndark-link">{fmtMin(weeklyNet)} · {weeklyNet.toLocaleString('tr-TR')} dk</b>
            </div>
          </div>
        </section>

        {/* 3 · SLA duraklatma kuralları */}
        <section className="rounded-xl border border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
          <header className="border-b border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-800 dark:border-ndark-border dark:text-ndark-text">
            2 · SLA Duraklatma Kuralları
          </header>
          <div className="px-4 py-2 text-xs">
            <div className="flex items-start gap-2.5 border-b border-slate-100 py-2.5 dark:border-ndark-border/40">
              <Toggle on={draft.pauseOnCustomerWait} onChange={(v) => setDraft((p) => ({ ...p, pauseOnCustomerWait: v }))} />
              <div>
                <div className="font-semibold text-slate-700 dark:text-ndark-text">Müşteriden yanıt beklenirken SLA dursun</div>
                <div className="mt-0.5 leading-relaxed text-slate-400 dark:text-ndark-dim">
                  Varsayılan <b>kapalı</b> — açılırsa bu şirketteki vakalarda çözüm sayacı müşteri-bekleme sırasında durur.
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2.5 border-b border-slate-100 py-2.5 dark:border-ndark-border/40">
              <Toggle on disabled />
              <div>
                <div className="font-semibold text-slate-700 dark:text-ndark-text">3. parti beklenirken SLA dursun</div>
                <div className="mt-0.5 leading-relaxed text-slate-400 dark:text-ndark-dim">
                  Tanım bazlı yönetilir — hangi 3. partinin durduracağı <b>3. Parti Tanımları</b> ekranındaki
                  "SLA'yı durdurur" bayrağıyla belirlenir.
                </div>
              </div>
              <span className="ml-auto shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-400 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-dim">tanım-bazlı</span>
            </div>
            <div className="flex items-start gap-2.5 py-2.5 opacity-50">
              <Toggle on={false} disabled />
              <div>
                <div className="font-semibold text-slate-700 dark:text-ndark-text">Yanıt (müdahale) SLA'sı duraklamadan etkilensin</div>
                <div className="mt-0.5 leading-relaxed text-slate-400 dark:text-ndark-dim">Kapsam dışı — yanıt SLA'sı yalnız iş-saatiyle hesaplanır.</div>
              </div>
              <span className="ml-auto shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-400 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-dim">v2</span>
            </div>
          </div>
          {/* Kesim tarihi */}
          <div className="border-t border-slate-200 px-4 py-3 dark:border-ndark-border">
            <div className="flex flex-wrap items-center gap-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-ndark-muted">İş-saati başlangıcı (kesim tarihi)</span>
                <DateInputTR value={draft.effectiveFrom}
                  onChange={(iso) => setDraft((p) => ({ ...p, effectiveFrom: iso }))} />
              </label>
              <p className="min-w-[200px] flex-1 text-[11px] leading-relaxed text-slate-400 dark:text-ndark-dim">
                Bu tarihten itibaren açılan vakalar iş-saatiyle damgalanır; boş bırakılırsa takvim kayıtlı
                ama geçiş başlamamış sayılır. Raporlara dipnot bu tarihle girer.
              </p>
            </div>
          </div>
        </section>

        {/* 2 · Resmi tatiller */}
        <section className="rounded-xl border border-slate-200 bg-white lg:col-span-2 dark:border-ndark-border dark:bg-ndark-card">
          <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-ndark-border">
            <span className="text-sm font-bold text-slate-800 dark:text-ndark-text">3 · Resmi Tatiller</span>
            <span className="inline-flex items-center gap-1">
              <button type="button" onClick={() => setCalMonth((m) => shiftMonth(m, -1))}
                className="rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-ndark-border dark:text-ndark-muted">‹</button>
              <span className="min-w-[92px] text-center text-xs font-semibold text-slate-600 dark:text-ndark-muted">
                {MONTH_NAMES[Number(calMonth.slice(5, 7)) - 1]} {calMonth.slice(0, 4)}
              </span>
              <button type="button" onClick={() => setCalMonth((m) => shiftMonth(m, 1))}
                className="rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-ndark-border dark:text-ndark-muted">›</button>
            </span>
            <span className="text-[11px] text-slate-400 dark:text-ndark-dim">{cal?.holidays.length ?? 0} tatil tanımlı</span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              <select value={copySource} onChange={(e) => setCopySource(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text">
                <option value="">Kopyala: kaynak şirket…</option>
                {companies.filter((c) => c.id !== companyId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => void handleCopy()} disabled={!copySource || !cal}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-600 disabled:opacity-40 dark:border-ndark-border dark:text-ndark-muted">
                <Copy size={11} /> Kopyala
              </button>
            </span>
          </header>
          <div className="grid gap-5 px-4 py-3 md:grid-cols-[280px_1fr]">
            {/* Ay-grid (salt görsel) */}
            <div>
              {monthGrid && (
                <>
                  <div className="grid grid-cols-7 gap-0.5">
                    {['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'].map((d) => (
                      <div key={d} className="py-0.5 text-center text-[9px] font-bold uppercase text-slate-400 dark:text-ndark-dim">{d}</div>
                    ))}
                    {Array.from({ length: monthGrid.firstDow }).map((_, i) => <div key={`p${i}`} />)}
                    {Array.from({ length: monthGrid.daysInMonth }).map((_, i) => {
                      const day = i + 1;
                      const dow = ((monthGrid.firstDow + i) % 7) + 1;
                      const hol = monthGrid.holByDay.get(day);
                      const off = !monthGrid.enabledDays.has(dow);
                      const cls = hol === 'full'
                        ? 'bg-red-50 font-bold text-red-600 dark:bg-red-900/30 dark:text-red-300'
                        : hol === 'half'
                          ? 'bg-amber-50 font-bold text-amber-600 dark:bg-amber-900/30 dark:text-amber-300'
                          : off
                            ? 'bg-slate-50 text-slate-300 dark:bg-ndark-bg dark:text-ndark-dim'
                            : 'bg-slate-50 text-slate-600 dark:bg-ndark-bg dark:text-ndark-muted';
                      return (
                        <div key={day} className={`flex aspect-square items-center justify-center rounded-md text-[11px] ${cls}`}>{day}</div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-400 dark:text-ndark-dim">
                    <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />tam tatil</span>
                    <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />yarım gün</span>
                    <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-300" />mesai dışı gün</span>
                  </div>
                </>
              )}
            </div>
            {/* Liste + ekleme */}
            <div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-ndark-dim">
                    <th className="border-b border-slate-200 px-2 py-1.5 dark:border-ndark-border">Tarih</th>
                    <th className="border-b border-slate-200 px-2 py-1.5 dark:border-ndark-border">Ad</th>
                    <th className="border-b border-slate-200 px-2 py-1.5 dark:border-ndark-border">Tür</th>
                    <th className="w-9 border-b border-slate-200 dark:border-ndark-border" />
                  </tr>
                </thead>
                <tbody>
                  {(cal?.holidays ?? []).map((h) => (
                    <tr key={h.id} className="border-b border-slate-100 dark:border-ndark-border/40">
                      <td className="px-2 py-1.5 tabular-nums text-slate-700 dark:text-ndark-text">{h.date.slice(0, 10).split('-').reverse().join('.')}</td>
                      <td className="px-2 py-1.5 text-slate-700 dark:text-ndark-text">{h.name}</td>
                      <td className="px-2 py-1.5">
                        {h.isHalfDay
                          ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">Yarım (→{toHHMM(h.halfDayEndMin ?? 780)})</span>
                          : <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:bg-red-900/30 dark:text-red-300">Tam gün</span>}
                      </td>
                      <td className="px-1 text-center">
                        <button type="button" onClick={() => void handleRemoveHoliday(h.id)} title="Sil"
                          className="text-slate-300 hover:text-red-500 dark:text-ndark-dim">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(cal?.holidays.length ?? 0) === 0 && (
                    <tr><td colSpan={4} className="px-2 py-4 text-center text-slate-400 dark:text-ndark-dim">Henüz tatil tanımlanmadı{!cal ? ' — önce takvimi kaydedin' : ''}.</td></tr>
                  )}
                </tbody>
              </table>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-dashed border-slate-200 pt-2.5 dark:border-ndark-border">
                <DateInputTR value={hDate} onChange={setHDate} />
                <input type="text" value={hName} onChange={(e) => setHName(e.target.value)} placeholder="Tatil adı (örn. Zafer Bayramı)"
                  className="min-w-[140px] flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text" />
                <select value={hHalf ? 'half' : 'full'} onChange={(e) => setHHalf(e.target.value === 'half')}
                  className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text">
                  <option value="full">Tam gün</option>
                  <option value="half">Yarım gün</option>
                </select>
                {hHalf && <TimeSelect value={hHalfEnd} onChange={setHHalfEnd} />}
                <button type="button" onClick={() => void handleAddHoliday()} disabled={!cal}
                  className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40">
                  + Ekle
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400 dark:text-ndark-dim">
                Yarım günde mesai seçilen saatte kapanır (arife). Dini bayramlar yıl yıl kaydığından her yıl girilir;
                "Kopyala" ile başka şirketin tatilleri hızlıca çoğaltılır.
              </p>
            </div>
          </div>
        </section>

        {/* 4 · Örnek hesaplama (kaydetmeden, sunucu motoru) */}
        <section className="rounded-xl border border-brand-200 bg-gradient-to-b from-brand-50/40 to-white lg:col-span-2 dark:border-ndark-border dark:from-ndark-bg/40 dark:to-ndark-card">
          <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-ndark-border">
            <span className="text-sm font-bold text-slate-800 dark:text-ndark-text">4 · Örnek Hesaplama</span>
            <span className="text-[10px] text-slate-400 dark:text-ndark-dim">taslak takvimle · kaydetmeden · sunucu hesaplar</span>
            <button type="button" onClick={() => void handlePreview()}
              className="ml-auto rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-600 dark:border-ndark-border dark:text-ndark-muted">
              Hesapla
            </button>
          </header>
          <div className="px-4 py-2 text-xs">
            {!preview && <p className="py-2 text-slate-400 dark:text-ndark-dim">"Hesapla" ile taslak takvimin üç örnek senaryodaki davranışını görün.</p>}
            {preview && (
              <div className="divide-y divide-slate-100 dark:divide-ndark-border/40">
                {[
                  'Önümüzdeki Cuma 17:50 açılan vaka · müdahale hedefi 30 dk',
                  'Önümüzdeki Salı 11:30 açılan vaka · müdahale hedefi 4 saat (öğleni keser)',
                  'Önümüzdeki Salı 09:00 açılan vaka · çözüm hedefi 24 saat',
                ].map((label, i) => (
                  <div key={label} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="text-slate-500 dark:text-ndark-muted">{label}</span>
                    <span className="font-bold text-brand-600 dark:text-ndark-link">→</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {preview[i]?.kind === 'add' ? fmtIso(preview[i]?.resultIso) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Kaydet çubuğu */}
      <div className="mt-4 flex items-center gap-2.5 border-t border-slate-200 pt-3 dark:border-ndark-border">
        {dirty && <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">● Kaydedilmemiş değişiklik var</span>}
        <div className="flex-1" />
        <button type="button" disabled={!dirty || saving} onClick={() => setDraft(draftFromCalendar(cal))}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 disabled:opacity-40 dark:border-ndark-border dark:text-ndark-muted">
          Vazgeç
        </button>
        <button type="button" disabled={!dirty || saving} onClick={() => void handleSave()}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {saving && <Loader2 size={12} className="animate-spin" />} Kaydet
        </button>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-400 dark:text-ndark-dim">
        <b className="text-slate-500 dark:text-ndark-muted">Değişmeyen:</b> SLA süre değerleri (SLA Kuralları ekranında) aynen kalır —
        bu ekran yalnız o sürelerin <i>ne zaman aktığını</i> tanımlar. Dakika tek doğruluk kaynağıdır;
        "gün" gösterimleri net mesai katsayısıyla türetilir.
      </p>
    </div>
  );
}
