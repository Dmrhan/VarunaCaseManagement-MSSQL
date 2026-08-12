/**
 * smoke-notif-template-html-preview.js — 2026-07-09
 * Bildirim Şablonları admin sayfasında "Önizle" HTML şablonu için tasarımı
 * (sadece kaynak metin değil) render eder + logo/müşteri değişkenleri örnek
 * değerlerle dolar. Yapısal (grep) smoke.
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const page = readFileSync('src/features/admin/NotificationTemplatesPage.tsx', 'utf8');

ok('1 sanitizeMailHtml import edildi (BE allowlist ile hizalı, reuse)',
  /import \{ sanitizeMailHtml \} from '@\/lib\/sanitizeMailHtml'/.test(page));
ok('2 preview state format taşır',
  /format: 'plain' \| 'html' \} \| null>/.test(page)
  && /missing: Array\.from\(new Set\(missing\)\),\s*format,/.test(page));
ok('3 format=html → sanitize edilmiş HTML render (dangerouslySetInnerHTML)',
  /preview\.format === 'html'/.test(page)
  && /dangerouslySetInnerHTML=\{\{ __html: sanitizeMailHtml\(preview\.body\) \}\}/.test(page));
ok('4 format=plain → <pre> kaynak metin korunur (geri uyumlu)',
  /<pre className="whitespace-pre-wrap[\s\S]{0,90}\{preview\.body\}<\/pre>/.test(page));
ok('5 sampleVars logo yolları taşır (önizlemede img yüklensin)',
  /'company\.logoUrl': '\/univera-logo\.png'/.test(page)
  && /'app\.logoUrl': '\/varuna-logo\.png'/.test(page));
ok('6 sampleVars müşteri-yüzü değişkenler dolu (requester + resolution + lastCustomerMessage)',
  /'requester\.name': '[^']+'/.test(page)
  && /'resolution\.customerMessage': '[^']+'/.test(page)
  && /'case\.lastCustomerMessage': '[^']+'/.test(page));
ok('7 VARIABLE_OPTIONS yeni müşteri-yüzü değişkenleri sunar',
  /'company\.logoUrl',/.test(page) && /'requester\.name',/.test(page) && /'case\.url',/.test(page));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
