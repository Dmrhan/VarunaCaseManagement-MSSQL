/**
 * smoke-status-report-v2.js — Durum Raporu v2 (SLA/DevOps + iki mod). 2026-07-17
 * Yapısal (mode fail-safe, dil tablosu, PII paritesi, imza) + fonksiyonel
 * (DevOps okuyucu, iş-saati kalan format). DB'ye yazmaz; AI çağırmaz.
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const rd = (p) => readFileSync(p, 'utf8');
const src = rd('server/lib/actionSummaryAi.js');

// ── 1 · Mode sözleşmesi + fail-safe ──
ok('1 mode param + fail-safe: geçersiz değer internal\'a düşer',
  src.includes("mode = 'internal'")
  && src.includes("const REPORT_MODES = new Set(['internal', 'customer'])")
  && src.includes("REPORT_MODES.has(mode) ? mode : 'internal'"));
ok('2 route mode geçişi + FE service mode param',
  rd('server/routes/cases.js').includes('mode: (req.body ?? {}).mode')
  && rd('src/services/caseService.ts').includes("mode: 'internal' | 'customer' = 'internal'")
  && rd('src/services/caseService.ts').includes('JSON.stringify({ mode })'));

// ── 2 · Müşteri modu dil tablosu (prompt kuralları) ──
ok('3 customer prompt: jargon yasağı (log/eskalasyon/SLA ihlali/3.parti) açıkça listeli',
  src.includes('iç mutfak jargonu YASAK')
  && src.includes('"log", "eskalasyon", "SLA ihlali", "3. parti"'));
ok('4 customer prompt: iç risk gizleme + boş-alan ATLAMA (kayıtta yok YAZMA)',
  src.includes('İÇ RİSKLERİ GİZLE')
  && src.includes('TAMAMEN ATLA')
  && src.includes('YAZMA. (Boş-alan kuralı.)'));
ok('5 internal prompt: iç bilgiler serbest (geri uyumlu) + log-yok ifadesi korunur',
  src.includes('İç bilgiler (eskalasyon, SLA ihlali')
  && src.includes('"loglarda görünmüyor"'));

// ── 3 · PII paritesi — customer modunda GENİŞLEMEZ ──
ok('6 PII izin listesi customer modunda genişletilmedi (yorum + email/phone yok)',
  src.includes("'customer' modunda bile bu izin listesi GENİŞLETİLMEZ")
  && !src.includes('customerContactEmail: true')
  && !src.includes('accountEmail: true'));

// ── 4 · İmza (customer=kurumsal / internal=sistem) ──
ok('7 imza: customer → sorumlu+unvan+şirket adı; internal → Varuna sistem imzası',
  src.includes('const footerBlock = (isCustomer')
  && src.includes('c.companyName ?? \'\',')
  && src.includes("['Saygılarımızla,', owner, 'Varuna Vaka Yönetim Sistemi']"));
ok('8 hitap: customer → firma ekibi; internal → Sayın İlgili',
  src.includes('`Sayın ${c.accountName} Ekibi,`')
  && src.includes("'Sayın İlgili,'"));

// ── 5 · Zenginleştirme: SLA + DevOps + bekleme (Q2 conditional) ──
ok('9 SLA bölümü: iş-saati kalan + uzatılmış kaynak notu + conditional',
  src.includes('SLA HEDEFİ:')
  && src.includes("c.slaTargetSource === 'extended'")
  && src.includes('sözleşmedeki yazılım geliştirme çözüm süresi kapsamında')
  && src.includes('if (c.slaResolutionDueAt || c.slaResponseDueAt)'));
ok('10 DevOps bölümü: geliştirme referansı + durum, id filtreli',
  src.includes('YAZILIM GELİŞTİRME REFERANSI:')
  && src.includes('Geliştirme kaydı #${e.id}')
  && src.includes('.filter((e) => e?.id != null)'));
ok('11 bekleme muhasebesi: pausedMin>0 → "neden sürdü" satırı',
  src.includes('BEKLEME SÜRESİ:')
  && src.includes('SLA sayacı bu süre durdu'));

// ── 6 · Fonksiyonel: DevOps okuyucu + iş-saati format (saf) ──
const mod = await import('../server/lib/actionSummaryAi.js').catch(() => null);
// helper'lar export edilmediği için davranışı dolaylı kilitliyoruz: kaynakta
// diffMinutes/netDayMinutes/getCalendarGateFor reuse edildiğini doğrula.
ok('12 reuse-first: iş-saati Faz 4 fonksiyonları (getCalendarGateFor/diffMinutes/netDayMinutes)',
  src.includes("from './sla/businessTime.js'")
  && src.includes('getCalendarGateFor(c.companyId)')
  && src.includes('diffMinutes(fromMs, dueMs, cal)'));
ok('13 iş-saati etiketi: takvimli "iş-sa/iş günü", takvimsiz "sa/gün" (temiz — replace hilesi yok)',
  src.includes("cal ? 'iş-sa' : 'sa'")
  && src.includes("cal ? 'iş günü' : 'gün'")
  && !src.includes(".replace('saati'"));

// ── 7 · Guard pariteti korundu ──
ok('14 guard pariteti: 404/403/503, MAX_EVENTS, AI-meta filtresi, transient (persist yok)',
  src.includes("return { error: 'not_found' }")
  && src.includes("return { error: 'forbidden' }")
  && src.includes('const MAX_EVENTS = 50')
  && src.includes('AI_META_FIELDS')
  && !src.includes('prisma.case.update({ where: { id: caseId }')); // rapor persistlenmez

// ── 8 · FE mode seçici ──
ok('15 modal: mode toggle (İç Yönetici/Müşteri) + değişince yeniden üret + müşteri uyarısı',
  rd('src/features/cases/CaseDetailPage.tsx').includes("useState<'internal' | 'customer'>('internal')")
  && rd('src/features/cases/CaseDetailPage.tsx').includes('[open, caseId, reportMode]')
  && rd('src/features/cases/CaseDetailPage.tsx').includes('Göndermeden önce içeriği kontrol edin'));

// ── 9 · Codex #553 P2×3 fix'leri ──
ok('16 #553-1 accountName null: müşteri hitabı "Sayın null Ekibi" üretmez (fallback)',
  src.includes('c.accountName ? `Sayın ${c.accountName} Ekibi,` : \'Sayın İlgili,\''));
ok('17 #553-2 nextStep mode-aware: müşteri modunda "belirtilmemiştir" YAZMAZ (boş bölüm atlanır)',
  src.includes('isCustomer\n      ? \'- nextStep')
  && src.includes('else if (!isCustomer) parts.push(...sec(\'SONRAKİ ADIM\', \'Loglarda belirtilmemiştir.\'))')
  && src.includes("const emptyFill = isCustomer ? '' : 'loglarda görünmüyor'"));
ok('18 #553-3 kısa duraklama dk dalı: formatBusinessSpan 60dk altı "N dk" (0 sa değil)',
  src.includes('function formatBusinessSpan(minutes, cal)')
  && src.includes('if (abs < 60) return `${abs} dk`')
  && src.includes('formatBusinessSpan(pausedMin, cal)')
  && src.includes('formatBusinessSpan(min, cal)')); // formatSlaRemaining de reuse eder

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
