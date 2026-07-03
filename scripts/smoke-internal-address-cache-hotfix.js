/**
 * smoke-internal-address-cache-hotfix.js — 2026-07-03
 *
 * HOTFIX P1 — internalAddressCache geçersiz Prisma sorgusu:
 *   User modelinde `companyId` alanı YOK. Doğru şekil UserCompany join'i:
 *     User.findMany({ where: { companies: { some: { companyId, isActive: true } } } })
 *
 * Bulgular (before fix):
 *   - Prisma her çağrıda PrismaClientValidationError fırlatıyordu
 *   - F1 iç-adres dışlaması devre dışı (senderIsInternal hep throw)
 *   - M2.3 learned upsert ölü (learned kaydı yazılamıyor)
 *
 * Kapsam:
 *  1. Kod pattern: doğru sorgu şekli + eski (yanlış) şekil KALKMIŞ
 *  2. Fail-open guard: try/catch + console.error + boş Set
 *  3. Intake caller (line ~846) yerel try/catch — "mail düşürülmez"
 *  4. Davranış sim: cache + isInternalAddress semantik
 *  5. GERÇEK RUNTIME testi — Prisma sorgusu THROW ETMEDEN döner mi?
 *     DB yoksa PASS DEMEZ, açıkça SKIP der.
 *
 *  Canlı doğrulama (VPN'liyken kullanıcı): hulya.ozbey@univera → true ·
 *  musteri@doluca → false.
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
let skip = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function skipTest(name, reason) {
  skip++;
  console.log(`⊘ ${name} — SKIP: ${reason}`);
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

const cache = read('server/lib/internalAddressCache.js');
const cacheCode = strip(cache);
const intake = read('server/lib/inboundMailIntake.js');
const intakeCode = strip(intake);

console.log('── 1) Kod: user.findMany doğru şekil ─────────────');
expect('1.1 companies.some join şekli (isActive: true iki katman)',
  /prisma\.user\.findMany\(\{[\s\S]{0,400}where:\s*\{\s*isActive:\s*true,\s*companies:\s*\{\s*some:\s*\{\s*companyId,\s*isActive:\s*true\s*\}\s*\}/.test(cacheCode), true);
expect('1.2 select email',
  /prisma\.user\.findMany\(\{[\s\S]{0,400}select:\s*\{\s*email:\s*true\s*\}/.test(cacheCode), true);
// Regresyon — hatalı sorgu iz KALMAMIŞ
expect('1.3 REGRESYON: eski `where: { companyId }` KALDIRILDI',
  !/prisma\.user\.findMany\(\{\s*where:\s*\{\s*companyId\s*\}/.test(cacheCode), true);

console.log('\n── 2) Fail-open guard — koruma sessiz değil GÜRÜLTÜLÜ ─');
expect('2.1 getInternalAddresses gövdesi try/catch',
  /export async function getInternalAddresses[\s\S]{0,600}try\s*\{[\s\S]{0,400}catch\s*\(err\)/.test(cacheCode), true);
expect('2.2 YÜKSEK SESLE log — console.error + "koruma devre dışı"',
  /console\.error\(\s*'\[internalAddressCache\] BUILD FAIL — koruma devre dışı/.test(cache), true);
expect('2.3 Log context — companyId + code + message',
  /console\.error[\s\S]{0,400}companyId,[\s\S]{0,200}code:\s*err\?\.code,[\s\S]{0,100}message:\s*err\?\.message/.test(cache), true);
expect('2.4 Boş Set döner (fail-open, intake ölmez)',
  /catch\s*\(err\)[\s\S]{0,600}return\s+new\s+Set\(\)/.test(cacheCode), true);
expect('2.5 Cache YAZILMAZ — bir sonraki çağrı yeniden dener (self-healing)',
  /try\s*\{[\s\S]{0,600}_cache\.set\(companyId,[\s\S]{0,400}catch/.test(cacheCode), true);

console.log('\n── 3) Intake caller (~846) yerel try/catch ─────');
expect('3.1 isInternalAddress try/catch ile sarıldı',
  /let\s+senderIsInternal\s*=\s*false;\s*try\s*\{\s*senderIsInternal\s*=\s*await\s+isInternalAddress\(parsed\.from\.email,\s*companyId\)/.test(intakeCode), true);
expect('3.2 catch YÜKSEK SESLE log — F1 devre dışı, akış devam',
  /catch\s*\(err\)\s*\{[\s\S]{0,400}console\.error\(\s*'\[intake\] isInternalAddress THROW — F1 devre dışı, akış devam/.test(intake), true);
expect('3.3 "mail düşürülmez" — catch sonrası akış if(senderIsInternal) ile devam',
  /catch\s*\(err\)[\s\S]{0,600}\}\s*if\s*\(senderIsInternal\)/.test(intake), true);

console.log('\n── 4) Davranış — cache + isInternalAddress semantik ─');

// extractEmail davranış — kaynak dosyanın içeriğini tekrar kullanmadan
// aynı normalize mantığını simüle et.
function extractEmail(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const bracketed = raw.match(/<([^>]+)>/);
  const addr = bracketed ? bracketed[1] : raw;
  const norm = addr.trim().toLowerCase();
  return norm.includes('@') ? norm : null;
}

expect('4.1 "Foo <a@b.com>" → a@b.com',
  extractEmail('Foo <a@b.com>'), 'a@b.com');
expect('4.2 "  A@B.CoM  " → a@b.com (trim + lowercase)',
  extractEmail('  A@B.CoM  '), 'a@b.com');
expect('4.3 email olmayan girdi → null',
  extractEmail('sadece isim'), null);
expect('4.4 null → null',
  extractEmail(null), null);

// isInternalAddress semantik simülasyonu (fail-open olmayan durum)
async function isInternalAddressSim(email, companyId, setBuilder) {
  if (!email || !companyId) return false;
  const norm = email.trim().toLowerCase();
  if (!norm.includes('@')) return false;
  try {
    const set = await setBuilder(companyId);
    return set.has(norm);
  } catch {
    return false;
  }
}

const internalSet = new Set(['hulya.ozbey@univera.com.tr', 'demirhan.isbakan@univera.com.tr']);
// NOT: isInternalAddress trim+lowercase yapar ama "<..>" ayrıştırma YAPMAZ
// (kaynak — server/lib/internalAddressCache.js:isInternalAddress). Caller
// parsed.from.email zaten sade email veriyor. Sim aynı davranışı korur.
const ok = await isInternalAddressSim('hulya.ozbey@univera.com.tr', 'UNIVERA', () => Promise.resolve(internalSet));
expect('4.5 iç adres → true', ok, true);

const ext = await isInternalAddressSim('musteri@doluca.com.tr', 'UNIVERA', () => Promise.resolve(internalSet));
expect('4.6 dış adres → false', ext, false);

const empty = await isInternalAddressSim('', 'UNIVERA', () => Promise.resolve(internalSet));
expect('4.7 boş email → false', empty, false);

const missingCompany = await isInternalAddressSim('a@b.com', '', () => Promise.resolve(internalSet));
expect('4.8 companyId boş → false', missingCompany, false);

// Fail-open davranışı
const failOpen = await isInternalAddressSim('hulya.ozbey@univera.com.tr', 'UNIVERA', () => {
  throw new Error('DB down');
});
expect('4.9 fail-open — throw sırasında false döner (koruma devre dışı ama ölmez)',
  failOpen, false);

console.log('\n── 5) GERÇEK RUNTIME — Prisma sorgusu THROW ETMİYOR mu? ──');

// Kullanıcı direktifi: bu sınıf hatayı ancak gerçek Prisma çağrısı
// yakalar. DATABASE_URL yoksa TEST SKIP (PASS DEMEZ).
if (!process.env.DATABASE_URL) {
  skipTest('5.1 Prisma user.findMany runtime — DATABASE_URL YOK',
    'env DATABASE_URL tanımlı değil; gerçek DB gerekli');
  skipTest('5.2 getInternalAddresses runtime — DATABASE_URL YOK',
    'env DATABASE_URL tanımlı değil');
} else {
  try {
    const { prisma } = await import('../server/db/client.js');
    // Basit connectivity check
    try {
      // Prisma raw query — SELECT 1
      await prisma.$queryRaw`SELECT 1 AS ok`;
    } catch (err) {
      skipTest('5.1 Prisma user.findMany runtime — DB bağlanamadı',
        `${err?.code ?? ''} ${err?.message ?? err}`);
      skipTest('5.2 getInternalAddresses runtime — DB bağlanamadı', 'connect fail');
      throw new Error('__DB_SKIP__');
    }

    // 5.1 — Doğrudan Prisma sorgusunu çalıştır. THROW ETMEZSE geçer.
    // TEST_COMPANY_ID env yoksa herhangi bir Company alıp o companyId
    // ile dene (çok kayıt gerekmez, sorgunun geçerliliği kritik).
    const testCompanyId = process.env.TEST_COMPANY_ID
      ?? (await prisma.company.findFirst({ select: { id: true } }))?.id;
    if (!testCompanyId) {
      skipTest('5.1 Prisma user.findMany runtime — Company tablosunda kayıt yok',
        'TEST_COMPANY_ID env verilebilir');
    } else {
      const users = await prisma.user.findMany({
        where: {
          isActive: true,
          companies: { some: { companyId: testCompanyId, isActive: true } },
        },
        select: { email: true },
      });
      expect('5.1 Prisma user.findMany runtime — THROW ETMEDEN döner (array)',
        Array.isArray(users), true);

      // 5.2 — Cache modülünü import et, gerçek companyId ile çağır.
      // fail-open sarmalayıcı hata olmadan Set döndürmeli.
      const cacheMod = await import('../server/lib/internalAddressCache.js');
      const set = await cacheMod.getInternalAddresses(testCompanyId);
      expect('5.2 getInternalAddresses runtime — Set döner (fail-open THROW YOK)',
        set instanceof Set, true);
    }

    await prisma.$disconnect();
  } catch (err) {
    if (err?.message === '__DB_SKIP__') {
      // zaten SKIP loglandı
    } else {
      fail++;
      console.log(`✗ 5.x runtime harness — beklenmedik hata: ${err?.message ?? err}`);
    }
  }
}

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}  SKIP=${skip}`);

// Codex P2 R1 (2026-07-03): Exit code semantiği — SKIP ≠ PASS.
// Runtime prisma testleri (Section 5) DB gerektiriyor; DATABASE_URL yoksa
// SKIP loglanıyordu ama exit 0 dönerdi → CI/CD hotfix gate "başarılı"
// diye geçirebilirdi. Bu smoke özellikle **gerçek prisma sorgusunu**
// doğrulamak için yazıldı; runtime yapılmadan gate açık geçmesin.
//
// Exit codes:
//   0 = tüm testler PASS, hiç SKIP yok
//   1 = FAIL var
//   2 = FAIL yok ama SKIP > 0 (runtime doğrulaması yapılmadı)
//
// Bilerek atlamak için: node scripts/... --allow-skip (dev workflow'unda
// pattern kontrolleri için hızlı çalıştırma). CI/CD bayrağı KOYMAZ.
if (fail > 0) {
  console.log('❌ FAIL — testler başarısız.');
  process.exit(1);
}
if (skip > 0) {
  const allowSkip = process.argv.includes('--allow-skip');
  if (allowSkip) {
    console.log('⚠️  SKIP > 0 ancak --allow-skip verildi → exit 0 (dev override).');
    process.exit(0);
  }
  console.log('❌ SKIP > 0 → runtime doğrulaması yapılmadı (gate PASS DEĞİL, exit 2).');
  console.log('   Runtime için: DATABASE_URL=... node scripts/smoke-internal-address-cache-hotfix.js');
  console.log('   Dev override:  node scripts/... --allow-skip');
  process.exit(2);
}
console.log('✅ PASS — runtime dahil tüm testler geçti.');
process.exit(0);
