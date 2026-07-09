/**
 * seed-univera-customer-mails.mjs — 2026-07-09
 *
 * Müşteriye giden 3 yaşam-döngüsü bildirimini ŞIK HTML'e yükseltir:
 *   case_created   → "Talebiniz alındı" (ACK)      key=customer_ack_received
 *   status_changed → "Durum güncellendi"           key=customer_status_changed
 *   case_closed    → "Talebiniz çözüldü"           key=customer_resolved
 *
 * Kullanım:
 *   node scripts/seed-univera-customer-mails.mjs COMP-UNIVERA
 *   node scripts/seed-univera-customer-mails.mjs COMP-UNIVERA --activate-rules
 *
 * Tasarım/marka:
 *  - Univera logosu + logo renkleri (arduvaz #34454f, kızıl #b93042, mor
 *    #4d008c; çözüm için semantik yeşil #2f8f6b). Logo {{company.logoUrl}}
 *    → univera-logo.png (APP_PUBLIC_BASE_URL gerekir; posta istemcileri
 *    SVG'yi engellediğinden PNG). app.logoUrl = Varuna (İÇ mail) — AYRI.
 *  - Bunlar tek-yönlü BİLGİLENDİRME mailleridir: "bu e-postayı yanıtlamayınız,
 *    iletişimi kendi yazışmanız üzerinden sürdürün" (müşteri kararı).
 *  - Müşteri Varuna'ya giriş yapamaz → "vakayı aç" butonu YOK.
 *
 * Dikiş güvenliği:
 *  - Şablonlar (companyId+key) ile UPSERT edilir; mevcut Univera şablonları
 *    yerinde HTML'e döner (kural→templateId bağı korunur, repoint yok).
 *  - {{vars}} emit'te html-escape edilir (format='html' → müşteri metni
 *    HTML enjekte edemez). Değişkenler buildTemplateVars'tan gelir.
 *  - Kurallar VARSAYILAN OLARAK ETKİNLEŞTİRİLMEZ. Canlıda 3 kural da KAPALI;
 *    müşteriye mail gitmeye başlaması bilinçli bir go-live adımıdır
 *    (--activate-rules veya admin UI). Var olan kuralın isActive'ine flag
 *    olmadan DOKUNULMAZ.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const companyId = args.find((a) => !a.startsWith('--')) ?? 'COMP-UNIVERA';
const activateRules = args.includes('--activate-rules');

// ── Ortak parçalar ───────────────────────────────────────────────────
const LOGO = `<img src="{{company.logoUrl}}" alt="Univera" width="152" height="79" style="display:block;margin:0 auto;border:0;outline:none;">`;

const groundOpen = `<div style="background:#eef1f4;padding:28px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><div style="max-width:560px;margin:0 auto;">`;
const groundClose = `</div></div>`;

const greeting = `<tr><td style="padding:26px 30px 0;"><div style="font-size:15px;color:#34454f;">Sayın <b style="color:#20303a;">{{requester.name}}</b>,</div></td></tr>`;

const footer = `<tr><td style="padding:24px 30px 26px;"><div style="border-top:1px solid #eef1f4;padding-top:15px;font-size:12px;color:#95a2af;line-height:1.6;">Bu otomatik bir bilgilendirme mesajıdır.<br>Univera Destek · destek@univera.com.tr</div></td></tr>`;

// accent: üst şerit rengi | disc bg | ikon | mono-badge renk/bg
function header(stripe) {
  return `<tr><td style="height:4px;background:${stripe};font-size:0;line-height:0;border-radius:14px 14px 0 0;">&nbsp;</td></tr>`
    + `<tr><td style="padding:24px 30px 20px;border-bottom:1px solid #eef1f4;" align="center">${LOGO}</td></tr>`;
}
function hero(discBg, icon, iconColor, title, subtitle) {
  const iconStyle = iconColor ? `color:${iconColor};` : '';
  return `<tr><td style="padding:18px 30px 0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>`
    + `<td width="48" valign="top"><div style="width:48px;height:48px;border-radius:12px;background:${discBg};text-align:center;line-height:48px;font-size:22px;${iconStyle}">${icon}</div></td>`
    + `<td style="padding-left:15px;"><div style="font-size:20px;font-weight:700;color:#20303a;line-height:1.25;">${title}</div>`
    + `<div style="font-size:14px;color:#6b7885;padding-top:4px;line-height:1.5;">${subtitle}</div></td>`
    + `</tr></table></td></tr>`;
}
function note(body) {
  return `<tr><td style="padding:20px 30px 0;"><div style="font-size:13.5px;color:#5c6a76;line-height:1.65;">${body}</div></td></tr>`;
}
const cardOpen = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#ffffff;border:1px solid #e0e5ea;border-radius:14px;">`;
const cardClose = `</table>`;
const label = (t) => `<div style="font-size:11px;color:#95a2af;text-transform:uppercase;letter-spacing:.6px;">${t}</div>`;
const spacer = `<div style="height:14px;font-size:0;line-height:0;">&nbsp;</div>`;

// ── 1) ACK (case_created) — kızıl ───────────────────────────────────
const ackBody = groundOpen + cardOpen
  + header('#b93042')
  + greeting
  + hero('#fbeaed', '📨', '', 'Talebiniz alındı', 'Destek ekibimiz talebinizi aldı ve en kısa sürede dönüş yapacak.')
  + `<tr><td style="padding:22px 30px 0;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f8fa;border:1px solid #e5eaef;border-left:3px solid #b93042;border-radius:10px;"><tr><td style="padding:16px 18px;">`
    + label('Talep No')
    + `<div style="padding-top:5px;"><span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:13px;font-weight:700;color:#8a2436;background:#fbeaed;padding:2px 9px;border-radius:6px;">{{case.number}}</span></div>`
    + spacer + label('Konu')
    + `<div style="padding-top:5px;font-size:15px;font-weight:600;color:#20303a;line-height:1.4;">{{case.title}}</div>`
    + spacer + label('Öncelik')
    + `<div style="padding-top:6px;"><span style="display:inline-block;font-size:12px;font-weight:600;color:#8a2436;background:#fbeaed;border-radius:999px;padding:3px 11px;">{{case.priority}}</span></div>`
  + `</td></tr></table></td></tr>`
  + note('Talebinizle ilgili gelişmeleri e-posta ile ileteceğiz. Bu otomatik bir bilgilendirme mesajıdır; <b style="color:#34454f;">lütfen bu e-postayı yanıtlamayınız</b>. Eklemek istedikleriniz olursa <b style="color:#34454f;">bize ulaştığınız e-posta yazışması üzerinden</b> iletebilirsiniz.')
  + footer + cardClose + groundClose;

// ── 2) Durum güncellendi (status_changed) — mor ─────────────────────
const statusBody = groundOpen + cardOpen
  + header('#4d008c')
  + greeting
  + hero('#f0e6f6', '🔄', '', 'Talebinizin durumu güncellendi', 'Talebiniz üzerinde çalışıyoruz — güncel durum aşağıda.')
  + `<tr><td style="padding:22px 30px 0;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f8fa;border:1px solid #e5eaef;border-left:3px solid #4d008c;border-radius:10px;"><tr><td style="padding:16px 18px;">`
    + label('Talep No')
    + `<div style="padding-top:5px;"><span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:13px;font-weight:700;color:#4d008c;background:#f0e6f6;padding:2px 9px;border-radius:6px;">{{case.number}}</span><span style="font-size:14px;font-weight:600;color:#20303a;padding-left:9px;">{{case.title}}</span></div>`
    + `<div style="height:15px;font-size:0;line-height:0;">&nbsp;</div>` + label('Yeni durum')
    + `<div style="padding-top:7px;"><span style="display:inline-block;font-size:13px;font-weight:700;color:#ffffff;background:#4d008c;border-radius:999px;padding:5px 15px;">{{case.status}}</span></div>`
  + `</td></tr></table></td></tr>`
  + note('Süreç ilerledikçe sizi bilgilendirmeye devam edeceğiz. Bu otomatik bir bilgilendirme mesajıdır; <b style="color:#34454f;">lütfen bu e-postayı yanıtlamayınız</b>. Talebinizle ilgili iletişimi <b style="color:#34454f;">bize ulaştığınız e-posta yazışması üzerinden</b> sürdürebilirsiniz.')
  + footer + cardClose + groundClose;

// ── 3) Talebiniz çözüldü (case_closed) — yeşil ──────────────────────
const resolvedBody = groundOpen + cardOpen
  + header('#2f8f6b')
  + greeting
  + hero('#e7f4ee', '✓', '#2f8f6b', 'Talebiniz çözüldü', 'Destek talebiniz çözüme kavuştu. Detaylar aşağıda.')
  + `<tr><td style="padding:22px 30px 0;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f8fa;border:1px solid #e5eaef;border-left:3px solid #2f8f6b;border-radius:10px;"><tr><td style="padding:16px 18px;">`
    + label('Talep No')
    + `<div style="padding-top:5px;"><span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:13px;font-weight:700;color:#22795a;background:#e7f4ee;padding:2px 9px;border-radius:6px;">{{case.number}}</span><span style="font-size:14px;font-weight:600;color:#20303a;padding-left:9px;">{{case.title}}</span></div>`
    + `<div style="height:15px;font-size:0;line-height:0;">&nbsp;</div>` + label('Durum')
    + `<div style="padding-top:7px;"><span style="display:inline-block;font-size:13px;font-weight:700;color:#ffffff;background:#2f8f6b;border-radius:999px;padding:5px 15px;">✓ Çözüldü</span></div>`
  + `</td></tr></table></td></tr>`
  + `<tr><td style="padding:18px 30px 0;">${label('Çözüm açıklaması')}<div style="border-left:3px solid #cfe4d9;background:#f4faf7;padding:13px 16px;font-size:14px;color:#33463d;line-height:1.65;border-radius:0 8px 8px 0;margin-top:7px;">{{resolution.customerMessage}}</div></td></tr>`
  + note('Bu otomatik bir bilgilendirme mesajıdır; <b style="color:#34454f;">lütfen bu e-postayı yanıtlamayınız</b>. Sorununuz devam ediyorsa <b style="color:#34454f;">bize ulaştığınız e-posta yazışması üzerinden</b> bize yazabilirsiniz. Bize ulaştığınız için teşekkür ederiz.')
  + footer + cardClose + groundClose;

// ── Şablon konfigürasyonları ─────────────────────────────────────────
const TEMPLATES = [
  {
    event: 'case_created',
    key: 'customer_ack_received',
    name: 'Müşteri — Talebiniz alındı (ACK)',
    description: 'Mail ile yeni talep açıldığında müşteriye giden HTML bilgilendirme (ACK).',
    subject: '[{{case.number}}] Talebiniz alındı — Univera Destek Ekibi',
    body: ackBody,
    required: ['case.number', 'case.title'],
    ruleName: 'Müşteri — Talep Alındı (R1)',
  },
  {
    event: 'status_changed',
    key: 'customer_status_changed',
    name: 'Müşteri — Durum Güncellendi',
    description: 'Talebin durumu değiştiğinde (açılış/kapanış dışı) müşteriye giden HTML bilgilendirme.',
    subject: '[{{case.number}}] Talebinizin durumu güncellendi: {{case.status}}',
    body: statusBody,
    required: ['case.number', 'case.title', 'case.status'],
    ruleName: 'Müşteri — Durum Güncellendi (R2)',
  },
  {
    event: 'case_closed',
    key: 'customer_resolved',
    name: 'Müşteri — Çözüm Bildirimi',
    description: 'Talep çözüldüğünde müşteriye giden HTML çözüm bildirimi (çözüm açıklamasıyla).',
    subject: '[{{case.number}}] Talebiniz çözümlendi — Univera Destek',
    body: resolvedBody,
    required: ['case.number', 'case.title', 'resolution.customerMessage'],
    ruleName: 'Müşteri — Çözüm Bildirimi (R3)',
  },
];

const co = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
if (!co) { console.error(`Şirket bulunamadı: ${companyId}`); process.exit(1); }
console.log(`Şirket: ${co.id} (${co.name})${activateRules ? '  [--activate-rules]' : ''}\n`);

for (const t of TEMPLATES) {
  // ── Şablon UPSERT (companyId+key) — yerinde HTML'e döner ──
  const tplData = {
    name: t.name,
    description: t.description,
    language: 'tr',
    subjectTemplate: t.subject,
    bodyTemplate: t.body,
    format: 'html',
    isCustomerFacing: true,
    requiredVariables: JSON.stringify(t.required),
    isActive: true,
  };
  let tpl = await prisma.notificationTemplate.findFirst({ where: { companyId, key: t.key } });
  if (tpl) {
    tpl = await prisma.notificationTemplate.update({ where: { id: tpl.id }, data: tplData });
    console.log(`✓ Şablon HTML'e güncellendi: ${t.key} (${tpl.id})`);
  } else {
    tpl = await prisma.notificationTemplate.create({ data: { companyId, key: t.key, ...tplData } });
    console.log(`✓ Şablon oluşturuldu (HTML): ${t.key} (${tpl.id})`);
  }

  // ── Kural eşleştirme — KİMLİK: templateId === tpl.id (event DEĞİL) ──
  // Codex P1: yalnız `event` ile findFirst, aynı event için birden çok kuralı
  // olan tenant'ta ALAKASIZ bir kuralı seçip (ör. iç/manuel case_closed) yanlış
  // repoint edebilirdi (--activate-rules olmadan bile) → müşteriye yanlış kopya.
  // Kuralı şablonumuza bağlı (templateId===tpl.id) kimliğiyle buluyoruz →
  // yalnız R1/R2/R3 müşteri kuralına dokunulur. Eşleşen kural zaten doğru
  // şablona bağlı olduğundan REPOINT YOK; başka şablona bağlı event kuralı
  // ASLA hijack edilmez.
  let rule = await prisma.notificationRule.findFirst({
    where: { companyId, event: t.event, templateId: tpl.id },
  });
  if (rule) {
    if (activateRules && !rule.isActive) {
      rule = await prisma.notificationRule.update({ where: { id: rule.id }, data: { isActive: true } });
      console.log(`  └ kural "${rule.name}" — ETKİNLEŞTİRİLDİ (isActive=true)`);
    } else {
      console.log(`  └ kural "${rule.name}" — isActive=${rule.isActive} (dokunulmadı)`);
    }
  } else {
    // Şablonumuza bağlı kural yok → yeni oluştur (KAPALI varsayılan). Var olan
    // ama BAŞKA şablona bağlı bir event kuralına DOKUNULMAZ (yanlış repoint
    // önlenir); gerekirse admin doğru şablonu UI'dan bağlar.
    rule = await prisma.notificationRule.create({
      data: {
        companyId, name: t.ruleName,
        description: `${t.name} — requester audience, Email/Active (mail dispatch). Bilgilendirme; müşteri yanıtı beklenmez.`,
        isActive: activateRules, // varsayılan KAPALI
        event: t.event, conditions: '{}', isMatchAll: true,
        audience: JSON.stringify([{ type: 'requester' }]),
        templateId: tpl.id, channel: 'Email', mode: 'Active',
      },
    });
    console.log(`  └ kural OLUŞTURULDU "${rule.name}" — isActive=${rule.isActive}`);
  }
}

console.log(`\n✓ ${co.name} müşteri bildirim şablonları HTML (Univera markalı).`);
if (!activateRules) {
  console.log('⚠ Kurallar KAPALI kaldı. Müşteriye mail göndermeye başlamak için:');
  console.log('   node scripts/seed-univera-customer-mails.mjs ' + companyId + ' --activate-rules');
  console.log('   (veya admin UI). {{company.logoUrl}} için prod .env: APP_PUBLIC_BASE_URL gerekir.');
}
await prisma.$disconnect();
