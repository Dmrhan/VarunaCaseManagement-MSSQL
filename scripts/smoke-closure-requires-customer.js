/**
 * smoke-closure-requires-customer.js — 2026-07-06
 * Müşterisiz vaka ÇÖZÜLDÜ'ye geçemez (kapanış müşteri kapısı).
 * Karar: yalnız Cozuldu (IptalEdildi muaf); SystemAdmin istisna.
 * Canlı kanıt (2026-07-06): agent→HTTP 400 account_required_for_closure +
 * vaka açık kaldı; sysadmin→HTTP 200 (bypass, demo restore edildi).
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const expectTrue = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS — ${name}`); }
  else { fail += 1; console.log(`FAIL — ${name}`); }
};
const read = (p) => readFileSync(p, 'utf8');

console.log('── Backend guard ──');
const repo = read('server/db/caseRepository.js');
expectTrue('1. transitionStatus: Cozuldu + accountId null + non-SystemAdmin → CaseValidationError',
  /dbNext === 'Cozuldu' &&\s*prev\.status !== 'Cozuldu' &&\s*!prev\.accountId &&\s*actorObject\?\.role !== 'SystemAdmin'/.test(repo)
  && repo.includes("code: 'account_required_for_closure'"));
expectTrue('2. yalnız Cozuldu (IptalEdildi muaf — koşulda IptalEdildi yok)',
  !/account_required_for_closure[\s\S]{0,200}IptalEdildi/.test(repo));
expectTrue('3. idempotent: zaten Cozuldu olan tekrar geçişte tetiklenmez (prev.status !== Cozuldu)',
  /prev\.status !== 'Cozuldu' &&\s*!prev\.accountId[\s\S]{0,300}account_required_for_closure/.test(repo));

console.log('── Frontend gate ──');
const panel = read('src/features/cases/StatusTransitionPanel.tsx');
expectTrue('4. customerGateActive: Çözüldü + !accountId + !linkedCustomer + role!==SystemAdmin',
  /customerGateActive =\s*pending === 'Çözüldü' &&\s*!item\.accountId &&\s*!linkedCustomer &&\s*user\?\.role !== 'SystemAdmin'/.test(panel));
expectTrue('5. applyDisabled: customerGateActive → buton kilitli',
  /if \(customerGateActive\) return true;/.test(panel));
expectTrue('6. reuse: CustomerMatchSuggestionsPanel (öneriler) + AccountSearchPicker (elle)',
  panel.includes('<CustomerMatchSuggestionsPanel') && panel.includes('<AccountSearchPicker'));
expectTrue('7. linkAccount → linkedCustomer un-gate (DB persist + local state)',
  /caseService\.linkAccount\(item\.id, accountId\)/.test(panel)
  && /setLinkedCustomer\(\{ id: accountId, name: accountName \}\)/.test(panel));
expectTrue('8. öz-açıklayıcı: uyarı + "bağlandı" onayı (empty-state/feedback)',
  panel.includes('müşteri eşleştirilmeden çözülemez') && panel.includes('Müşteri bağlandı'));
expectTrue('9. vaka değişince state reset (linkedCustomer + picker)',
  panel.includes('setLinkedCustomer(null)') && panel.includes('setCustomerPickerOpen(false)')
  && /setLinkedCustomer\(null\)[\s\S]{0,400}\}, \[item\.id\]\)/.test(panel));

console.log('── Döngüsel import guard (extraction) ──');
const extracted = read('src/features/cases/components/CustomerMatchSuggestionsPanel.tsx');
expectTrue('10. panel ayrı modülde + export (CaseDetailPage↔StatusTransitionPanel döngüsü yok)',
  /export function CustomerMatchSuggestionsPanel/.test(extracted)
  && read('src/features/cases/CaseDetailPage.tsx').includes("from './components/CustomerMatchSuggestionsPanel'")
  && !/^function CustomerMatchSuggestionsPanel/m.test(read('src/features/cases/CaseDetailPage.tsx')));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
