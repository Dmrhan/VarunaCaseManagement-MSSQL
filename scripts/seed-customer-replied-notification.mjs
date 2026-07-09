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

// HTML gövde — Varuna logolu, logo çelik-mavi paleti; mail istemcisi güvenli
// (tablo + inline stil). {{vars}} emit'te html-escape edilir (müşteri metni
// güvenli). {{app.logoUrl}} + {{case.url}} APP_PUBLIC_BASE_URL gerektirir.
const bodyTemplate = `<div style="background:#eef2f6;padding:28px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#ffffff;border:1px solid #dbe3ec;border-radius:14px;">
<tr><td style="background:#141d31;padding:22px 30px;border-radius:14px 14px 0 0;" align="center">
<img src="{{app.logoUrl}}" alt="VARUNA" width="52" height="52" style="display:block;margin:0 auto 8px auto;border:0;outline:none;">
<div style="font-size:16px;font-weight:700;color:#ffffff;letter-spacing:3px;">VARUNA</div>
<div style="font-size:10px;font-weight:600;color:#8ea3c4;letter-spacing:1.5px;padding-top:4px;line-height:1.5;">AI-ASSISTED<br>CUSTOMER SUCCESS MANAGEMENT</div>
</td></tr>
<tr><td style="height:3px;background:#3f6fa3;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:24px 30px 0 30px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="46" valign="top"><div style="width:46px;height:46px;border-radius:50%;background:#eaf1f8;text-align:center;line-height:46px;font-size:21px;">💬</div></td>
<td style="padding-left:14px;">
<div style="font-size:19px;font-weight:700;color:#141d31;line-height:1.3;">Müşteri yanıt verdi</div>
<div style="font-size:14px;color:#64748b;padding-top:3px;">Üstlendiğiniz bir vakaya yeni e-posta geldi.</div>
</td></tr></table>
</td></tr>
<tr><td style="padding:22px 30px 0 30px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f9fc;border:1px solid #e2eaf2;border-radius:10px;"><tr><td style="padding:16px 18px;">
<div style="font-size:12px;color:#94a9c4;text-transform:uppercase;letter-spacing:.5px;">Vaka</div>
<div style="padding-top:5px;"><span style="display:inline-block;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:13px;font-weight:700;color:#2f5580;background:#eaf1f8;padding:2px 8px;border-radius:6px;">{{case.number}}</span><span style="font-size:15px;font-weight:600;color:#141d31;padding-left:8px;">{{case.title}}</span></div>
<div style="height:13px;font-size:0;line-height:0;">&nbsp;</div>
<div style="font-size:12px;color:#94a9c4;text-transform:uppercase;letter-spacing:.5px;">Yanıtlayan</div>
<div style="padding-top:5px;font-size:14px;color:#475569;"><span style="font-weight:600;color:#141d31;">{{requester.name}}</span> <span style="color:#64748b;">&lt;{{requester.email}}&gt;</span></div>
</td></tr></table>
</td></tr>
<tr><td style="padding:16px 30px 0 30px;">
<div style="font-size:12px;color:#94a9c4;text-transform:uppercase;letter-spacing:.5px;padding-bottom:6px;">Mesaj</div>
<div style="border-left:3px solid #3f6fa3;background:#f8fafc;padding:12px 16px;font-size:14px;color:#334155;line-height:1.6;font-style:italic;">{{case.lastCustomerMessage}}</div>
</td></tr>
<tr><td style="padding:22px 30px 4px 30px;" align="center">
<a href="{{case.url}}" style="display:inline-block;background:#3f6fa3;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:9px;">Vakayı aç →</a>
</td></tr>
<tr><td style="padding:22px 30px 24px 30px;">
<div style="border-top:1px solid #eef2f6;padding-top:16px;font-size:12px;color:#94a9c4;line-height:1.6;">Bu bildirim, vaka size atanmış olduğu için otomatik gönderildi.<br>Varuna · AI-Assisted Customer Success Management</div>
</td></tr>
</table>
</div>
</div>`;

const co = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
if (!co) { console.error(`Şirket bulunamadı: ${companyId}`); process.exit(1); }

// ── Şablon (UPSERT: companyId+key) — script deklaratif kaynak; her koşuda
//    şablon içeriği (subject/body/format) senkronlanır. Deploy'a kadar
//    tetiklenmediğinden canlı güncelleme güvenli. ──
const tplData = {
  name: 'Müşteri Yanıtladı — Ajan Bildirimi',
  description: 'Müşteri mevcut vakaya e-postayla yanıt verdiğinde üstlenen ajana giden iç bildirim (HTML).',
  language: 'tr',
  subjectTemplate,
  bodyTemplate,
  format: 'html',
  isCustomerFacing: false,
  requiredVariables: JSON.stringify(['case.number', 'case.title']),
  isActive: true,
};
let tpl = await prisma.notificationTemplate.findFirst({
  where: { companyId, key: TEMPLATE_KEY },
});
if (tpl) {
  tpl = await prisma.notificationTemplate.update({ where: { id: tpl.id }, data: tplData });
  console.log(`Şablon güncellendi (HTML): ${tpl.id} (${TEMPLATE_KEY})`);
} else {
  tpl = await prisma.notificationTemplate.create({ data: { companyId, key: TEMPLATE_KEY, ...tplData } });
  console.log(`Şablon oluşturuldu (HTML): ${tpl.id}`);
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
