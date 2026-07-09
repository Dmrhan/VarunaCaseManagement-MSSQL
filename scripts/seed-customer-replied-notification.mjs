/**
 * seed-customer-replied-notification.mjs — 2026-07-09
 *
 * "Müşteri yanıtladı → üstlenen ajana e-posta" bildirimi için tenant
 * şablonu + kuralı (idempotent; key/name üzerinden). Kullanım:
 *
 *   node scripts/seed-customer-replied-notification.mjs COMP-UNIVERA
 *
 * Notlar:
 *  - Kural mode=Active + channel=Email + audience=assignee. Emit yalnız
 *    YENİ intake kodunda (customer_replied) olduğundan, eski kod koşan
 *    ortamda bu kayıtlar ETKİSİZDİR (deploy ile devreye girer).
 *  - Şablon isCustomerFacing=false → [VK] token/threading/CaseEmail append
 *    YOK (iç bildirim); subject zaten [{{case.number}}] taşır — ajan
 *    yanıtlarsa intake token'ı parse eder, iç-adres guard'ı döngüyü keser.
 *  - {{case.url}} için APP_PUBLIC_BASE_URL env'i gerekir (yoksa satır boş).
 *  - suppressDuplicateWithinMinutes=5 → müşteri burst'ünde tek mail.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const companyId = process.argv[2];
if (!companyId) {
  console.error('Kullanım: node scripts/seed-customer-replied-notification.mjs <companyId>');
  process.exit(1);
}

const TEMPLATE_KEY = 'customer_replied_assignee';
const RULE_NAME = 'Müşteri yanıtı → üstlenen ajan (e-posta)';

const subjectTemplate = '[{{case.number}}] Müşteri yanıt verdi — {{case.title}}';
const bodyTemplate = [
  'Merhaba,',
  '',
  '{{requester.name}} ({{requester.email}}), üzerinize atanmış [{{case.number}}] numaralı vakaya e-posta ile yanıt verdi.',
  '',
  'Vaka: {{case.title}}',
  'Vakayı açmak için: {{case.url}}',
  '',
  'Bu bildirim, vaka size atanmış olduğu için otomatik gönderildi.',
].join('\n');

const co = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
if (!co) { console.error(`Şirket bulunamadı: ${companyId}`); process.exit(1); }

// ── Şablon (idempotent: companyId+key) ──
let tpl = await prisma.notificationTemplate.findFirst({
  where: { companyId, key: TEMPLATE_KEY },
});
if (tpl) {
  console.log(`Şablon zaten var: ${tpl.id} (${TEMPLATE_KEY}) — dokunulmadı`);
} else {
  tpl = await prisma.notificationTemplate.create({
    data: {
      companyId,
      key: TEMPLATE_KEY,
      name: 'Müşteri Yanıtladı — Ajan Bildirimi',
      description: 'Müşteri mevcut vakaya e-postayla yanıt verdiğinde üstlenen ajana giden iç bildirim.',
      language: 'tr',
      subjectTemplate,
      bodyTemplate,
      format: 'plain',
      isCustomerFacing: false,
      requiredVariables: JSON.stringify(['case.number', 'case.title']),
      isActive: true,
    },
  });
  console.log(`Şablon oluşturuldu: ${tpl.id}`);
}

// ── Kural (idempotent: companyId+event+name) ──
const existingRule = await prisma.notificationRule.findFirst({
  where: { companyId, event: 'customer_replied', name: RULE_NAME },
});
if (existingRule) {
  console.log(`Kural zaten var: ${existingRule.id} — dokunulmadı`);
} else {
  const rule = await prisma.notificationRule.create({
    data: {
      companyId,
      name: RULE_NAME,
      description: 'Müşteri vakaya e-postayla yanıt verince üstlenen ajana e-posta (n4b paritesi). İç adres göndericide ve atanmamış vakada tetiklenmez (intake guard).',
      isActive: true,
      event: 'customer_replied',
      conditions: '{}',
      isMatchAll: true,
      audience: JSON.stringify([{ type: 'assignee' }]),
      templateId: tpl.id,
      channel: 'Email',
      mode: 'Active',
      suppressDuplicateWithinMinutes: 5,
    },
  });
  console.log(`Kural oluşturuldu: ${rule.id} (Active/Email/assignee)`);
}

console.log(`\n✓ ${co.name} için customer_replied bildirimi hazır (deploy ile devreye girer).`);
await prisma.$disconnect();
