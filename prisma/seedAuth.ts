/**
 * Demo kullanıcı seed — 5 rol × 1 user.
 *
 * Çalıştırma: `npm run db:seed:auth`
 *
 * Akış:
 *  1. Supabase Admin API ile auth.users tablosunda kullanıcı yarat (idempotent)
 *  2. Aynı UUID ile prisma.user satırı yarat (upsert)
 *
 * Demo şifre: Test1234! — production'da MUTLAKA değiştir.
 *
 * Şifre yenilemek istersen: Supabase Dashboard → Authentication → Users →
 * kullanıcı seç → "Send password recovery" ya da admin panelinden direkt yeni
 * şifre at.
 */

import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const prisma = new PrismaClient();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY .env\'de yok.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const DEMO_PASSWORD = 'Test1234!';

// Demo user → Person bridging + Multi-company assignment (Phase 1).
//
// User.personId: Inbox "Ertelendi" gibi "me" filter akışları için Person bağı.
// companies: holding modeli — her demo user belirli şirket(ler)e atanmış.
//   - SystemAdmin'e companies array'i bırakıldı; runtime'da tüm şirketler
//     fetch edilip atanıyor (yeni company eklenince otomatik kapsanır).
//   - CompanyRole enum: Agent | Supervisor | Admin | SystemAdmin (4 değer).
//     CSM/Backoffice gibi sistem rolleri Agent'a indirgenir (per-company yetki).
const DEMO_USERS = [
  {
    email: 'agent@varuna.dev', fullName: 'Demo Agent', role: 'Agent' as const, personId: 'USR-001',
    companies: [{ companyId: 'COMP-PARAM', role: 'Agent' as const }],
  },
  {
    email: 'backoffice@varuna.dev', fullName: 'Demo Backoffice', role: 'Backoffice' as const, personId: 'USR-006',
    companies: [{ companyId: 'COMP-PARAM', role: 'Agent' as const }],
  },
  {
    email: 'supervisor@varuna.dev', fullName: 'Demo Supervisor', role: 'Supervisor' as const, personId: 'USR-002',
    companies: [
      { companyId: 'COMP-PARAM', role: 'Supervisor' as const },
      { companyId: 'COMP-UNIVERA', role: 'Supervisor' as const },
    ],
  },
  {
    email: 'csm@varuna.dev', fullName: 'Demo CSM', role: 'CSM' as const, personId: 'USR-003',
    companies: [{ companyId: 'COMP-PARAM', role: 'Agent' as const }],
  },
  {
    email: 'admin@varuna.dev', fullName: 'Demo Admin', role: 'Admin' as const, personId: 'USR-004',
    companies: [
      { companyId: 'COMP-PARAM', role: 'Admin' as const },
      { companyId: 'COMP-UNIVERA', role: 'Admin' as const },
      { companyId: 'COMP-FINROTA', role: 'Admin' as const },
    ],
  },
  {
    email: 'sysadmin@varuna.dev', fullName: 'Demo SysAdmin', role: 'SystemAdmin' as const, personId: 'USR-005',
    companies: 'ALL' as const, // Runtime'da prisma.company.findMany ile tüm şirketler atanır
  },
];

async function findOrCreateAuthUser(email: string, fullName: string): Promise<string> {
  // Mevcut auth user'ı email ile bul (admin API list + filter)
  const { data: list, error: listErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw new Error(`auth list: ${listErr.message}`);
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    console.log(`  ↻ Mevcut auth user: ${email} (${existing.id})`);
    return existing.id;
  }

  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true, // Demo: doğrulama maili gönderme
    user_metadata: { fullName },
  });
  if (error) throw new Error(`auth create ${email}: ${error.message}`);
  if (!data.user) throw new Error(`auth create ${email}: kullanıcı oluşmadı`);
  console.log(`  ✓ Yeni auth user: ${email} (${data.user.id})`);
  return data.user.id;
}

async function main() {
  console.log('🔐 Demo kullanıcı seed başlıyor...\n');
  console.log(`Şifre (hepsi için): ${DEMO_PASSWORD}\n`);

  for (const u of DEMO_USERS) {
    console.log(`→ ${u.email} (${u.role})`);
    const authId = await findOrCreateAuthUser(u.email, u.fullName);

    // Person guard: tanımlı personId Person tablosunda var mı? Yoksa null bırak
    // (yine de demo personlar seed.ts'ten gelir; eksikse uyarı düş).
    const personExists = u.personId
      ? Boolean(await prisma.person.findUnique({ where: { id: u.personId } }))
      : false;
    if (u.personId && !personExists) {
      console.warn(`  ⚠ Person ${u.personId} bulunamadı — personId null bırakılıyor.`);
    }
    const personId = personExists ? u.personId : null;

    await prisma.user.upsert({
      where: { id: authId },
      update: {
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        isActive: true,
        personId,
      },
      create: {
        id: authId,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        isActive: true,
        personId,
      },
    });
    console.log(`  ✓ User kaydı senkronize edildi${personId ? ` → Person ${personId}` : ''}.`);

    // UserCompany kayıtları — multi-tenant erişim. SystemAdmin için
    // tüm şirketler runtime'da fetch ediliyor (yeni şirket otomatik kapsanır).
    const companyAssignments =
      u.companies === 'ALL'
        ? (await prisma.company.findMany({ where: { isActive: true }, select: { id: true } }))
            .map((c) => ({ companyId: c.id, role: 'SystemAdmin' as const }))
        : u.companies;

    for (const a of companyAssignments) {
      await prisma.userCompany.upsert({
        where: { userId_companyId: { userId: authId, companyId: a.companyId } },
        update: { role: a.role, isActive: true },
        create: { userId: authId, companyId: a.companyId, role: a.role, isActive: true },
      });
    }
    console.log(`  ✓ Şirket atamaları: ${companyAssignments.map((a) => `${a.companyId}/${a.role}`).join(', ')}`);
  }

  console.log('\n✅ Tamamlandı.\n');
  console.log('Giriş için:');
  for (const u of DEMO_USERS) {
    console.log(`  ${u.role.padEnd(11)} → ${u.email} / ${DEMO_PASSWORD}`);
  }
}

main()
  .catch((e) => {
    console.error('\n❌ Seed hatası:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
