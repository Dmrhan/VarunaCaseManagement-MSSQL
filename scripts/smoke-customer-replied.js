/**
 * smoke-customer-replied.js — 2026-07-09
 * "Müşteri yanıtladı → üstlenen ajana e-posta" bildirimi dikişleri.
 * Yapısal + SMOKE_DB=1 (kural/şablon seed kontrolü, default COMP-UNIVERA).
 */
import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0, skip = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const sk = (n, why) => { skip++; console.log(`SKIP — ${n} (${why})`); };
const read = (p) => readFileSync(p, 'utf8');

const repo = read('server/db/notificationRepository.js');
const intake = read('server/lib/inboundMailIntake.js');
const app = read('src/App.tsx');

console.log('── Event + değişken ──');
ok('1.1 customer_replied ALLOWED_EVENTS içinde',
  /'customer_replied',/.test(repo));
ok('1.2 case.url değişkeni (katalog + buildTemplateVars, APP_PUBLIC_BASE_URL)',
  /'case\.url',/.test(repo)
  && /APP_PUBLIC_BASE_URL/.test(repo)
  && /\?case=\$\{caseRow\.id\}/.test(repo));

console.log('── Intake emit (2 yol) + guard\'lar ──');
ok('2.1 İKİ existing-case yolunda emit (subject-token + header-threading)',
  (intake.match(/event: 'customer_replied', caseId: existing\.id, triggerInboundEmailId: inboundEmail\.id/g) ?? []).length === 2);
ok('2.2 iç-adres döngü guard\'ı FAIL-CLOSED (OOO/auto-reply döngüsü kesilir)',
  (intake.match(/let replyFromInternal = true;/g) ?? []).length === 2
  && /replyFromInternal = await isInternalAddress\(parsed\.from\.email, companyId\)/.test(intake));
ok('2.3 atanmamış VEYA e-postasız üstlenen → emit YOK (Codex #496 P2)',
  (intake.match(/assignedPerson: \{ select: \{ email: true \} \}/g) ?? []).length === 2
  && (intake.match(/if \(c\?\.assignedPerson\?\.email\)/g) ?? []).length === 2);
ok('2.4 emit yalnız deduped DEĞİLKEN (mükerrer mailde bildirim yok)',
  // her iki emit bloğu !inboundEmail.deduped bloğunun içinde
  /if \(!inboundEmail\.deduped\) \{[\s\S]{0,3500}customer_replied[\s\S]{0,15000}if \(!inboundEmail\.deduped\) \{[\s\S]{0,3500}customer_replied/.test(intake));

ok('2.5 iç bildirim outbound CaseEmail YAZILMAZ (pendingCustomerReply korunur — Codex #496 P1)',
  /if \(isCustomerFacing\) try \{/.test(repo));

console.log('── FE deep-link ──');
ok('3.1 App.tsx ?case=<id> parametresini login sonrası açar + URL temizler',
  /params\.get\('case'\)/.test(app)
  && /openCase\(caseId\)/.test(app)
  && /replaceState/.test(app));

console.log('── HTML mail desteği (motor) ──');
ok('h.1 emit HTML formatında gövde değişkenlerini escape eder',
  /rule\.template\.format === 'html'/.test(repo)
  && /htmlEscape: isHtmlTemplate/.test(repo));
ok('h.2 executor HTML gövde + text fallback gönderir (format templateId\'den)',
  /isHtmlBody/.test(repo) && /html: dispatch\.snapshotBody, text: stripHtmlToText/.test(repo));
ok('h.3 app.logoUrl + case.lastCustomerMessage değişkenleri tanımlı',
  /'app\.logoUrl'/.test(repo) && /'case\.lastCustomerMessage'/.test(repo)
  && /varuna-logo\.png/.test(repo));
ok('h.4 emit önizlemeyi TETİKLEYEN mailden çeker (Codex #498 P2: id + createdAt fallback)',
  /triggerInboundEmailId/.test(repo)
  && /buildMessagePreview\(triggerInbound\.bodyText/.test(repo)
  && /orderBy: \{ createdAt: 'desc' \}/.test(repo));
ok('h.5 seed HTML format + logo + mesaj kutusu + upsert',
  /format: 'html'/.test(read('scripts/seed-customer-replied-notification.mjs'))
  && /\{\{app\.logoUrl\}\}/.test(read('scripts/seed-customer-replied-notification.mjs'))
  && /\{\{case\.lastCustomerMessage\}\}/.test(read('scripts/seed-customer-replied-notification.mjs'))
  && /notificationTemplate\.update/.test(read('scripts/seed-customer-replied-notification.mjs')));

console.log('── Seed ──');
ok('4.1 seed script mevcut (Active/Email/assignee + burst guard)',
  existsSync('scripts/seed-customer-replied-notification.mjs')
  && /mode: 'Active'/.test(read('scripts/seed-customer-replied-notification.mjs'))
  && /type: 'assignee'/.test(read('scripts/seed-customer-replied-notification.mjs'))
  && /suppressDuplicateWithinMinutes: 5/.test(read('scripts/seed-customer-replied-notification.mjs'))
  && /isCustomerFacing: false/.test(read('scripts/seed-customer-replied-notification.mjs')));

if (process.env.SMOKE_DB === '1') {
  console.log('── DB: kural/şablon seed kontrolü ──');
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const companyId = process.env.SMOKE_COMPANY ?? 'COMP-UNIVERA';
    const tpl = await prisma.notificationTemplate.findFirst({
      where: { companyId, key: 'customer_replied_assignee', isActive: true },
      select: { id: true, subjectTemplate: true, format: true, bodyTemplate: true },
    });
    ok('5.1 şablon seed edilmiş + HTML format + subject [{{case.number}}] + logo/mesaj',
      !!tpl && tpl.format === 'html'
      && /\[\{\{case\.number\}\}\]/.test(tpl.subjectTemplate)
      && /\{\{app\.logoUrl\}\}/.test(tpl.bodyTemplate)
      && /\{\{case\.lastCustomerMessage\}\}/.test(tpl.bodyTemplate));
    const rule = await prisma.notificationRule.findFirst({
      where: { companyId, event: 'customer_replied', isActive: true },
      select: { channel: true, mode: true, audience: true },
    });
    ok('5.2 kural seed edilmiş (Active/Email/assignee)',
      !!rule && rule.channel === 'Email' && rule.mode === 'Active'
      && /assignee/.test(rule.audience));
    await prisma.$disconnect();
  } catch (e) { fail++; console.log(`FAIL — DB: ${e.message}`); }
} else {
  sk('DB seed kontrolü', 'SMOKE_DB!=1');
}

console.log(`\nPASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
process.exit(fail ? 1 : (skip && process.env.SMOKE_DB === '1' && !process.env.ALLOW_SKIP ? 2 : 0));
