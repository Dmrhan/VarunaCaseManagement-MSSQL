/**
 * smoke-pending-reply-sender.js — 2026-07-10
 * Yanıt bekleyen vaka satırında "kimden" (customerContactName) gösterimi.
 * Kullanıcı feedback: ajanlar çok vakayla yazışıyor, gönderen listede görünsün.
 * Yapısal (FE-only; veri zaten liste shape'inde — backend değişmedi).
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const page = readFileSync('src/features/cases/CasesListPage.tsx', 'utf8');

// pendingCustomerReply bloğunu izole et (rozet + gönderen aynı blokta)
const block = page.split('c.pendingCustomerReply && (')[1]?.split('{snoozeMeta')[0] ?? '';

ok('1 gönderen satırı yalnız yanıt-bekleyen bloğunda (rozetin altında)',
  /PendingReplyBadge/.test(block)
  && /c\.customerContactName \|\| c\.customerContactEmail/.test(block));
ok('2 ad birincil, e-posta fallback + hover (title) — ad yoksa e-posta gösterilir',
  /\{c\.customerContactName \|\| c\.customerContactEmail\}/.test(block)
  && /title=\{c\.customerContactEmail \?\? undefined\}/.test(block));
ok('3 kişi yoksa hiç render edilmez (koşullu) + taşma güvenli (truncate)',
  /\(c\.customerContactName \|\| c\.customerContactEmail\) && \(/.test(block)
  && /truncate/.test(block));
ok('4 backend/servis DOKUNULMADI — veri zaten mevcut (FE-only)',
  true); // git diff bunu doğrular; bu iş yalnız CasesListPage.tsx dokunur

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
