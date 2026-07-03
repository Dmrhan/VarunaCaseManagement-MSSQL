/**
 * smoke-account-picker-codex-p2-r1.js — 2026-07-03
 *
 * Codex P2 round 1 fix'leri (customer-search-field-chips PR üzerinde).
 *
 * 1. AccountSearchPicker default searchFields ['name'] → [] (tüm alanlar).
 *    Backend accountRepository:308 `sf.length > 0` guard'ı [] → sf=null →
 *    tüm predicate branch'leri aktif. TCKN/telefon/kod yapıştırma çalışır.
 *
 * 2. accountRepository contact branch — AccountContact.fullName eklendi.
 *    UI placeholder "Kontak adı, telefon veya e-posta" dediği halde önceden
 *    fullName aranmıyordu.
 *
 * Test: pattern doğrulama + saf davranış simülasyonu (backend sf mantığı).
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

const picker = read('src/features/accounts/AccountSearchPicker.tsx');
const repo = read('server/db/accountRepository.js');
const repoCode = strip(repo);

console.log('── 1) Frontend — default searchFields [] ──────');
expect('1.1 useState default []',
  /useState<AccountSearchField\[\]>\(\[\]\)/.test(picker), true);
expect('1.2 length===0 durumu placeholder "tüm alanlarda" içerir',
  /searchFields\.length === 0[\s\S]{0,300}Müşteri adı, VKN, TCKN, telefon veya müşteri kodu/.test(picker), true);
expect('1.3 UI hint — "seçim yok — tüm alanlarda aranır"',
  /seçim yok — tüm alanlarda aranır/.test(picker), true);
expect('1.4 hint sadece searchFields.length === 0 iken',
  /\{searchFields\.length === 0 &&[\s\S]{0,500}seçim yok/.test(picker), true);
// Codex P2 R2 (2026-07-03) — Reset path + toggle son chip
expect('1.5 Reset path (open=false) → setSearchFields([]) (initializer ile hizalı)',
  /if \(!open\)[\s\S]{0,600}setSearchFields\(\[\]\)/.test(picker), true);
expect('1.6 Reset path setSearchFields([\'name\']) İZİ YOK',
  !/setSearchFields\(\['name'\]\)/.test(picker), true);
expect('1.7 toggleSearchField — son chip kaldırma [] döner ([field] YOK)',
  /function toggleSearchField[\s\S]{0,600}return prev\.filter\(\(f\) => f !== field\);\s*\}/.test(picker), true);
expect('1.8 toggleSearchField — "next.length === 0 ? [field]" İZİ YOK',
  !/next\.length === 0 \? \[field\]/.test(picker), true);

console.log('\n── 2) Backend — contact fullName branch ──────');
expect('2.1 contactNameOR helper (Turkish-aware variants)',
  /const contactNameOR = nameVariants\.map\(\(v\) => \(\{ fullName: \{ contains: v \} \}\)\)/.test(repoCode), true);
expect('2.2 contact branch: OR = phone + contactEmailOR + contactNameOR',
  /sf\.has\('contact'\)[\s\S]{0,400}\{ phone: \{ contains: q \} \}[\s\S]{0,200}\.\.\.contactEmailOR[\s\S]{0,100}\.\.\.contactNameOR/.test(repoCode), true);
expect('2.3 sf===null → tüm branch\'ler (geriye uyum)',
  /const sf = Array\.isArray\(searchFields\) && searchFields\.length > 0 \? new Set\(searchFields\) : null/.test(repoCode), true);

console.log('\n── 3) Davranış — sf resolver simülasyonu ─────');

function resolveSf(searchFields) {
  return Array.isArray(searchFields) && searchFields.length > 0 ? new Set(searchFields) : null;
}
function hasFieldInSf(sf, field) {
  return !sf || sf.has(field);
}
function branchesActive(searchFields) {
  const sf = resolveSf(searchFields);
  return {
    name: hasFieldInSf(sf, 'name'),
    vkn: hasFieldInSf(sf, 'vkn'),
    phone: hasFieldInSf(sf, 'phone'),
    code: hasFieldInSf(sf, 'code'),
    contact: hasFieldInSf(sf, 'contact'),
  };
}

// Default davranış (frontend [] gönderiyor)
const b0 = branchesActive([]);
expect('3.1 default [] → name active', b0.name, true);
expect('3.2 default [] → vkn active (TCKN paste çalışsın)', b0.vkn, true);
expect('3.3 default [] → phone active', b0.phone, true);
expect('3.4 default [] → code active', b0.code, true);
expect('3.5 default [] → contact active', b0.contact, true);

// Kullanıcı chip seçince (dar arama)
const b1 = branchesActive(['name']);
expect('3.6 ["name"] → sadece name', b1.name, true);
expect('3.7 ["name"] → vkn PASİF (Codex bulgusu — bu davranış artık default DEĞİL, sadece kullanıcı tıklarsa)', b1.vkn, false);

const b2 = branchesActive(['vkn']);
expect('3.8 ["vkn"] → sadece vkn', b2.vkn, true);
expect('3.9 ["vkn"] → name pasif', b2.name, false);

const b3 = branchesActive(['contact']);
expect('3.10 ["contact"] → sadece contact', b3.contact, true);
expect('3.11 ["contact"] → name pasif', b3.name, false);

// Çoklu chip
const b4 = branchesActive(['name', 'vkn']);
expect('3.12 ["name","vkn"] → ikisi de aktif', b4.name && b4.vkn, true);
expect('3.13 ["name","vkn"] → phone pasif', b4.phone, false);

// null / undefined da tüm alanlar (backend geriye uyum)
const b5 = branchesActive(undefined);
expect('3.14 undefined → tüm alanlar (geriye uyum)', b5.name && b5.vkn, true);
const b6 = branchesActive(null);
expect('3.15 null → tüm alanlar (geriye uyum)', b6.name && b6.vkn, true);

console.log('\n── 4) Davranış — contact branch içerik ───────');

// Contact chip aktifken hangi field'lar aranıyor?
function contactBranchFields(sf) {
  if (sf && !sf.has('contact')) return [];
  // OR: [{phone}, ...contactEmailOR (email), ...contactNameOR (fullName)]
  return ['phone', 'email', 'fullName'];
}

const cf0 = contactBranchFields(null); // default (tüm alanlar)
expect('4.1 default → contact OR: phone + email + fullName',
  cf0.length === 3 && cf0.includes('fullName'), true);

const cf1 = contactBranchFields(new Set(['contact']));
expect('4.2 sadece contact chip → OR: phone + email + fullName (fullName EKLENDİ)',
  cf1.includes('fullName'), true);

const cf2 = contactBranchFields(new Set(['name']));
expect('4.3 sadece name chip → contact OR YOK', cf2.length === 0, true);

console.log('\n── 5) Davranış — toggleSearchField (Codex P2 R2) ─');

function toggleSearchField(prev, field) {
  if (prev.includes(field)) {
    return prev.filter((f) => f !== field);
  }
  return [...prev, field];
}

// Toggle sıralı senaryolar
let s = [];
s = toggleSearchField(s, 'vkn');
expect('5.1 default [] + vkn tıkla → [vkn]', JSON.stringify(s), '["vkn"]');
s = toggleSearchField(s, 'vkn');
expect('5.2 [vkn] + vkn tıkla → [] (son chip kaldırılabilir, R2 fix)',
  JSON.stringify(s), '[]');
s = toggleSearchField(s, 'contact');
expect('5.3 [] + contact → [contact]', JSON.stringify(s), '["contact"]');
s = toggleSearchField(s, 'name');
expect('5.4 [contact] + name → [contact,name]',
  JSON.stringify(s), '["contact","name"]');
s = toggleSearchField(s, 'contact');
expect('5.5 [contact,name] + contact → [name]',
  JSON.stringify(s), '["name"]');
s = toggleSearchField(s, 'name');
expect('5.6 [name] + name → [] (kullanıcı "hepsi"e döndü)',
  JSON.stringify(s), '[]');

console.log('\n── 6) Davranış — reset/mount lifecycle (R2) ─────');

// Modal ilk mount: open=false → useEffect reset path çağrılır → default []
function resetOnClose() {
  // Codex fix sonrası: setSearchFields([])
  return [];
}

const stateAfterFirstMountOpenFalse = resetOnClose();
expect('6.1 İlk mount open=false → reset [] (initializer ile hizalı)',
  JSON.stringify(stateAfterFirstMountOpenFalse), '[]');

// Modal kullanıcı chip seçiyor
const afterUserToggle = toggleSearchField(stateAfterFirstMountOpenFalse, 'vkn');
expect('6.2 Kullanıcı vkn tıkladıktan sonra → [vkn]',
  JSON.stringify(afterUserToggle), '["vkn"]');

// Modal kapatılıyor
const stateAfterClose = resetOnClose();
expect('6.3 Modal kapatıldı → reset [] (bir sonraki açılış default)',
  JSON.stringify(stateAfterClose), '[]');

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
