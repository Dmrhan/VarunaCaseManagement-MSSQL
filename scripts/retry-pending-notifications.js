/**
 * retry-pending-notifications.js
 *
 * 2026-07-01 sistemsel düzeltmesi sonrası — Pending kalmış dispatch'leri
 * yeni kural kanalı önceliği + requester fallback ile TEKRAR TETİKLE.
 *
 * ═══ Mantık ═══
 *
 * 1. Filtre: state='Pending' AND
 *       audienceIdentifier NOT LIKE '%@%'   (email değil → "manual" veya
 *                                             telefon numarası)
 *    Bu tam olarak fix'in çözdüğü senaryo: email göndermek için
 *    yapılandırılmış ama identifier email olarak çözünememiş.
 *
 * 2. (caseId, event) tekilleştir — emitEvent bir case+event için TÜM
 *    aktif kuralları tarar. Aynı case'te 3 rule Pending olsa bile tek
 *    emit yeterli (yeni fix hepsini yeniden çalıştırır).
 *
 * 3. Eski Pending kayıtlarını `state='Suppressed', suppressionReason=
 *    'superseded_by_retry'` yap. Kayıp veri değil; audit korunur.
 *
 * 4. emitEvent({ event, caseId }) çağır → yeni resolver kural kanalını
 *    öncelikli kullanır → email adresi bulursa Sent, bulamazsa hâlâ
 *    Pending kalır (kullanıcı elden çözer).
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

  // ─── 2) (caseId, event) tekilleştir ──────────────────────────
  const pairs = new Map(); // key: caseId:event → { caseId, event, companyId, dispatchIds[], detail[] }
  for (const d of pendings) {
    const key = `${d.caseId}:${d.event}`;
    if (!pairs.has(key)) {
      pairs.set(key, {
        caseId: d.caseId,
        event: d.event,
        companyId: d.companyId,
        dispatchIds: [],
        detail: [],
      });
    }
    const pair = pairs.get(key);
    pair.dispatchIds.push(d.id);
    pair.detail.push({
      id: d.id,
      audience: `${d.audienceType}=${d.audienceIdentifier}`,
      rule: d.ruleNameSnapshot,
      created: d.createdAt.toISOString(),
    });
  }

  console.log(`[retry] Tekil (case, event) çifti: ${pairs.size}`);
  console.log('');

  // ─── 3) Rapor: her çift için ne yapılacak ────────────────────
  let idx = 0;
  for (const pair of pairs.values()) {
    idx++;
    console.log(`── ${idx}/${pairs.size} — case=${pair.caseId} event=${pair.event} ──`);
    console.log(`   Bu retry ${pair.dispatchIds.length} Pending kaydını superseded_by_retry yapacak:`);
    for (const d of pair.detail) {
      console.log(`     · ${d.id}  ${d.audience}  rule="${d.rule}"  createdAt=${d.created}`);
    }
    if (args.dryRun) {
      console.log('   [dry-run] emitEvent çağrılmayacak.');
      continue;
    }

    // 4a) Eski Pending'leri Suppressed'a al (audit korundu)
    const suppressResult = await prisma.notificationDispatch.updateMany({
      where: { id: { in: pair.dispatchIds }, state: 'Pending' },
      data: {
        state: 'Suppressed',
        suppressionReason: 'superseded_by_retry',
      },
    });
    console.log(`   Suppressed: ${suppressResult.count}`);

    // 4b) Yeni emit — resolver artık kural kanalını öncelikli kullanıyor
    try {
      const emitted = await emitEvent({ event: pair.event, caseId: pair.caseId });
      const summary = summarizeEmit(emitted);
      console.log(`   emitEvent: ${JSON.stringify(summary)}`);
    } catch (err) {
      console.error(`   emitEvent ERROR: ${err?.message ?? err}`);
    }
  }

  console.log('');
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
