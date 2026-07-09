/**
 * smoke-univera-customer-mails.js — 2026-07-09
 * Müşteriye giden 3 HTML bildirimin (ACK / durum / çözüm) dikişleri.
 * Yapısal + SMOKE_DB=1 (şablon HTML + logo değişkeni seed kontrolü,
 * default COMP-UNIVERA).
 */
import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0, skip = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const sk = (n, why) => { skip++; console.log(`SKIP — ${n} (${why})`); };
const read = (p) => readFileSync(p, 'utf8');

const repo = read('server/db/notificationRepository.js');
const seed = read('scripts/seed-univera-customer-mails.mjs');

console.log('── Motor: company.logoUrl (müşteri-yüzü marka) ──');
ok('1.1 company.logoUrl ALLOWED_VARIABLE_PATHS içinde',
  /'company\.logoUrl',/.test(repo));
ok('1.2 buildTemplateVars company.logoUrl → univera-logo.png (APP_PUBLIC_BASE_URL)',
  /'company\.logoUrl':\s*process\.env\.APP_PUBLIC_BASE_URL/.test(repo)
  && /univera-logo\.png/.test(repo));
ok('1.3 app.logoUrl (Varuna iç mail) AYRI korunuyor — karışmadı',
  /varuna-logo\.png/.test(repo) && /'app\.logoUrl':/.test(repo));

console.log('── Logo varlığı ──');
ok('2.1 public/univera-logo.png mevcut', existsSync('public/univera-logo.png'));

console.log('── Seed: 3 şablon HTML + marka + bilgilendirme tonu ──');
ok('3.1 üç key de var (ack / status / resolved)',
  /customer_ack_received/.test(seed) && /customer_status_changed/.test(seed) && /customer_resolved/.test(seed));
ok('3.2 üç event de var (case_created / status_changed / case_closed)',
  /case_created/.test(seed) && /status_changed/.test(seed) && /case_closed/.test(seed));
ok('3.3 format=html + isCustomerFacing=true',
  /format: 'html'/.test(seed) && /isCustomerFacing: true/.test(seed));
ok('3.4 gövde {{company.logoUrl}} <img> kullanıyor (SVG değil PNG)',
  /\{\{company\.logoUrl\}\}/.test(seed) && /<img src="\{\{company\.logoUrl\}\}"/.test(seed));
ok('3.5 "yanıtlamayınız" bilgilendirme uyarısı (3 mailde de)',
  (seed.match(/lütfen bu e-postayı yanıtlamayınız/g) ?? []).length >= 3);
ok('3.6 "vakayı aç"/case.url butonu YOK (müşteri login olamaz)',
  !/case\.url/.test(seed) && !/Vakayı aç/.test(seed));
ok('3.7 çözüm maili {{resolution.customerMessage}} taşır',
  /\{\{resolution\.customerMessage\}\}/.test(seed));

console.log('── Seed: güvenli varsayılan (kural KAPALI) ──');
ok('4.1 kurallar default ETKİNLEŞTİRİLMEZ (--activate-rules opt-in)',
  /const activateRules = args\.includes\('--activate-rules'\)/.test(seed)
  && /isActive: activateRules/.test(seed));
ok('4.2 mevcut kuralın isActive\'ine flag olmadan dokunulmaz',
  /if \(activateRules && !rule\.isActive\)/.test(seed)
  && /data: \{ isActive: true \}/.test(seed));
ok('4.3 (Codex P1) kural KİMLİĞİ şablona bağlı — event+templateId ile eşleşir (yanlış repoint yok)',
  /findFirst\(\{\s*where: \{ companyId, event: t\.event, templateId: tpl\.id \}/.test(seed)
  && !/patch\.templateId = tpl\.id/.test(seed));

console.log('── Motor: HTML executor dikişi (müşteri-yüzü) hâlâ yerinde ──');
ok('5.1 emit format=html → değişkenleri escape eder',
  /const isHtmlTemplate = rule\.template\.format === 'html'/.test(repo)
  && /htmlEscape: isHtmlTemplate/.test(repo));
ok('5.2 executor HTML gövde + text fallback + customer-facing appendOutbound',
  /isHtmlBody/.test(repo)
  && /html: dispatch\.snapshotBody, text: stripHtmlToText/.test(repo)
  && /if \(isCustomerFacing\) try \{/.test(repo));

if (process.env.SMOKE_DB === '1') {
  console.log('── DB: şablon HTML + logo değişkeni seed kontrolü ──');
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const companyId = process.env.SMOKE_COMPANY ?? 'COMP-UNIVERA';
    const keys = ['customer_ack_received', 'customer_status_changed', 'customer_resolved'];
    for (const key of keys) {
      const tpl = await prisma.notificationTemplate.findFirst({
        where: { companyId, key },
        select: { format: true, isCustomerFacing: true, bodyTemplate: true },
      });
      ok(`6.${key} HTML + custFacing + {{company.logoUrl}} gövdede`,
        !!tpl && tpl.format === 'html' && tpl.isCustomerFacing === true
        && /\{\{company\.logoUrl\}\}/.test(tpl.bodyTemplate)
        && /yanıtlamayınız/.test(tpl.bodyTemplate));
    }
    await prisma.$disconnect();
  } catch (e) { fail++; console.log(`FAIL — DB: ${e.message}`); }
} else {
  sk('DB şablon kontrolü', 'SMOKE_DB!=1');
}

console.log(`\nPASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
process.exit(fail ? 1 : (skip && process.env.SMOKE_DB === '1' && !process.env.ALLOW_SKIP ? 2 : 0));
