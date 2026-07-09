/**
 * smoke-mail-snapshot.js — 2026-07-09 (Evidence Preservation)
 *
 * "Gmail-benzeri mail snapshot" invariant'ı:
 *   Bir CaseEmail.bodyHtml'de `cid:X` varsa, AYNI CaseEmail altında X'i
 *   çözen bir CaseEmailAttachment satırı vardır.
 *
 * İki mod:
 *   1) Yapısal (her zaman): kod dikişleri yerinde mi (regex assert).
 *   2) SMOKE_DB=1: canlı DB taraması — her mail için body-cid ↔ kendi-ek
 *      eşleşme istatistiği. SNAPSHOT_SINCE sonrası yazılan OUTBOUND
 *      maillerde ihlal = FAIL (yeni kod invariant'ı sağlamalı). Öncesi =
 *      legacy, yalnız rapor (thread-fallback kurtarır).
 *      SNAPSHOT_SINCE default '2099-01-01' = kapı DEVRE DIŞI — snapshot
 *      compiler'ın çalıştığı andan (local test / deploy) itibaren gerçek
 *      tarih verilerek açılır: SNAPSHOT_SINCE=2026-07-15T10:00:00Z.
 *      (Deploy öncesi eski kodun yazdığı mailler invariant'ı sağlayamaz —
 *      kapıyı erken açmak yanlış-pozitif FAIL üretir.)
 *
 * Kural (feedback-smoke-skip-not-pass): SMOKE_DB istenmişken skip → exit 2.
 */
import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0, skip = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const sk = (n, why) => { skip++; console.log(`SKIP — ${n} (${why})`); };
const read = (p) => readFileSync(p, 'utf8');

const sender = read('server/lib/caseEmailSender.js');
const intake = read('server/lib/inboundMailIntake.js');
const reader = read('src/features/cases/components/MailThreadReader.tsx');
const commTab = read('src/features/cases/components/CommunicationTab.tsx');

console.log('── Yapısal: outbound snapshot compiler (PR-2) ──');
ok('1.1 quotedInline persist bloğu (giden mail KENDİ ek kaydını taşır)',
  /quoted inline snapshot persistence/.test(sender)
  && /quotedInline\.rows\.map/.test(sender)
  && /isInline: true/.test(sender));
ok('1.2 send sonucu snapshot meta (attached + skipped — sessiz kayıp yok)',
  /quotedInline: \{/.test(sender) && /skipped: quotedInline\.skipped/.test(sender));
ok('1.3 belirsiz cid re-attach edilmez (Codex #484/#488 guard)',
  /ambiguous\.add\(k\)/.test(sender) && /ambiguous_cid/.test(sender));
ok('1.4 çözülemeyen cid nedenli loglanır (not_found/file_missing)',
  /not_found_in_case/.test(sender) && /file_missing_on_storage/.test(sender));

console.log('── Yapısal: intake inline ayrımı + skip görünürlüğü (PR-3+4) ──');
ok('2.1 inline görsel CaseAttachment YAZILMAZ (yalnız storage+CaseEmailAttachment)',
  /isInlineImage && emailId/.test(intake) && /storedInline\.push/.test(intake));
ok('2.2 inline görsel cap tüketmez (kural: inline + cid + image/*)',
  /INLINE GÖRSEL ≠ GERÇEK EK/.test(intake)
  && /startsWith\('image\/'\)/.test(intake));
ok('2.3 skip kayıtlarında cid taşınır (render eşleşmesi için)',
  /\{ filename, cid, reason: 'too_large' \}/.test(intake)
  && /\{ filename, cid, reason: 'attachment_cap_reached' \}/.test(intake));
ok('2.4 skip aktivitesi yazılır — SESSİZ KAYIP YOK (insancıl sebep etiketi)',
  /FileUploadSkipped/.test(intake) && /E-postadaki .*alınamadı|alınamadı/.test(intake)
  && /25MB boyut sınırını aşıyor/.test(intake));

console.log('── Yapısal: reader UX (PR-3) ──');
ok('3.1 sebepli placeholder — kaynakta-bozuk cid sınıfı',
  /ekte gelmedi \(gönderici tarafında kaldı\)/.test(reader));
ok('3.2 sebepli placeholder — storage eksik dosya',
  /dosya sunucuda bulunamadı/.test(reader));
ok('3.3 gerçek ek ↔ gövde-içi görsel çip ayrımı',
  /gövde içi görseller:/.test(reader) && /realAtts/.test(reader) && /inlineAtts/.test(reader));
ok('3.4 thread-fallback LEGACY kurtarma olarak duruyor (önce kendi eki)',
  /threadCidIndex/.test(reader) && /threadCidIndex/.test(commTab));
ok('3.5 ölü reader zinciri silindi (tek cid mantığı — MailThreadReader)',
  !existsSync('src/features/cases/components/MailMessageCard.tsx')
  && !existsSync('src/features/cases/components/MailThread.tsx'));

if (process.env.SMOKE_DB === '1') {
  console.log('── DB: snapshot invariant taraması ──');
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const canon = (s) => (s ?? '').trim().replace(/^<|>$/g, '').toLowerCase();
    const cidRefs = (html) => {
      const set = new Set();
      const re = /<img[^>]+src=["']cid:([^"']+)["']/gi;
      for (let m; (m = re.exec(html ?? '')); ) { const c = canon(m[1]); if (c) set.add(c); }
      return [...set];
    };
    const since = new Date(process.env.SNAPSHOT_SINCE ?? '2099-01-01T00:00:00Z');
    const emails = await prisma.caseEmail.findMany({
      where: { bodyHtml: { contains: 'cid:' } },
      select: { id: true, caseId: true, direction: true, createdAt: true, bodyHtml: true },
    });
    const stats = {
      legacy: { mails: 0, refs: 0, own: 0, thread: 0, gone: 0 },
      fresh: { mails: 0, refs: 0, own: 0, thread: 0, gone: 0 },
    };
    let freshOutboundViolations = 0;
    const attCache = new Map(); // caseId → attachments
    for (const e of emails) {
      const refs = cidRefs(e.bodyHtml);
      if (!refs.length) continue;
      if (!attCache.has(e.caseId)) {
        attCache.set(e.caseId, await prisma.caseEmailAttachment.findMany({
          where: { email: { caseId: e.caseId } },
          select: { contentId: true, emailId: true },
        }));
      }
      const caseAtts = attCache.get(e.caseId);
      const own = new Set(caseAtts.filter((a) => a.emailId === e.id).map((a) => canon(a.contentId)));
      const thread = new Set(caseAtts.map((a) => canon(a.contentId)));
      const bucket = e.createdAt >= since ? stats.fresh : stats.legacy;
      bucket.mails++;
      for (const r of refs) {
        bucket.refs++;
        if (own.has(r)) bucket.own++;
        else if (thread.has(r)) {
          bucket.thread++;
          // Yeni OUTBOUND mail kendi kaydını taşımalıydı → ihlal
          if (e.createdAt >= since && e.direction === 'outbound') freshOutboundViolations++;
        } else bucket.gone++;
      }
    }
    const fmt = (b) => `${b.mails} mail · ${b.refs} ref → kendi:${b.own} thread:${b.thread} kaynakta-bozuk:${b.gone}`;
    console.log(`  legacy (< ${since.toISOString().slice(0, 10)}): ${fmt(stats.legacy)}`);
    console.log(`  yeni   (≥ ${since.toISOString().slice(0, 10)}): ${fmt(stats.fresh)}`);
    ok('4.1 YENİ outbound maillerde snapshot ihlali YOK (kendi kaydından çözülür)',
      freshOutboundViolations === 0);
    // Bilgi amaçlı — legacy thread-kurtarılabilir refler fallback ile görünür;
    // kaynakta-bozuk (gone) sınıfı hiçbir kodla kurtarılamaz (placeholder doğru).
    await prisma.$disconnect();
  } catch (e) {
    fail++; console.log(`FAIL — DB taraması: ${e.message}`);
  }
} else {
  sk('DB invariant taraması', 'SMOKE_DB!=1');
}

console.log(`\nPASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
process.exit(fail ? 1 : (skip && process.env.SMOKE_DB === '1' && !process.env.ALLOW_SKIP ? 2 : 0));
