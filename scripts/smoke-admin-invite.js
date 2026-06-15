/**
 * Admin kullanıcı yönetimi BFF smoke (Faz 3 — local auth).
 *
 * Eski Supabase-mock'lu invite smoke'unun yerini aldı: userRepo.createUser /
 * resetPassword / deactivate / reactivate kontratlarını ve hata yollarını gözler.
 *
 * Calistir: `node --env-file=.env scripts/smoke-admin-invite.js`
 *
 * Mutate: Test sonunda yarattigi DB user'i + UserCompany kaydini siler.
 */

import bcrypt from 'bcryptjs';
import { prisma } from '../server/db/client.js';
import { userRepo } from '../server/db/adminRepository.js';

const TEST_EMAIL = `create-smoke-${Date.now()}@varuna.dev`;
const TEST_PASSWORD = 'GeciciSifre1!';

async function pickCompanyId() {
  const c = await prisma.company.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!c) throw new Error('Aktif şirket yok — seed gerekli.');
  return c.id;
}

async function cleanup() {
  const u = await prisma.user.findUnique({ where: { email: TEST_EMAIL }, select: { id: true } }).catch(() => null);
  if (u) {
    await prisma.userCompany.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
  }
}

let pass = 0;
let fail = 0;
async function expect(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${label}  →  ${e.message}`);
    fail++;
  }
}

async function main() {
  console.log('=== admin createUser/resetPassword/deactivate smoke ===\n');
  await cleanup(); // pre-clean
  const companyId = await pickCompanyId();
  console.log(`Test company: ${companyId}`);

  // --- Validation errors ---
  console.log('\n--- Validation errors ---');
  await expect('bad email (400)', async () => {
    try {
      await userRepo.createUser(
        { email: 'not-an-email', role: 'Agent', companyId, companyRole: 'Agent', password: TEST_PASSWORD },
        null,
      );
      throw new Error('beklenen 400 atmadi');
    } catch (e) {
      if (e.status !== 400) throw e;
    }
  });

  await expect('invalid system role SystemAdmin (400)', async () => {
    try {
      await userRepo.createUser(
        { email: TEST_EMAIL, role: 'SystemAdmin', companyId, companyRole: 'Agent', password: TEST_PASSWORD },
        null,
      );
      throw new Error('beklenen 400 atmadi');
    } catch (e) {
      if (e.status !== 400) throw e;
    }
  });

  await expect('invalid company role (400)', async () => {
    try {
      await userRepo.createUser(
        { email: TEST_EMAIL, role: 'Agent', companyId, companyRole: 'NotARole', password: TEST_PASSWORD },
        null,
      );
      throw new Error('beklenen 400 atmadi');
    } catch (e) {
      if (e.status !== 400) throw e;
    }
  });

  await expect('kisa sifre (400)', async () => {
    try {
      await userRepo.createUser(
        { email: TEST_EMAIL, role: 'Agent', companyId, companyRole: 'Agent', password: 'kisa' },
        null,
      );
      throw new Error('beklenen 400 atmadi');
    } catch (e) {
      if (e.status !== 400) throw e;
    }
  });

  await expect('out-of-scope companyId (403)', async () => {
    try {
      await userRepo.createUser(
        { email: TEST_EMAIL, role: 'Agent', companyId, companyRole: 'Agent', password: TEST_PASSWORD },
        ['some-other-company'],
      );
      throw new Error('beklenen 403 atmadi');
    } catch (e) {
      if (e.status !== 403) throw e;
    }
  });

  // --- Happy path ---
  console.log('\n--- Happy path ---');
  let createdUserId;
  await expect('createUser happy path', async () => {
    const r = await userRepo.createUser(
      { email: TEST_EMAIL, fullName: 'Smoke Kullanıcı', role: 'Agent', companyId, companyRole: 'Agent', password: TEST_PASSWORD },
      null, // SystemAdmin = unlimited scope
    );
    if (!r.success || r.email !== TEST_EMAIL) throw new Error(`shape mismatch: ${JSON.stringify(r)}`);
    createdUserId = r.userId;
    const dbUser = await prisma.user.findUnique({ where: { id: createdUserId } });
    if (!dbUser) throw new Error("User DB'ye yazilmadi");
    if (dbUser.fullName !== 'Smoke Kullanıcı') throw new Error(`fullName yanlis: ${dbUser.fullName}`);
    if (!dbUser.mustChangePassword) throw new Error('mustChangePassword=true degil');
    if (!dbUser.passwordHash) throw new Error('passwordHash yazilmadi');
    const matches = await bcrypt.compare(TEST_PASSWORD, dbUser.passwordHash);
    if (!matches) throw new Error('passwordHash baslangic sifresiyle eslesmiyor');
    const uc = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId: createdUserId, companyId } },
    });
    if (!uc || uc.role !== 'Agent') throw new Error('UserCompany yaratilmadi');
  });

  // --- Duplicate email rejection ---
  console.log('\n--- Duplicate rejection ---');
  await expect('e-posta zaten kayitli (409)', async () => {
    try {
      await userRepo.createUser(
        { email: TEST_EMAIL, role: 'Agent', companyId, companyRole: 'Agent', password: TEST_PASSWORD },
        null,
      );
      throw new Error('beklenen 409 atmadi');
    } catch (e) {
      if (e.status !== 409) throw e;
    }
  });

  // --- resetPassword ---
  console.log('\n--- resetPassword ---');
  await expect('kendi sifreni resetleyemezsin (400)', async () => {
    try {
      await userRepo.resetPassword(createdUserId, 'YeniSifre2@', { id: createdUserId, role: 'SystemAdmin' });
      throw new Error('beklenen 400 atmadi');
    } catch (e) {
      if (e.status !== 400) throw e;
    }
  });

  await expect('kisa sifre reset (400)', async () => {
    try {
      await userRepo.resetPassword(createdUserId, 'kisa', { id: 'other', role: 'SystemAdmin' });
      throw new Error('beklenen 400 atmadi');
    } catch (e) {
      if (e.status !== 400) throw e;
    }
  });

  await expect('reset happy path (hash degisir, mustChange=true)', async () => {
    // once mustChangePassword'u temizle ki resetin geri actigini gorelim
    await prisma.user.update({ where: { id: createdUserId }, data: { mustChangePassword: false } });
    const before = await prisma.user.findUnique({ where: { id: createdUserId }, select: { passwordHash: true } });
    const r = await userRepo.resetPassword(createdUserId, 'ResetSifre3#', { id: 'other', role: 'SystemAdmin' });
    if (!r.success) throw new Error('success=false');
    const after = await prisma.user.findUnique({ where: { id: createdUserId } });
    if (after.passwordHash === before.passwordHash) throw new Error('hash degismedi');
    if (!after.mustChangePassword) throw new Error('mustChangePassword=true olmadi');
    const matches = await bcrypt.compare('ResetSifre3#', after.passwordHash);
    if (!matches) throw new Error('yeni hash gecici sifreyle eslesmiyor');
  });

  await expect('reset user not found (404)', async () => {
    try {
      await userRepo.resetPassword('non-existent-id', 'ResetSifre3#', { id: 'x', role: 'SystemAdmin' });
      throw new Error('beklenen 404 atmadi');
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  });

  // --- Deactivate ---
  console.log('\n--- Deactivate ---');
  await expect('self-deactivation engellendi', async () => {
    try {
      await userRepo.deactivate(createdUserId, {}, { id: createdUserId, role: 'Agent' });
      throw new Error('beklenen 400 atmadi');
    } catch (e) {
      if (e.status !== 400) throw e;
    }
  });

  await expect('deactivate happy path', async () => {
    const r = await userRepo.deactivate(createdUserId, {}, { id: 'other-user', role: 'SystemAdmin' });
    if (!r.success) throw new Error('success=false');
    const dbUser = await prisma.user.findUnique({ where: { id: createdUserId } });
    if (dbUser?.isActive !== false) throw new Error('isActive false olmadi');
  });

  await expect('deactivate idempotent', async () => {
    const r = await userRepo.deactivate(createdUserId, {}, { id: 'other-user', role: 'SystemAdmin' });
    if (!r.success) throw new Error('idempotent call basarisiz');
  });

  await expect('pasif kullaniciya reset (400)', async () => {
    try {
      await userRepo.resetPassword(createdUserId, 'ResetSifre3#', { id: 'other', role: 'SystemAdmin' });
      throw new Error('beklenen 400 atmadi');
    } catch (e) {
      if (e.status !== 400) throw e;
    }
  });

  // --- Reactivate ---
  console.log('\n--- Reactivate ---');
  await expect('reactivate happy path', async () => {
    const r = await userRepo.reactivate(createdUserId, {}, { id: 'other-user', role: 'SystemAdmin' });
    if (!r.success) throw new Error('success=false');
    const dbUser = await prisma.user.findUnique({ where: { id: createdUserId } });
    if (dbUser?.isActive !== true) throw new Error('isActive true olmadi');
  });
  await expect('reactivate idempotent (zaten aktif)', async () => {
    const r = await userRepo.reactivate(createdUserId, {}, { id: 'other-user', role: 'SystemAdmin' });
    if (!r.success) throw new Error('idempotent call basarisiz');
  });
  await expect('reactivate user not found (404)', async () => {
    try {
      await userRepo.reactivate('non-existent-id', {}, { id: 'x', role: 'SystemAdmin' });
      throw new Error('beklenen 404 atmadi');
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  });

  // Cleanup
  console.log('\n--- Cleanup ---');
  await cleanup();
  console.log('  ✓ test verisi temizlendi');

  console.log(`\n=== ${pass}/${pass + fail} passed ${fail > 0 ? '(BAZILARI BASARISIZ)' : ''} ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('FAIL:', e);
  await cleanup();
  process.exit(1);
});
