/**
 * retry-pending-notifications.js
 *
 * 2026-07-01 sistemsel düzeltmesi sonrası — Pending kalmış dispatch'leri
 * yeni kural kanalı önceliği + requester fallback ile TEKRAR TETİKLE.
 *
 * ═══ Mantık — Codex P1+P2 sonrası (2026-07-01) ═══
 *
 * 1. Filtre: state='Pending' AND
 *       audienceIdentifier NOT LIKE '%@%'   (email değil → "manual" veya
 *                                             telefon numarası)
 *    Bu tam olarak fix'in çözdüğü senaryo: email göndermek için
 *    yapılandırılmış ama identifier email olarak çözünememiş.
 *
 * 2. HER Pending row AYRI işlenir (Codex P1) — kendi ruleId'sini
 *    `emitEvent({ targetRuleId })` ile hedefler. `emitEvent`in default
 *    davranışı case+event için TÜM aktif rule'ları tarar; retry
 *    sırasında bu davranış aynı case+event'te ZATEN Sent olmuş ilgisiz
 *    rule'ların (idempotency penceresi dolduysa) TEKRAR gönderim
 *    yapmasına yol açar — targetRuleId bunu engeller.
 *
 * 3. Replacement kontrolü (Codex P2) — emit BOŞ dönerse (rule
 *    disable/edit, case artık match etmiyor, event artık kabul
 *    edilmiyor) eski Pending KORUNSUN; suppress ETME. Aksi halde
 *    operatör kuyruğundan silinen row'un yerine hiçbir replacement
 *    kalmaz. Emit >=1 dispatch üretmişse (Sent/Pending/Suppressed
 *    farkı fark etmez — rule bilinçli çalıştı) eski Pending'i
 *    `Suppressed, superseded_by_retry` yap.
 *
 * ═══ CLI kullanımı ═══
 *
 *   # DRY-RUN — hiçbir şeye dokunma, sadece say ve raporla:
 *   node --env-file=.env scripts/retry-pending-notifications.js --dry-run
 *
 *   # Uygula (defansif limit 500):
 *   node --env-file=.env scripts/retry-pending-notifications.js
 *
 *   # Tek tenant:
 *   node --env-file=.env scripts/retry-pending-notifications.js --company COMP_UNIVERA
 *
 *   # Tek vaka test (dev/prod'da):
 *   node --env-file=.env scripts/retry-pending-notifications.js --case cus_XXXX
 *
 *   # Son 7 gün + limit 100:
 *   node --env-file=.env scripts/retry-pending-notifications.js --max-age-days 7 --limit 100
 *
 * ═══ Uyarılar ═══
 *
 *   - Rate limit: bir kuralın rateLimitPerHour ayarı varsa retry
 *     yenidoğan dispatch'lerin bazıları Suppressed('rate_limit_exceeded')
 *     olabilir. Bekleyip tekrar koştur veya --limit ile parça parça.
 *
 *   - Idempotency: emitEvent windowBucket kullanır. Eski Pending'in
 *     bucket'ı geride kaldı; yeni emit yeni bucket'a düşer, dedupe hit
 *     olmaz. Ama aynı script'i tekrar KISA SÜREDE koştururken idempotency
 *     tetiklenebilir (aynı windowBucket'ta yeni + retry). Güvenli aralık:
 *     script'in tamamlanmasını bekle.
 *
 *   - Cross-tenant guard: filter companyId üzerinden değil, dispatch'in
 *     kendi companyId'sinden gelir; --company flag'i sadece hangi
 *     tenant'a odaklandığını belirler.
 */

import { prisma } from '../server/db/client.js';
import { emitEvent } from '../server/db/notificationRepository.js';

const DEFAULT_LIMIT = 500;
const DEFAULT_MAX_AGE_DAYS = 30;

function parseArgs() {
  const args = { dryRun: false, company: null, caseId: null, limit: DEFAULT_LIMIT, maxAgeDays: DEFAULT_MAX_AGE_DAYS };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') args.dryRun = true;
    else if (a === '--company') args.company = argv[++i];
    else if (a === '--case') args.caseId = argv[++i];
    else if (a === '--limit') args.limit = Math.max(1, parseInt(argv[++i], 10) || DEFAULT_LIMIT);
    else if (a === '--max-age-days') args.maxAgeDays = Math.max(1, parseInt(argv[++i], 10) || DEFAULT_MAX_AGE_DAYS);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/retry-pending-notifications.js [--dry-run] [--company ID] [--case ID] [--limit 500] [--max-age-days 30]');
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const since = new Date(Date.now() - args.maxAgeDays * 86400_000);

  console.log('[retry] Configuration:');
  console.log(`  dry-run:       ${args.dryRun}`);
  console.log(`  company:       ${args.company ?? '(all)'}`);
  console.log(`  case:          ${args.caseId ?? '(all)'}`);
  console.log(`  limit:         ${args.limit}`);
  console.log(`  max-age-days:  ${args.maxAgeDays} (since ${since.toISOString()})`);
  console.log('');

  // ─── 1) Pending dispatch'leri filtrele ────────────────────────
  const where = {
    state: 'Pending',
    createdAt: { gte: since },
    // audienceIdentifier email DEĞİL → "manual" veya telefon numarası veya
    // "unresolved" vs. Bu tam olarak fix'in etki alanı.
    NOT: { audienceIdentifier: { contains: '@' } },
  };
  if (args.company) where.companyId = args.company;
  if (args.caseId) where.caseId = args.caseId;

  const pendings = await prisma.notificationDispatch.findMany({
    where,
    take: args.limit,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      caseId: true,
      companyId: true,
      event: true,
      ruleId: true,
      audienceType: true,
      audienceIdentifier: true,
      channel: true,
      ruleNameSnapshot: true,
      createdAt: true,
    },
  });

  console.log(`[retry] Toplam Pending (fix kapsamında): ${pendings.length}`);

  if (pendings.length === 0) {
    console.log('[retry] Retry\'a uygun kayıt yok. Çıkılıyor.');
    await prisma.$disconnect();
    return;
  }

  // ─── 2) HER Pending row için ayrı retry (Codex P1) ──────────
  // Pair (caseId, event) bazlı emit YAPMIYORUZ — o davranış
  // aynı case+event'in başka rule'larını da tetikler (idempotency
  // penceresi dolduysa duplicate email). Bunun yerine her Pending'in
  // kendi ruleId'sini targetRuleId olarak veriyoruz.
  console.log('');

  const stats = {
    total: pendings.length,
    suppressed_replacement: 0,
    kept_no_replacement: 0,
    kept_no_rule_snapshot: 0,
    error: 0,
    dryRunOnly: 0,
  };

  let idx = 0;
  for (const disp of pendings) {
    idx++;
    console.log(`── ${idx}/${pendings.length} — dispatch=${disp.id}`);
    console.log(`   case=${disp.caseId} event=${disp.event} ruleId=${disp.ruleId ?? '(null)'} ` +
      `rule="${disp.ruleNameSnapshot ?? ''}"`);
    console.log(`   audience=${disp.audienceType}=${disp.audienceIdentifier} createdAt=${disp.createdAt.toISOString()}`);

    if (!disp.ruleId) {
      // Rule ID snapshot'ı NULL — targetRuleId olmadan emit tüm rule'ları
      // tetikler ki bu Codex P1'in tam olarak yasakladığı davranış.
      console.log('   [skip] ruleId snapshot yok — targetRuleId olmadan retry GÜVENSİZ; KORUNDU.');
      stats.kept_no_rule_snapshot++;
      continue;
    }

    if (args.dryRun) {
      console.log('   [dry-run] emitEvent çağrılmayacak — bu row eligible.');
      stats.dryRunOnly++;
      continue;
    }

    // 3a) Codex P1: SADECE bu ruleId için emit — case+event'in
    //     başka rule'larına dokunmuyor.
    let emitted;
    try {
      emitted = await emitEvent({
        event: disp.event,
        caseId: disp.caseId,
        targetRuleId: disp.ruleId,
      });
    } catch (err) {
      console.error(`   emitEvent ERROR: ${err?.message ?? err}`);
      stats.error++;
      continue;
    }
    const summary = summarizeEmit(emitted);
    console.log(`   emitEvent: ${JSON.stringify(summary)}`);

    // 3b) Codex P2: replacement kontrolü
    //   - emitted.length === 0 → rule kaldırılmış / case artık eşleşmiyor
    //     / event artık kabul edilmiyor → eski Pending'i KORU (operatör
    //     kuyruğundan sinsi silme yapma).
    //   - emitted.length >= 1 → rule bilinçli çalıştı (Sent/Pending/
    //     Suppressed farkı emit yaparak audit'e yazıldı) → eski Pending'i
    //     Suppressed(superseded_by_retry) yap.
    const emittedCount = Array.isArray(emitted) ? emitted.length : 0;
    if (emittedCount === 0) {
      console.log('   → Kayıt KORUNDU (emit boş — rule kaldırılmış / case artık eşleşmiyor).');
      stats.kept_no_replacement++;
      continue;
    }

    const upd = await prisma.notificationDispatch.updateMany({
      where: { id: disp.id, state: 'Pending' },
      data: {
        state: 'Suppressed',
        suppressionReason: 'superseded_by_retry',
      },
    });
    if (upd.count > 0) {
      console.log('   → Suppressed (replacement üretildi).');
      stats.suppressed_replacement++;
    } else {
      console.log('   → Row artık Pending değil (concurrent update?) — dokunulmadı.');
    }
  }

  console.log('');
  console.log('[retry] ══ Özet ══');
  console.log(JSON.stringify(stats, null, 2));
  console.log(`[retry] Tamamlandı. ${args.dryRun ? '(dry-run — hiçbir şeye dokunulmadı)' : ''}`);
  await prisma.$disconnect();
}

function summarizeEmit(emitted) {
  if (!Array.isArray(emitted)) return { total: 0 };
  const by = { Sent: 0, Pending: 0, Suppressed: 0, Failed: 0, Other: 0 };
  for (const d of emitted) {
    const s = d?.state ?? 'Other';
    if (by[s] !== undefined) by[s]++;
    else by.Other++;
  }
  return { total: emitted.length, ...by };
}

main().catch((err) => {
  console.error('[retry] fatal:', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
