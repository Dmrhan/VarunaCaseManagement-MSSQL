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

const DEMO_USERS = [
  { email: 'agent@varuna.dev',      fullName: 'Demo Agent',      role: 'Agent' as const },
  { email: 'backoffice@varuna.dev', fullName: 'Demo Backoffice', role: 'Backoffice' as const },
  { email: 'supervisor@varuna.dev', fullName: 'Demo Supervisor', role: 'Supervisor' as const },
  { email: 'csm@varuna.dev',        fullName: 'Demo CSM',        role: 'CSM' as const },
  { email: 'admin@varuna.dev',      fullName: 'Demo Admin',      role: 'Admin' as const },
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
    await prisma.user.upsert({
      where: { id: authId },
      update: {
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        isActive: true,
      },
      create: {
        id: authId,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        isActive: true,
      },
    });
    console.log(`  ✓ User kaydı senkronize edildi.`);
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
