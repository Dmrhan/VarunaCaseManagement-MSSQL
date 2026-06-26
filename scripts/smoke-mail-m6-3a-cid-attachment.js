#!/usr/bin/env node
/**
 * Mail M6.3a — Intake CaseEmailAttachment persistence (cid render için
 * gerekli) ve sanitizer kontratı smoke.
 *
 * Senaryolar:
 *  (1) Inbound mail with cid:image → CaseEmail satırı + CaseEmailAttachment
 *      satırı (contentId + isInline)
 *  (2) Inbound mail with plain attachment (cid'siz) → CaseEmailAttachment
 *      (contentId=null, isInline=false)
 *  (3) sanitizer img'e src/alt izni var; script/iframe drop
 */

import { prisma } from '../server/db/client.js';
import { intakeInboundEmail } from '../server/lib/inboundMailIntake.js';
import { parseInboundEml } from '../server/lib/inboundMailParser.js';
import { sanitizeIncomingEmailHtml } from '../server/lib/htmlSanitizer.js';

const TENANT = '__m6-3a-tenant__';
const TENANT_NAME = 'M6.3a Smoke';
const SYSTEM_ACTOR = Object.freeze({
  userId: null, personId: null, fullName: 'M6.3a Bot',
  email: null, role: null, displayName: 'system:m6-3a-test',
});

let pass = 0; let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTruthy(name, actual) {
  if (actual) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — falsy`); }
}

async function setup() {
  await prisma.company.upsert({
    where: { id: TENANT }, update: {},
    create: { id: TENANT, name: TENANT_NAME, isActive: true },
  });
  await prisma.caseEmailAttachment.deleteMany({ where: { email: { companyId: TENANT } } }).catch(() => {});
  await prisma.caseEmail.deleteMany({ where: { companyId: TENANT } });
  const oldCases = await prisma.case.findMany({ where: { companyId: TENANT }, select: { id: true } });
  const ids = oldCases.map((c) => c.id);
  if (ids.length) {
    await prisma.caseActivity.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.caseNote.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.caseAttachment.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.case.deleteMany({ where: { id: { in: ids } } });
  }
}

async function cleanup() {
  await prisma.caseEmail.deleteMany({ where: { companyId: TENANT } });
  const oldCases = await prisma.case.findMany({ where: { companyId: TENANT }, select: { id: true } });
  const ids = oldCases.map((c) => c.id);
  if (ids.length) {
    await prisma.caseActivity.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.caseNote.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.caseAttachment.deleteMany({ where: { caseId: { in: ids } } });
    await prisma.case.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.company.delete({ where: { id: TENANT } }).catch(() => {});
}

// Multipart MIME ile cid:image içeren mail kur (1x1 PNG)
async function inboundWithCid() {
  // 1x1 transparent PNG (base64)
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  const eml = [
    `From: "Test" <test@firm.local>`,
    'To: support@varuna.com',
    'Subject: cid test',
    'Date: Sat, 27 Jun 2026 09:00:00 +0300',
    'Message-ID: <cid-test-' + Date.now() + '@m6-3a.local>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary="boundary-cid"',
    '',
    '--boundary-cid',
    'Content-Type: text/html; charset=UTF-8',
    '',
    '<p>Inline görsel: <img src="cid:logo123@example.com" alt="logo"></p>',
    '',
    '--boundary-cid',
    'Content-Type: image/png',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <logo123@example.com>',
    'Content-Disposition: inline; filename="logo.png"',
    '',
    PNG_B64,
    '',
    '--boundary-cid--',
    '',
  ].join('\r\n');

  const parsed = await parseInboundEml(eml);
  if (!parsed.ok) throw new Error('parse fail: ' + JSON.stringify(parsed.error));
  return intakeInboundEmail({
    parsed: parsed.data,
    companyId: TENANT,
    companyName: TENANT_NAME,
    actor: SYSTEM_ACTOR,
  });
}

(async () => {
  try {
    await setup();

    console.log('\n=== (1) Inbound with cid:image → CaseEmailAttachment(contentId, isInline) ===');
    const r = await inboundWithCid();
    expect('intake ok', r.ok, true);
    const emailId = r.caseEmail?.id;
    expectTruthy('caseEmail.id', !!emailId);

    const emailAttachments = await prisma.caseEmailAttachment.findMany({
      where: { emailId },
    });
    expect('1 CaseEmailAttachment', emailAttachments.length, 1);
    const ea = emailAttachments[0];
    expectTruthy('contentId set (cid)', !!ea?.contentId);
    expect('contentId logo123 içerir', ea.contentId.includes('logo123'), true);
    expect('isInline=true', ea.isInline, true);
    expect('fileName = logo.png', ea.fileName, 'logo.png');

    console.log('\n=== (2) Sanitizer: img izinli, script/iframe drop ===');
    const out = sanitizeIncomingEmailHtml(
      '<p>Hi <img src="cid:foo" alt="x"><script>bad()</script><iframe src="evil"></iframe></p>'
    );
    expect('<img> korundu', out.includes('<img'), true);
    expect('<script> drop', out.includes('<script>'), false);
    expect('<iframe> drop', out.includes('<iframe>'), false);
    // cid scheme allowed
    expectTruthy('cid: src korundu', /src="cid:foo"/.test(out));
  } catch (err) {
    console.error('\n[test] HATA:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    try { await cleanup(); } catch (e) { console.error('cleanup hata:', e.message); }
    await prisma.$disconnect();
    console.log('\n────────────────────────────────────────────────────────');
    console.log(`PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
