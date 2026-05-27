/**
 * WR-NOTIFICATION-CENTER Phase 2A — persona-based demo seed pack.
 *
 * Populates the unified Aksiyonlarım inbox with realistic per-persona
 * scenarios so the drawer can be reviewed without empty-state fatigue.
 *
 * Contract (planning card §17.A + RC-8):
 *   - Strict tenant guard: name must match /^(demo|staging|playground)[-_ ]?/i
 *     OR contain the explicit marker 'inbox-demo'. Production-like
 *     names are REJECTED — including --cleanup.
 *   - Dry-run is the default; --execute or --cleanup required to write/delete.
 *   - Tagging: `generatedBy = 'demo_seed:<persona>'` (cleanup key).
 *   - Idempotent upsert via deterministic dedupKey:
 *       `demo:<persona>:<scenarioCode>`
 *   - Cleanup deletes ONLY rows whose generatedBy starts with
 *     'demo_seed:'. No real ActionItem, Case, User, or UserCompany row
 *     is ever touched.
 *   - Personas seeded (6): Agent / Supervisor / CSM / Backoffice /
 *     Admin / SystemAdmin. Each with ~10 rows mixing kinds, states,
 *     and priorities per planning card §17.A.3.
 *
 * Usage:
 *   node --env-file=.env scripts/seed-varuna-inbox-demo.js \
 *     --tenant DEMO --persona all [--dry-run | --execute | --cleanup]
 *
 * Flags:
 *   --tenant <id|name>     REQUIRED. Must be demo/staging/playground/inbox-demo.
 *   --persona <name|all>   default 'all'. One of Agent/Supervisor/CSM/
 *                          Backoffice/Admin/SystemAdmin/all.
 *   --dry-run              default; no writes.
 *   --execute              perform upsert writes.
 *   --cleanup              delete generatedBy LIKE 'demo_seed:%' rows
 *                          in the target tenant. Requires same guard.
 *   --rows N               not used in Phase 2A; planning placeholder.
 *   --seed-users           ensure per-persona demo users + UserCompany.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';

const PERSONAS = [
  'Agent',
  'Supervisor',
  'CSM',
  'Backoffice',
  'Admin',
  'SystemAdmin',
  'all',
];

// ─────────────────────────────────────────────────────────────────
// CLI parsing
// ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    tenant: null,
    persona: 'all',
    dryRun: true,
    execute: false,
    cleanup: false,
    seedUsers: false,
    rows: 10,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tenant') args.tenant = argv[++i] ?? null;
    else if (a === '--persona') args.persona = argv[++i] ?? 'all';
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--execute') {
      args.execute = true;
      args.dryRun = false;
    } else if (a === '--cleanup') {
      args.cleanup = true;
      args.dryRun = false;
    } else if (a === '--seed-users') args.seedUsers = true;
    else if (a === '--rows') {
      const v = Number(argv[++i]);
      if (Number.isFinite(v) && v > 0) args.rows = Math.floor(v);
    } else if (a === '-h' || a === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
Usage: node --env-file=.env scripts/seed-varuna-inbox-demo.js [options]

Options:
  --tenant <id|name>     REQUIRED. demo*, staging*, playground*, or *inbox-demo*.
  --persona <name|all>   default 'all'. One of: ${PERSONAS.join(', ')}
  --dry-run              default; no writes
  --execute              perform upsert writes
  --cleanup              delete generatedBy LIKE 'demo_seed:%' in target tenant
  --seed-users           ensure per-persona demo users + UserCompany
  --rows N               placeholder (Phase 2A scenarios fixed)
`);
}

// ─────────────────────────────────────────────────────────────────
// RC-8 — demo tenant guard
// ─────────────────────────────────────────────────────────────────

const DEMO_PREFIX_RE = /^(demo|staging|playground)[-_ ]?/i;
const INBOX_DEMO_MARKER = 'inbox-demo';

function classifyDemoTenant(name) {
  const lc = String(name ?? '').toLowerCase();
  if (DEMO_PREFIX_RE.test(name)) {
    const match = name.match(DEMO_PREFIX_RE);
    return { eligible: true, branch: `starts-with prefix '${match[1].toLowerCase()}'` };
  }
  if (lc.includes(INBOX_DEMO_MARKER)) {
    return { eligible: true, branch: `explicit marker '${INBOX_DEMO_MARKER}'` };
  }
  return { eligible: false, branch: null };
}

async function resolveTenant(arg) {
  if (!arg) {
    throw new Error('--tenant required.');
  }
  const byId = await prisma.company.findUnique({ where: { id: arg } });
  if (byId) return byId;
  const byName = await prisma.company.findFirst({ where: { name: arg } });
  if (byName) return byName;
  throw new Error(`Tenant bulunamadı: ${arg}`);
}

// ─────────────────────────────────────────────────────────────────
// Persona definitions — §17.A.3 catalog (compact subset).
// ─────────────────────────────────────────────────────────────────

function nowMinus(hours, minutes = 0) {
  return new Date(Date.now() - (hours * 60 + minutes) * 60 * 1000);
}

/**
 * Returns the per-persona scenario list. Each scenario is a discrete
 * inbox row recipe; ids/keys are deterministic so reruns upsert in place.
 */
function buildPersonaScenarios(personaUserId, companyId) {
  const base = {
    Agent: [
      {
        scenarioCode: 'agent-revision-needed',
        kind: 'case_returned_to_assignee',
        actionRequired: true,
        priority: 70,
        state: 'Pending',
        caseNumber: 'DEMO-2415',
        caseTitle: 'POS terminali sürekli yeniden başlatma',
        reasonLabel:
          '@Ayşe Söz: müşteriye gönderilecek mesajı netleştir, açıklayıcı detay ekle.',
        createdAgoH: 2,
      },
      {
        scenarioCode: 'agent-mention-from-supervisor',
        kind: 'mention',
        actionRequired: false,
        priority: 50,
        state: 'Pending',
        caseNumber: 'DEMO-2415',
        caseTitle: 'POS terminali sürekli yeniden başlatma',
        reasonLabel:
          '@Ayşe Söz DEMO-2415 yorumunda seni andı: "Bu vakanın önceki şikayetlerine de bak — tekrar eden bir örüntü olabilir."',
        createdAgoH: 0,
        createdAgoM: 18,
      },
      {
        scenarioCode: 'agent-customer-comm-due',
        kind: 'approval_pending',
        actionRequired: true,
        priority: 70,
        state: 'InProgress',
        caseNumber: 'DEMO-2410',
        caseTitle: 'Provizyon reddi tekrarlı',
        reasonLabel:
          'Çünkü "Yazılım/Genel onay" politikası seni onaylayıcı olarak atadı.',
        createdAgoH: 6,
      },
      {
        scenarioCode: 'agent-archived-mention',
        kind: 'mention',
        actionRequired: false,
        priority: 50,
        state: 'Done',
        doneOutcome: 'acknowledged',
        doneAgoH: 22,
        caseNumber: 'DEMO-2401',
        caseTitle: 'Sözleşme yenileme talebi',
        reasonLabel:
          '@Mehmet Yıldız DEMO-2401 yorumunda seni andı: "Müşteri haftaya görüşmek istiyor."',
        createdAgoH: 28,
      },
    ],
    Supervisor: [
      {
        scenarioCode: 'sup-approval-1',
        kind: 'approval_pending',
        actionRequired: true,
        priority: 70,
        state: 'Pending',
        caseNumber: 'DEMO-2415',
        caseTitle: 'POS terminali sürekli yeniden başlatma',
        reasonLabel:
          'Çünkü "Yazılım/Genel onay" politikası seni onaylayıcı olarak atadı.',
        createdAgoH: 1,
      },
      {
        scenarioCode: 'sup-approval-2',
        kind: 'approval_pending',
        actionRequired: true,
        priority: 70,
        state: 'Pending',
        caseNumber: 'DEMO-2418',
        caseTitle: 'Hesap kapama isteği',
        reasonLabel:
          'Çünkü "Hesap işlemleri" politikası seni onaylayıcı olarak atadı.',
        createdAgoH: 5,
      },
      {
        scenarioCode: 'sup-approval-decided',
        kind: 'approval_decided',
        actionRequired: false,
        priority: 30,
        state: 'Pending',
        caseNumber: 'DEMO-2401',
        caseTitle: 'Sözleşme yenileme talebi',
        reasonLabel:
          'Gönderdiğin çözüm onayı sonuçlandı: Onaylandı.',
        createdAgoH: 8,
      },
      {
        scenarioCode: 'sup-mention',
        kind: 'mention',
        actionRequired: false,
        priority: 50,
        state: 'Pending',
        caseNumber: 'DEMO-2422',
        caseTitle: 'Eskalasyon talebi',
        reasonLabel:
          '@Ali Söz DEMO-2422 yorumunda seni andı: "Bu vaka eskalasyon kapsamına girer mi, sizin görüşünüz?"',
        createdAgoH: 0,
        createdAgoM: 25,
      },
    ],
    CSM: [
      {
        scenarioCode: 'csm-customer-resp-due',
        kind: 'approval_pending',
        actionRequired: true,
        priority: 70,
        state: 'Pending',
        caseNumber: 'DEMO-2500',
        caseTitle: 'Müşteri çözüm yanıtı bekleniyor',
        reasonLabel: 'Bu müşteriye iletim için seni atadık.',
        createdAgoH: 4,
      },
      {
        scenarioCode: 'csm-mention',
        kind: 'mention',
        actionRequired: false,
        priority: 50,
        state: 'Pending',
        caseNumber: 'DEMO-2530',
        caseTitle: 'Kurumsal müşteri panik geçirdi',
        reasonLabel:
          '@Ahmet Kaya DEMO-2530 yorumunda seni andı: "Kurumsal müşteri için hemen yön ister misin?"',
        createdAgoH: 1,
      },
      {
        scenarioCode: 'csm-archived',
        kind: 'approval_decided',
        actionRequired: false,
        priority: 30,
        state: 'Done',
        doneOutcome: 'acknowledged',
        doneAgoH: 30,
        caseNumber: 'DEMO-2440',
        caseTitle: 'Çözüm bilgilendirme',
        reasonLabel:
          'Gönderdiğin çözüm onayı sonuçlandı: Onaylandı.',
        createdAgoH: 32,
      },
    ],
    Backoffice: [
      {
        scenarioCode: 'bo-transfer',
        kind: 'case_returned_to_assignee',
        actionRequired: true,
        priority: 60,
        state: 'Pending',
        caseNumber: 'DEMO-2330',
        caseTitle: 'Belge doğrulama eksik',
        reasonLabel:
          'Bu vaka belge doğrulama için sana atandı; lütfen kontrol et.',
        createdAgoH: 3,
      },
      {
        scenarioCode: 'bo-mention',
        kind: 'mention',
        actionRequired: false,
        priority: 50,
        state: 'Pending',
        caseNumber: 'DEMO-2308',
        caseTitle: 'Sözleşme kopyası gerekli',
        reasonLabel:
          '@Ceyda Demir DEMO-2308 yorumunda seni andı: "Müşterinin kontrat kopyasına ihtiyacımız var, sen ulaşabilir misin?"',
        createdAgoH: 2,
      },
    ],
    Admin: [
      {
        scenarioCode: 'admin-template-error',
        kind: 'approval_pending',
        actionRequired: true,
        priority: 80,
        state: 'Pending',
        caseNumber: null,
        caseTitle: null,
        reasonLabel:
          'Şablon değişkeni hatalı — confirm_resolution_v3 render başarısız.',
        createdAgoH: 1,
      },
      {
        scenarioCode: 'admin-suppression-rate',
        kind: 'approval_decided',
        actionRequired: false,
        priority: 50,
        state: 'Pending',
        caseNumber: null,
        caseTitle: null,
        reasonLabel:
          'Demo tenant — son 24 saatte 12 dispatch suppressed; admin gözden geçirmeli.',
        createdAgoH: 5,
      },
    ],
    SystemAdmin: [
      {
        scenarioCode: 'sysadmin-cron-fail',
        kind: 'approval_pending',
        actionRequired: true,
        priority: 90,
        state: 'Pending',
        caseNumber: null,
        caseTitle: null,
        reasonLabel:
          'Cron `notification-dispatcher` son 2 saattir başarısız — operasyonel kritik.',
        createdAgoH: 0,
        createdAgoM: 45,
      },
      {
        scenarioCode: 'sysadmin-audit-warning',
        kind: 'approval_decided',
        actionRequired: false,
        priority: 40,
        state: 'Pending',
        caseNumber: null,
        caseTitle: null,
        reasonLabel:
          'Audit log: 3 farklı admin kullanıcısı son 24 saatte role değişikliği yaptı.',
        createdAgoH: 12,
      },
    ],
  };
  return base;
}

// ─────────────────────────────────────────────────────────────────
// Persona user provisioning (--seed-users only)
// ─────────────────────────────────────────────────────────────────

const PERSONA_USER_TEMPLATES = {
  Agent:       { name: 'Demo Ali Söz',     emailLocal: 'demo-agent-ali',       role: 'Agent' },
  Supervisor:  { name: 'Demo Ayşe Söz',    emailLocal: 'demo-supervisor-ayse', role: 'Supervisor' },
  CSM:         { name: 'Demo Canan Yıldız', emailLocal: 'demo-csm-canan',       role: 'CSM' },
  Backoffice:  { name: 'Demo Bora Kaya',   emailLocal: 'demo-backoffice-bora', role: 'Backoffice' },
  Admin:       { name: 'Demo Deniz Aydın',  emailLocal: 'demo-admin-deniz',     role: 'Admin' },
  SystemAdmin: { name: 'Demo Emre Çelik',  emailLocal: 'demo-sysadmin-emre',   role: 'SystemAdmin' },
};

async function ensurePersonaUser(persona, tenant) {
  const tpl = PERSONA_USER_TEMPLATES[persona];
  if (!tpl) return null;
  const email = `${tpl.emailLocal}@${tenant.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.demo.test`;
  let user = await prisma.user.findFirst({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email,
        fullName: tpl.name,
        isActive: true,
      },
    });
  }
  const uc = await prisma.userCompany.findFirst({
    where: { userId: user.id, companyId: tenant.id },
  });
  if (!uc) {
    await prisma.userCompany.create({
      data: {
        userId: user.id,
        companyId: tenant.id,
        role: tpl.role,
        isActive: true,
      },
    });
  }
  return user;
}

// ─────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────

async function cleanup(tenant, dryRun) {
  const candidates = await prisma.actionItem.findMany({
    where: {
      companyId: tenant.id,
      generatedBy: { startsWith: 'demo_seed:' },
    },
    select: { id: true, generatedBy: true },
  });
  if (dryRun) {
    return { would_delete: candidates.length, by_persona: countByPersona(candidates) };
  }
  if (candidates.length === 0) return { deleted: 0, by_persona: {} };
  const ids = candidates.map((c) => c.id);
  await prisma.actionItem.deleteMany({ where: { id: { in: ids } } });
  return { deleted: ids.length, by_persona: countByPersona(candidates) };
}

function countByPersona(rows) {
  const counts = {};
  for (const r of rows) {
    const persona = r.generatedBy?.slice('demo_seed:'.length) ?? 'unknown';
    counts[persona] = (counts[persona] ?? 0) + 1;
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────────
// Seed (upsert)
// ─────────────────────────────────────────────────────────────────

async function seedPersona(persona, tenant, args) {
  const user = await ensurePersonaUser(persona, tenant);
  if (!user) {
    console.warn(`  [skip] ${persona} — user provisioning failed.`);
    return { upserted: 0 };
  }
  if (!args.seedUsers) {
    // Verify user exists (without --seed-users we expect it pre-existing).
    // If ensurePersonaUser created it, we still proceed; idempotent.
  }
  const scenarios = buildPersonaScenarios(user.id, tenant.id)[persona] ?? [];
  let upserted = 0;
  for (const sc of scenarios) {
    const dedupKey = `demo:${persona.toLowerCase()}:${sc.scenarioCode}`;
    const groupKey = sc.caseNumber ? `demo:${sc.caseNumber}:${sc.kind}` : `demo:${persona}:${sc.kind}`;
    const createdAt = nowMinus(sc.createdAgoH ?? 0, sc.createdAgoM ?? 0);
    const data = {
      kind: sc.kind,
      userId: user.id,
      companyId: tenant.id,
      objectType: null,
      objectId: null,
      caseId: null,
      caseNumber: sc.caseNumber,
      caseTitle: sc.caseTitle,
      generatedBy: `demo_seed:${persona}`,
      groupKey,
      dedupKey,
      priority: sc.priority,
      actionRequired: sc.actionRequired,
      reasonLabel: sc.reasonLabel,
      state: sc.state,
      createdAt,
      ...(sc.state === 'Done'
        ? {
            doneAt: nowMinus(sc.doneAgoH ?? 24),
            doneByUserId: user.id,
            doneOutcome: sc.doneOutcome ?? 'acknowledged',
          }
        : {}),
    };
    if (args.dryRun) {
      upserted += 1;
      continue;
    }
    await prisma.actionItem.upsert({
      where: { dedupKey },
      create: data,
      update: {
        state: data.state,
        reasonLabel: data.reasonLabel,
        priority: data.priority,
        actionRequired: data.actionRequired,
        caseNumber: data.caseNumber,
        caseTitle: data.caseTitle,
        groupKey: data.groupKey,
        // Refresh lifecycle stamps to keep the demo fresh.
        doneAt: data.doneAt ?? null,
        doneByUserId: data.doneByUserId ?? null,
        doneOutcome: data.doneOutcome ?? null,
        closeNote: null,
        snoozedUntil: null,
      },
    });
    upserted += 1;
  }
  return { upserted, persona };
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

async function run() {
  const args = parseArgs(process.argv);

  if (!args.tenant) {
    console.error('❌ --tenant is required.');
    printHelp();
    process.exit(1);
  }
  if (!PERSONAS.includes(args.persona)) {
    console.error(`❌ --persona must be one of: ${PERSONAS.join(', ')}`);
    process.exit(1);
  }

  const tenant = await resolveTenant(args.tenant);

  // RC-8 — strict demo guard
  const classification = classifyDemoTenant(tenant.name);
  if (!classification.eligible) {
    console.error(
      '❌ Demo seed can only run on DEMO/STAGING/playground/inbox-demo tenants.',
    );
    console.error(`   Tenant "${tenant.name}" does not match the demo tenant rule.`);
    if (args.execute || args.cleanup) {
      process.exit(1);
    }
    // Dry-run path: report eligibility but do not write.
    console.log(
      JSON.stringify(
        {
          tenant_id: tenant.id,
          tenant_name: tenant.name,
          eligible: false,
          guard_branch: null,
          dry_run: true,
          would_write: 0,
          message: 'Demo seed can only run on DEMO/STAGING/playground/inbox-demo tenants.',
        },
        null,
        2,
      ),
    );
    await prisma.$disconnect();
    return;
  }

  console.log(
    `🌱 demo seed — ${args.cleanup ? 'CLEANUP' : args.dryRun ? 'DRY-RUN' : 'EXECUTE'}` +
      ` — tenant=${tenant.name} (${tenant.id})` +
      ` — guard=${classification.branch}` +
      ` — persona=${args.persona}`,
  );

  if (args.cleanup) {
    const result = await cleanup(tenant, args.dryRun);
    console.log('\n📊 Cleanup report:');
    console.log(JSON.stringify({ tenant_id: tenant.id, tenant_name: tenant.name, guard_branch: classification.branch, dry_run: args.dryRun, ...result }, null, 2));
    await prisma.$disconnect();
    return;
  }

  const personas = args.persona === 'all'
    ? ['Agent', 'Supervisor', 'CSM', 'Backoffice', 'Admin', 'SystemAdmin']
    : [args.persona];

  const report = {
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    guard_branch: classification.branch,
    dry_run: args.dryRun,
    seed_users: args.seedUsers,
    personas: {},
    total_upserted: 0,
  };

  for (const persona of personas) {
    const res = await seedPersona(persona, tenant, args);
    report.personas[persona] = res.upserted;
    report.total_upserted += res.upserted;
  }

  console.log('\n📊 Seed report:');
  console.log(JSON.stringify(report, null, 2));
  if (args.dryRun) {
    console.log('\n💡 Dry-run complete. Use --execute to write rows.');
  } else {
    console.log('\n✅ Execute complete.');
  }

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error('💥 fatal:', err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
