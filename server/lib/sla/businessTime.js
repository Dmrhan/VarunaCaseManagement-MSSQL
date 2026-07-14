/**
 * businessTime.js — SLA iş-saati motoru (Faz 1, 2026-07-14).
 *
 * SLA sürelerini şirket bazlı mesai penceresi + resmi tatillere göre akıtan
 * SAF hesap çekirdeği. Bu dosyada yan etki yok; DB erişimi yalnız
 * loadWorkCalendar'da (şirket-başına TTL cache ile — Faz 3'te damga ve
 * Faz 4 tüketicileri kullanacak; şu an ÇAĞIRAN YOK, tek başına shippable).
 *
 * Karar defteri (Faz 0, kullanıcı 2026-07-13/14):
 *  - Şirket (tenant) bazlı takvim; takvimsiz/pasif şirket → fonksiyonlar
 *    çağrılmaz, çağıran duvar-saatine düşer (loadWorkCalendar null döner).
 *  - DAKİKA = tek doğruluk kaynağı; "gün" çevrimi tek katsayıyla (raporda).
 *  - Öğle molası TEK tanım, tüm çalışma günlerine uygulanır, mesaiden düşer.
 *  - Arife (yarım gün): mesai halfDayEndMin'de biter; mola pencereyle
 *    kesişiyorsa yine düşülür (08:30-13:00 arife + 12:00-13:00 mola →
 *    o gün fiilen 08:30-12:00 çalışılır).
 *  - Yanıt SLA'sı da iş-saatiyle akar (duraklama davranışı ayrı; burada değil).
 *
 * Zaman modeli: Europe/Istanbul SABİT UTC+3 (2016'dan beri DST yok) —
 * cronScheduler.js:28 ile aynı varsayım. Tüm dönüşüm bu modülde tek
 * noktada; sunucunun kendi TZ'sinden BAĞIMSIZ (deterministik test edilir).
 *
 * Performans notu: gün-yürüyüşlü hesap (O(gün)). 1 yıllık aralık ≈ 365
 * iterasyon × basit aritmetik — pano ölçeğinde (birkaç bin satır) yeterli.
 * Gerekirse Faz 4'te yıl-bazlı prefix-sum eklenir (API değişmez).
 */

import { prisma } from '../../db/client.js';

const TR_OFFSET_MS = 3 * 60 * 60 * 1000; // Europe/Istanbul sabit UTC+3
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
/** Sonsuz döngü guard'ı: tek hesapta en fazla bu kadar takvim günü yürünür. */
const MAX_WALK_DAYS = 3 * 366;

// ── Yerel (TR) gün yardımcıları — hepsi UTC aritmetiğiyle, Date TZ'siz ──

/** UTC ms → TR-yerel "gün başlangıcı" UTC ms + gün-içi dakika. */
function toLocal(ms) {
  const shifted = ms + TR_OFFSET_MS;
  const dayStartShifted = Math.floor(shifted / DAY_MS) * DAY_MS;
  return {
    dayStartMs: dayStartShifted - TR_OFFSET_MS, // TR geceyarısının UTC karşılığı
    minuteOfDay: Math.floor((shifted - dayStartShifted) / MIN_MS),
  };
}

/** TR-yerel gün başlangıcı (UTC ms) + gün-içi dakika → UTC ms. */
function fromLocal(dayStartMs, minuteOfDay) {
  return dayStartMs + minuteOfDay * MIN_MS;
}

/** TR-yerel ISO gün numarası (1=Pzt..7=Paz) — 1970-01-01 Perşembe(4) referanslı. */
function isoWeekday(dayStartMs) {
  const daysSinceEpoch = Math.round((dayStartMs + TR_OFFSET_MS) / DAY_MS);
  return ((daysSinceEpoch + 3) % 7) + 1; // epoch günü Perşembe → +3 kaydır
}

/** TR-yerel 'YYYY-MM-DD' anahtarı (tatil eşleşmesi için). */
function localDateKey(dayStartMs) {
  return new Date(dayStartMs + TR_OFFSET_MS).toISOString().slice(0, 10);
}

// ── Takvim normalizasyonu ────────────────────────────────────────────

/**
 * Ham kayıt → hesap-hazır takvim. workDays JSON string ya da dizi kabul
 * eder; bozuk/boş tanım null döner (çağıran duvar-saatine düşer — sessiz
 * yanlış hesap yerine dürüst geri çekilme).
 *
 * holidays: [{date: Date|'YYYY-MM-DD', isHalfDay, halfDayEndMin}]
 */
export function normalizeCalendar(raw) {
  if (!raw || raw.isActive === false) return null;
  let days = raw.workDays;
  if (typeof days === 'string') {
    try {
      days = JSON.parse(days);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(days)) return null;
  const byDay = new Map();
  for (const d of days) {
    const day = Number(d?.day);
    const startMin = Number(d?.startMin);
    const endMin = Number(d?.endMin);
    if (!Number.isInteger(day) || day < 1 || day > 7) continue;
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) continue;
    if (endMin <= startMin || startMin < 0 || endMin > 24 * 60) continue;
    byDay.set(day, { startMin, endMin });
  }
  if (byDay.size === 0) return null;

  const bs = Number(raw.breakStartMin);
  const be = Number(raw.breakEndMin);
  const hasBreak = Number.isFinite(bs) && Number.isFinite(be) && be > bs;

  const holidays = new Map();
  for (const h of raw.holidays ?? []) {
    const key =
      typeof h?.date === 'string'
        ? h.date.slice(0, 10)
        : h?.date instanceof Date
          ? h.date.toISOString().slice(0, 10)
          : null;
    if (!key) continue;
    holidays.set(key, {
      isHalfDay: !!h.isHalfDay,
      halfDayEndMin: Number.isFinite(Number(h.halfDayEndMin)) ? Number(h.halfDayEndMin) : null,
    });
  }

  return {
    byDay,
    breakStartMin: hasBreak ? bs : null,
    breakEndMin: hasBreak ? be : null,
    holidays,
  };
}

/**
 * Belirli bir TR-yerel günün ÇALIŞMA ARALIKLARI (gün-içi dakika çiftleri).
 * Hafta sonu/tam tatil → []. Yarım günde pencere halfDayEndMin'de kırpılır;
 * mola pencereyle kesişiyorsa çıkarılır.
 */
export function dayIntervals(dayStartMs, cal) {
  const win = cal.byDay.get(isoWeekday(dayStartMs));
  if (!win) return [];
  const hol = cal.holidays.get(localDateKey(dayStartMs));
  let { startMin, endMin } = win;
  if (hol) {
    if (!hol.isHalfDay) return []; // tam tatil
    endMin = Math.min(endMin, hol.halfDayEndMin ?? endMin);
    if (endMin <= startMin) return [];
  }
  // Mola çıkarımı — tek mola, pencereyle kesişen kısmı düşülür.
  const out = [];
  if (
    cal.breakStartMin != null &&
    cal.breakEndMin != null &&
    cal.breakStartMin < endMin &&
    cal.breakEndMin > startMin
  ) {
    const b0 = Math.max(cal.breakStartMin, startMin);
    const b1 = Math.min(cal.breakEndMin, endMin);
    if (startMin < b0) out.push([startMin, b0]);
    if (b1 < endMin) out.push([b1, endMin]);
  } else {
    out.push([startMin, endMin]);
  }
  return out;
}

// ── Ana API ──────────────────────────────────────────────────────────

/**
 * startMs'ten itibaren N iş-dakikası ekle → hedef an (UTC ms).
 * Mesai dışı başlangıç sonraki iş anına yuvarlanır (0 dk eklemek bile
 * "sonraki iş anı"nı verir). minutes < 0 desteklenmez.
 */
export function addBusinessMinutes(startMs, minutes, cal) {
  if (!cal) return null;
  let remaining = Math.max(0, Math.round(minutes));
  let { dayStartMs, minuteOfDay } = toLocal(startMs);

  for (let guard = 0; guard < MAX_WALK_DAYS; guard += 1) {
    for (const [a, b] of dayIntervals(dayStartMs, cal)) {
      const from = Math.max(a, minuteOfDay);
      if (from >= b) continue;
      const available = b - from;
      if (remaining <= available) {
        // 0 dk = "sonraki iş anı"; tam-aralık-sonu = aralığın son dakikası.
        return fromLocal(dayStartMs, from + remaining);
      }
      remaining -= available;
    }
    dayStartMs += DAY_MS;
    minuteOfDay = 0;
  }
  return null; // takvim fiilen boş (guard) — çağıran duvar-saatine düşmeli
}

/**
 * İki an arasındaki İŞ-DAKİKASI (aMs ≤ bMs beklenir; değilse negatif işaretli
 * simetrik sonuç döner). Mesai dışı/molada/tatilde geçen süre sayılmaz.
 */
export function businessMinutesBetween(aMs, bMs, cal) {
  if (!cal) return null;
  if (bMs < aMs) {
    const v = businessMinutesBetween(bMs, aMs, cal);
    return v == null ? null : -v;
  }
  let total = 0;
  let { dayStartMs } = toLocal(aMs);
  const aLocal = toLocal(aMs);
  const bLocal = toLocal(bMs);

  for (let guard = 0; guard < MAX_WALK_DAYS; guard += 1) {
    if (dayStartMs > bLocal.dayStartMs) return total; // aralık tamamen tarandı
    const lo = dayStartMs === aLocal.dayStartMs ? aLocal.minuteOfDay : 0;
    const hi = dayStartMs === bLocal.dayStartMs ? bLocal.minuteOfDay : 24 * 60;
    for (const [x, y] of dayIntervals(dayStartMs, cal)) {
      total += Math.max(0, Math.min(y, hi) - Math.max(x, lo));
    }
    dayStartMs += DAY_MS;
  }
  // Codex #538 P2: guard tükendi (aralık > MAX_WALK_DAYS) — KISMİ toplam
  // döndürmek sessiz yanlış sonuç olur; dürüst geri çekilme = null
  // (addBusinessMinutes'in guard davranışıyla simetrik).
  return null;
}

/** startMs mesai içindeyse kendisi; değilse sonraki iş anı (UTC ms). */
export function nextBusinessStart(startMs, cal) {
  return addBusinessMinutes(startMs, 0, cal);
}

// ── Takvim yükleme (Faz 3+ tüketicileri için; şirket-başına cache) ───

const CACHE_TTL_MS = 5 * 60 * 1000;
/** @type {Map<string, { cal: object|null, expiresAt: number }>} */
const _calCache = new Map();

/** Cache'i boşalt — admin CRUD (Faz 2) yazımlarından sonra çağrılır. */
export function invalidateWorkCalendarCache(companyId) {
  if (companyId) _calCache.delete(companyId);
  else _calCache.clear();
}

async function loadEntry(companyId) {
  const now = Date.now();
  const hit = _calCache.get(companyId);
  if (hit && hit.expiresAt > now) return hit;
  const raw = await prisma.workCalendar.findUnique({
    where: { companyId },
    include: { holidays: true },
  });
  const entry = {
    cal: raw ? normalizeCalendar(raw) : null,
    // Kesim tarihi (karar #3): null = takvim kayıtlı ama geçiş başlamamış.
    effectiveFromMs: raw?.effectiveFrom ? new Date(raw.effectiveFrom).getTime() : null,
    // K-F toggle — isActive kapalıysa kural da kapalı (tek kill-switch).
    pauseOnCustomerWait: !!(raw && raw.isActive !== false && raw.pauseOnCustomerWait),
    expiresAt: now + CACHE_TTL_MS,
  };
  _calCache.set(companyId, entry);
  return entry;
}

/**
 * Şirketin hesap-hazır takvimi; tanımsız/pasif/bozuk ise null (çağıran
 * duvar-saati davranışına düşer — kademeli geçişin temeli).
 */
export async function loadWorkCalendar(companyId) {
  return (await loadEntry(companyId)).cal;
}

/**
 * SLA duraklatma kuralları (Faz 3b) — Çalışma Takvimi ekranındaki
 * parametrik toggle'lar. Takvim kaydı yoksa hepsi kapalı (bugünkü davranış).
 * NOT: damga kapısından (getEffectiveCalendar) BAĞIMSIZ — duraklatma
 * kuralı kesim tarihi beklemez (3rd-party pause bugün de takvimsiz çalışıyor).
 */
export async function getSlaPauseRules(companyId) {
  const entry = await loadEntry(companyId);
  return { pauseOnCustomerWait: entry.pauseOnCustomerWait };
}

/**
 * DAMGA KAPISI (Faz 3): takvim aktif VE kesim tarihi (effectiveFrom)
 * verilen anı kapsıyorsa takvimi döndürür; aksi halde null → çağıran
 * duvar-saatiyle damgalar. Kesim tarihi boşsa geçiş BAŞLAMAMIŞTIR
 * (takvim kayıtlı olsa bile) — duyurulu geçiş ilkesi.
 */
export async function getEffectiveCalendar(companyId, atMs = Date.now()) {
  const entry = await loadEntry(companyId);
  if (!entry.cal) return null;
  if (entry.effectiveFromMs == null || atMs < entry.effectiveFromMs) return null;
  return entry.cal;
}
