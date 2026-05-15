/**
 * Admin invite/deactivate BFF smoke. Supabase'e GERCEKTEN cagri yapmaz —
 * mock client kullanir; sadece userRepo input/output kontratini ve hata
 * yollarini gozler.
 *
 * Calistir: `node --env-file=.env scripts/smoke-admin-invite.js`
 *
 * Mutate: Test sonunda yarattigi DB user'i + UserCompany kaydini siler.
 */

import { prisma } from '../server/db/client.js';
import { userRepo } from '../server/db/adminRepository.js';

const TEST_EMAIL = `invite-smoke-${Date.now()}@varuna.dev`;
const TEST_SUPABASE_ID = `smoke-${Date.now()}`;

function mockSupabase({ shouldFailInvite = false, shouldFailDelete = false } = {}) {
  return {
    auth: {
      admin: {
        async inviteUserByEmail(email, opts) {
          if (shouldFailInvite) {
            return { data: null, error: { status: 500, message: 'mock invite fail' } };
          }
          return { data: { user: { id: TEST_SUPABASE_ID, email } }, error: null };
        },
        async deleteUser(id) {
          if (shouldFailDelete) throw new Error('mock delete fail');
          return { data: null, error: null };
        },
        async signOut(userId, scope) {
          return { data: null, error: null };
        },
      },
    },
  };
}

async function pickCompanyId() {
  const c = await prisma.company.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!c) throw new Error('Aktif şirket yok — seed gerekli.');
  return c.id;
}

async function cleanup() {
  await prisma.userCompany.deleteMany({ where: { userId: TEST_SUPABASE_ID } }).catch(() => {});
  await prisma.user.delete({ where: { id: TEST_SUPABASE_ID } }).catch(() => {});
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
  console.log('=== admin invite/deactivate smoke ===\n');
  await cleanup(); // pre-clean
  const companyId = await pickCompanyId();
  console.log(`Test company: ${companyId}`);

  // --- Validation errors ---
  console.log('\n--- Validation errors ---');
  await expect('bad email', async () => {
    try {
      await userRepo.invite(
        { email: 'not-an-email', role: 'Agent', companyId, companyRole: 'Agent' },
        { supabaseAdmin: mockSupabase(), redirectTo: 'http://x' },
        null,
      );
      throw new Error('beklenen 400 atmadi');
    } catch (e) {
      if (e.status !== 400) throw e;
    }
  });

  await expect('invalid system role (SystemAdmin)', async () => {
    try {
      await userRepo.invite(
        { email: TEST_EMAIL, role: 'SystemAdmin', companyId, companyRole: 'Agent' },
        { supabaseAdmin: mockSupabase(), redirectTo: 'http://x' },
        null,
      );
      throw new Error('beklenen 400 atmadi');
    } catch (e) {
      if (e.status !== 400) throw e;
    }
  });

  await expect('invalid company role', async () => {
    try {
      await userRepo.invite(
        { email: TEST_EMAIL, role: 'Agent', companyId, companyRole: 'NotARole' },
        { supabaseAdmin: mockSupabase(), redirectTo: 'http://x' },
        null,
      );
      throw new Error('beklenen 400 atmadi');
    } catch (e) {
      if (e.status !== 400) throw e;
    }
  });

  await expect('out-of-scope companyId (Admin yetkisiz)', async () => {
    try {
      await userRepo.invite(
        { email: TEST_EMAIL, role: 'Agent', companyId, companyRole: 'Agent' },
        { supabaseAdmin: mockSupabase(), redirectTo: 'http://x' },
        ['some-other-company'],
      );
      throw new Error('beklenen 403 atmadi');
    } catch (e) {
      if (e.status !== 403) throw e;
    }
  });

  // --- Happy path ---
  console.log('\n--- Happy path (mock Supabase) ---');
  let createdUserId;
  await expect('invite happy path', async () => {
    const r = await userRepo.invite(
      { email: TEST_EMAIL, role: 'Agent', companyId, companyRole: 'Agent' },
      { supabaseAdmin: mockSupabase(), redirectTo: 'http://x' },
      null, // SystemAdmin = unlimited scope
    );
    if (!r.success || r.email !== TEST_EMAIL) throw new Error(`shape mismatch: ${JSON.stringify(r)}`);
    createdUserId = r.userId;
    // DB'de gercekten yaratildi mi?
    const dbUser = await prisma.user.findUnique({ where: { id: createdUserId } });
    if (!dbUser) throw new Error('User DB\'ye yazilmadi');
    if (dbUser.fullName !== TEST_EMAIL) throw new Error(`fullName placeholder degil: ${dbUser.fullName}`);
    const uc = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId: createdUserId, companyId } },
    });
    if (!uc || uc.role !== 'Agent') throw new Error('UserCompany yaratilmadi');
  });

  // --- Duplicate email rejection ---
  console.log('\n--- Duplicate rejection ---');
  await expect('e-posta zaten kayitli (409)', async () => {
    try {
      await userRepo.invite(
        { email: TEST_EMAIL, role: 'Agent', companyId, companyRole: 'Agent' },
        { supabaseAdmin: mockSupabase(), redirectTo: 'http://x' },
        null,
      );
      throw new Error('beklenen 409 atmadi');
    } catch (e) {
      if (e.status !== 409) throw e;
    }
  });

  // --- Deactivate ---
  console.log('\n--- Deactivate ---');
  await expect('self-deactivation engellendi', async () => {
    try {
      await userRepo.deactivate(createdUserId, { supabaseAdmin: mockSupabase() }, { id: createdUserId, role: 'Agent' });
      throw new Error('beklenen 400 atmadi');
    } catch (e) {
      if (e.status !== 400) throw e;
    }
  });

  await expect('deactivate happy path', async () => {
    const r = await userRepo.deactivate(
      createdUserId,
      { supabaseAdmin: mockSupabase() },
      { id: 'other-user', role: 'SystemAdmin' },
    );
    if (!r.success) throw new Error('success=false');
    const dbUser = await prisma.user.findUnique({ where: { id: createdUserId } });
    if (dbUser?.isActive !== false) throw new Error('isActive false olmadi');
  });

  await expect('deactivate idempotent', async () => {
    const r = await userRepo.deactivate(
      createdUserId,
      { supabaseAdmin: mockSupabase() },
      { id: 'other-user', role: 'SystemAdmin' },
    );
    if (!r.success) throw new Error('idempotent call basarisiz');
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
