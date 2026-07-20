/**
 * U-C — resolveThirdPartyNote() saf fonksiyon testi.
 * DB/Prisma YOK — gerçek production kodunu (server/lib/thirdPartyNoteGuard.js)
 * doğrudan import edip çağırır. Migration'dan tamamen bağımsız çalışır.
 *
 * Çalıştır: node scripts/test-third-party-note-guard.mjs
 */
import { resolveThirdPartyNote } from '../server/lib/thirdPartyNoteGuard.js';

let pass = 0;
let fail = 0;

function assertEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    console.log(`   beklenen: ${JSON.stringify(expected)}, gelen: ${JSON.stringify(actual)}`);
  }
}

// 1) requiresNote=false, açıklama yok → serbest, missing=false, note=null
assertEqual(
  'requiresNote=false + boş payload → serbest geçiş',
  resolveThirdPartyNote({ requiresNote: false }, {}),
  { note: null, missing: false },
);

// 2) requiresNote=false, açıklama girilmiş olsa bile — yine de kaydedilir (opsiyonel alan)
assertEqual(
  'requiresNote=false + açıklama girilmiş → yine de kalıcı kaydedilir',
  resolveThirdPartyNote({ requiresNote: false }, { thirdPartyNote: 'Bilgi amaçlı not' }),
  { note: 'Bilgi amaçlı not', missing: false },
);

// 3) requiresNote=true, açıklama yok → 400 (missing=true)
assertEqual(
  'requiresNote=true + payload yok → zorunluluk tetiklenir',
  resolveThirdPartyNote({ requiresNote: true }, {}),
  { note: null, missing: true },
);

// 4) requiresNote=true, boş string → zorunluluk tetiklenir
assertEqual(
  'requiresNote=true + boş string → zorunluluk tetiklenir',
  resolveThirdPartyNote({ requiresNote: true }, { thirdPartyNote: '' }),
  { note: null, missing: true },
);

// 5) requiresNote=true, sadece boşluk karakteri → trim sonrası boş, zorunluluk tetiklenir
assertEqual(
  'requiresNote=true + sadece boşluk → trim sonrası zorunluluk tetiklenir',
  resolveThirdPartyNote({ requiresNote: true }, { thirdPartyNote: '   ' }),
  { note: null, missing: true },
);

// 6) requiresNote=true, geçerli açıklama → kabul, trim edilmiş halde döner
assertEqual(
  'requiresNote=true + geçerli açıklama → kabul edilir, trim edilir',
  resolveThirdPartyNote({ requiresNote: true }, { thirdPartyNote: '  Tedarikçi API bakımda  ' }),
  { note: 'Tedarikçi API bakımda', missing: false },
);

// 7) tp null (savunma) → requiresNote yokmuş gibi davran, hata fırlatmaz
assertEqual(
  'tp=null (savunma) → crash etmez, serbest geçiş',
  resolveThirdPartyNote(null, { thirdPartyNote: 'test' }),
  { note: 'test', missing: false },
);

// 8) payload.thirdPartyNote string olmayan bir değer (savunma) → boş kabul edilir
assertEqual(
  'payload.thirdPartyNote sayı (savunma) → boş kabul edilir',
  resolveThirdPartyNote({ requiresNote: true }, { thirdPartyNote: 123 }),
  { note: null, missing: true },
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
