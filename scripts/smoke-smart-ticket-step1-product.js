/**
 * smoke-smart-ticket-step1-product.js — Smart Ticket Step 1 (2026-07-02).
 *
 * Kapsam:
 *  1. Backend: getCaseCatalog productGroups additive (mevcut alanlar aynen).
 *  2. TS type: caseService.caseCatalog response productGroups.
 *  3. SmartTicketNewPage: form state, catalog fetch, şirket/grup reset,
 *     Öncelik + Talep Türü zorunlu, Ürün Grubu + Ürün cascade + hint'ler,
 *     grup-only kayıt convention (Case.productGroup name + productId).
 *  4. Davranış simülasyonu: cascade filter, reset, zorunluluk gate.
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

const repoLookup = read('server/db/lookupRepository.js');
const svcCase = read('src/services/caseService.ts');
const page = read('src/features/smart-ticket/SmartTicketNewPage.tsx');
const pageStrip = strip(page);

console.log('── 1) Backend — getCaseCatalog productGroups additive ───');
expect('1.1 prisma.productGroup.findMany — companyId + isActive',
  /prisma\.productGroup\.findMany\(\{[\s\S]{0,300}where: \{ companyId, isActive: true \}[\s\S]{0,200}select: \{ id: true, code: true, name: true \}/.test(repoLookup), true);
expect('1.2 productGroups Promise.all destructure',
  /const \[packages, products, productGroups, packageItems, accountCompany\] = await Promise\.all/.test(repoLookup), true);
expect('1.3 return objesine productGroups eklendi',
  /return \{[\s\S]{0,500}productGroups,/.test(repoLookup), true);
expect('1.4 orderBy sortOrder + name (kardeş ekranlarla tutarlı)',
  /prisma\.productGroup\.findMany[\s\S]{0,400}orderBy: \[\{ sortOrder: 'asc' \}, \{ name: 'asc' \}\]/.test(repoLookup), true);

console.log('\n── 2) TS type — caseService.caseCatalog genişletmesi ────');
expect('2.1 return type productGroups: Array<{id, code, name}>',
  /Promise<\{[\s\S]{0,800}productGroups: Array<\{ id: string; code: string; name: string \}>/.test(svcCase), true);
expect('2.2 apiFetch response type productGroups',
  /apiFetch<\{[\s\S]{0,800}productGroups: Array<\{ id: string; code: string; name: string \}>/.test(svcCase), true);
expect('2.3 fallback (undefined data) productGroups: []',
  /data \?\?[\s\S]{0,400}productGroups: \[\]/.test(svcCase), true);

console.log('\n── 3) SmartTicketNewPage — form state ──────────────────');
expect('3.1 SmartTicketFormState priority: CasePriority | \'\' (opsiyonel + zorunlu form-level)',
  /priority: CasePriority \| ''/.test(page), true);
expect('3.2 productGroupId: string + productId: string',
  /productGroupId: string;[\s\S]{0,150}productId: string;/.test(page), true);
expect('3.3 emptyForm priority: \'\' (eskiden Medium)',
  /const emptyForm[\s\S]{0,500}priority: '',/.test(page), true);
expect('3.4 emptyForm productGroupId + productId: \'\'',
  /const emptyForm[\s\S]{0,600}productGroupId: '',\s*productId: '',/.test(page), true);

console.log('\n── 4) Catalog fetch — companyId scope + reuse ────────');
expect('4.1 catalogProducts state Array<{id, code, name, productGroupId}>',
  /const \[catalogProducts, setCatalogProducts\] = useState<[\s\S]{0,400}productGroupId: string;/.test(page), true);
expect('4.2 catalogProductGroups state',
  /const \[catalogProductGroups, setCatalogProductGroups\] = useState<[\s\S]{0,200}Array<\{ id: string; code: string; name: string \}>/.test(page), true);
expect('4.3 useEffect — lookupService.caseCatalog companyId scope',
  /useEffect\([\s\S]{0,600}lookupService\s*\.caseCatalog\(\{ companyId: form\.companyId, accountId: form\.accountId \|\| null \}\)/.test(page), true);
expect('4.4 companyId boş / stage !== opening → reset',
  /if \(stage !== 'opening' \|\| !form\.companyId\)[\s\S]{0,300}setCatalogProducts\(\[\]\)[\s\S]{0,200}setCatalogProductGroups\(\[\]\)/.test(page), true);

console.log('\n── 5) Şirket değişince Ürün Grubu + Ürün sıfırlama ──');
expect('5.1 şirket reset useEffect — productGroupId + productId \'\'',
  /useEffect\([\s\S]{0,1000}productGroupId: '',[\s\S]{0,100}productId: '',[\s\S]{0,200}\}, \[form\.companyId\]\)/.test(page), true);

console.log('\n── 6) Grup değişince ürün sıfırlama ────────────────');
expect('6.1 productGroupId değişince uyumsuz productId reset',
  /useEffect\(\(\) => \{[\s\S]{0,500}product\.productGroupId !== form\.productGroupId[\s\S]{0,300}productId: ''[\s\S]{0,200}\}, \[form\.productGroupId,/.test(page), true);

console.log('\n── 7) Zorunluluk — canCreate gate ────────────────────');
expect('7.1 canCreate form.priority zorunlu',
  /const canCreate =[\s\S]{0,500}!!form\.priority/.test(page), true);
expect('7.2 canCreate form.requestType zorunlu',
  /const canCreate =[\s\S]{0,500}!!form\.requestType/.test(page), true);

console.log('\n── 8) UI — Öncelik + Talep Türü zorunlu (required + Seçin) ─');
expect('8.1 Talep Türü Field required',
  /label="Talep Türü"[\s\S]{0,200}required/.test(page), true);
expect('8.2 Talep Türü Select — Seçin placeholder + disabled',
  /Select[\s\S]{0,600}Talep[\s\S]{2000,4000}<option value="" disabled>— Seçin —<\/option>/.test(page)
    || /label="Talep Türü"[\s\S]{0,800}<option value="" disabled>— Seçin —<\/option>/.test(page), true);
expect('8.3 Öncelik Field required',
  /label="Öncelik"[\s\S]{0,200}required/.test(page), true);
expect('8.4 Öncelik Select — Seçin placeholder',
  /label="Öncelik"[\s\S]{0,1000}<option value="" disabled>— Seçin —<\/option>/.test(page), true);

console.log('\n── 9) UI — Ürün Grubu + Ürün dropdown ────────────');
expect('9.1 Ürün Grubu Field + Select',
  /label="Ürün Grubu"[\s\S]{0,800}Select\s+value=\{form\.productGroupId\}/.test(page), true);
expect('9.2 Ürün Grubu — companyId olmadan disabled',
  /Ürün Grubu[\s\S]{0,1200}disabled=\{[\s\S]{0,200}!form\.companyId/.test(page), true);
expect('9.3 Ürün Grubu — boş liste hint (grup yok)',
  /Bu şirkette aktif ürün grubu tanımlı değil/.test(page), true);
expect('9.4 Ürün Grubu — opsiyonel hint (emin değilsen boş bırak)',
  /Opsiyonel[\s\S]{0,100}emin değilsen boş bırak/.test(page), true);
expect('9.5 Ürün Field + Select',
  /label="Ürün"[\s\S]{0,800}Select\s+value=\{form\.productId\}/.test(page), true);
expect('9.6 Ürün — grup seçilmeden hint',
  /Önce Ürün Grubu seç/.test(page), true);
expect('9.7 Ürün — dropdown filter productGroupId eşleşmesi',
  /catalogProducts[\s\S]{0,200}\.filter\(\(p\) => p\.productGroupId === form\.productGroupId\)/.test(page), true);
expect('9.8 Ürün — boş grup için özel hint (sadece grup kaydedilecek)',
  /Bu grubun aktif ürünü yok — sadece grup kaydedilecek/.test(page), true);

console.log('\n── 10) Payload — grup-only convention (Case.productGroup + productId) ─');
expect('10.1 grup name resolution — catalogProductGroups.find',
  /catalogProductGroups\.find\(\(g\) => g\.id === form\.productGroupId\)/.test(page), true);
expect('10.2 ürün resolution — catalogProducts.find',
  /catalogProducts\.find\(\(p\) => p\.id === form\.productId\)/.test(page), true);
expect('10.3 payload productGroup (legacy string, grup name)',
  /\.\.\.\(finalProductGroup \? \{ productGroup: finalProductGroup \} : \{\}\)/.test(page), true);
expect('10.4 payload productId + productName snapshot',
  /productId: finalProductId, productName: finalProductName/.test(page), true);

console.log('\n── 11) Erken uyarı — "Vaka Oluştur" title (self-explanatory) ─');
expect('11.1 title — Öncelik ve Talep Türü zorunlu mesajı',
  /Öncelik ve Talep Türü zorunlu/.test(page), true);
expect('11.2 title — Şirket eksik mesajı',
  /Önce Şirket seç/.test(page), true);
expect('11.3 title — Başlık boş mesajı',
  /Başlık boş olamaz/.test(page), true);

console.log('\n── 12) Davranış simülasyonu — cascade filter ─────');

const groups = [
  { id: 'g1', code: 'ERP', name: 'ERP' },
  { id: 'g2', code: 'CRM', name: 'CRM' },
  { id: 'g3', code: 'SVC', name: 'ServiceCore' }, // boş grup — spec kararı 1
];
const products = [
  { id: 'p1', code: 'ERP-CASH', name: 'ERP Kasa', productGroupId: 'g1' },
  { id: 'p2', code: 'ERP-INV', name: 'ERP Fatura', productGroupId: 'g1' },
  { id: 'p3', code: 'CRM-SLS', name: 'CRM Satış', productGroupId: 'g2' },
  // g3 boş — hiçbir product yok
];

function filterProducts(catalogProducts, productGroupId) {
  return catalogProducts.filter((p) => p.productGroupId === productGroupId);
}

expect('12.1 g1 seçilince — 2 ürün', filterProducts(products, 'g1').length, 2);
expect('12.2 g2 seçilince — 1 ürün', filterProducts(products, 'g2').length, 1);
expect('12.3 g3 (boş grup) — 0 ürün', filterProducts(products, 'g3').length, 0);
expect('12.4 grup seçilmeden — boş', filterProducts(products, '').length, 0);
expect('12.5 spec: boş grup listeden düşmez',
  groups.some((g) => g.id === 'g3'), true);

console.log('\n── 13) Davranış — grup değişince ürün reset ────');

function shouldResetProduct(currentProductId, currentGroupId, catalogProducts) {
  if (!currentProductId) return false;
  const product = catalogProducts.find((p) => p.id === currentProductId);
  return !product || product.productGroupId !== currentGroupId;
}

expect('13.1 grup=g1 + ürün=p1 → reset yok',
  shouldResetProduct('p1', 'g1', products), false);
expect('13.2 grup=g1 → g2 değişimi + ürün=p1 (hala g1) → reset',
  shouldResetProduct('p1', 'g2', products), true);
expect('13.3 grup=g3 (boş) + eski ürün=p1 → reset',
  shouldResetProduct('p1', 'g3', products), true);
expect('13.4 ürün silinmiş (catalog\'dan kaldırıldı) → reset',
  shouldResetProduct('p999', 'g1', products), true);
expect('13.5 ürün boş → no-op',
  shouldResetProduct('', 'g1', products), false);

console.log('\n── 14) Davranış — canCreate zorunluluk gate ────');

function canCreateSim(form) {
  return (
    !!form.companyId &&
    !!form.accountId &&
    (form.title ?? '').trim().length > 0 &&
    (form.description ?? '').trim().length > 0 &&
    !!form.priority &&
    !!form.requestType
  );
}

const baseForm = {
  companyId: 'c1',
  accountId: 'a1',
  title: 'Test',
  description: 'Bir açıklama',
  priority: 'Medium',
  requestType: 'Talep',
};
expect('14.1 tüm zorunlular dolu → true', canCreateSim(baseForm), true);
expect('14.2 priority boş → false',
  canCreateSim({ ...baseForm, priority: '' }), false);
expect('14.3 requestType boş → false',
  canCreateSim({ ...baseForm, requestType: '' }), false);
expect('14.4 ikisi boş → false',
  canCreateSim({ ...baseForm, priority: '', requestType: '' }), false);
expect('14.5 title/description boş → false',
  canCreateSim({ ...baseForm, title: '' }), false);
expect('14.6 opsiyonel (productGroupId/productId) yok → true',
  canCreateSim({ ...baseForm, productGroupId: '', productId: '' }), true);

console.log('\n── 15) Regresyon — mevcut hint sistemi + smart ticket akışı korundu ─');
expect('15.1 CompanySelector Şirket alanı korundu',
  /<CompanySelector\s*label="Şirket"/.test(page), true);
expect('15.2 Başlık + Açıklama alanları korundu',
  /label="Başlık" required[\s\S]{0,500}label="Açıklama"/.test(page), true);
expect('15.3 Smart Ticket taxonomy bloğu (Akıllı Tanımlar) korundu',
  /Akıllı Tanımlar/.test(page), true);
expect('15.4 handleCreateAndContinue akışı korundu',
  /handleCreateAndContinue/.test(page), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
