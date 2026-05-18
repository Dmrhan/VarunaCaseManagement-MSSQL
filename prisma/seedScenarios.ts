/**
 * Scenario seed — enterprise demo/test workflow data.
 *
 * Çalıştırma: `npm run db:seed:scenarios`
 *
 * Hedef: PM/QA + demo izleyicileri için gerçekçi senaryo verisi:
 *  - 3 şirket (Univera FMCG, Finrota SMB finance, PARAM fintech)
 *  - Şirkete özel müşteriler, ürün grupları
 *  - Watcher + Notification flow
 *  - Linked cases (Related, Duplicate, Parent/Child)
 *  - Note reply + reaction flow
 *  - AI Status Report timeline
 *  - Customer Pulse (zengin geçmiş)
 *  - Multi-tenant isolation (aynı isim 3 şirkette)
 *
 * Idempotent: Stable ID + caseNumber kullanır; prisma upsert / find-or-create
 * pattern'i ile tekrar çalıştırıldığında çoğaltma yapmaz.
 *
 * GÜVENLİK: Sadece local/demo/sandbox DB'lerde çalıştırın.
 * Production'da ASLA çalıştırmayın (gerçek müşteri verisi etkilenir).
 * package.json'da prod migrate'den ayrı script (db:seed:scenarios).
 */

import { PrismaClient } from '@prisma/client';
import {
  CasePriority,
  CaseRequestType,
  CaseStatus,
  CaseType,
  CaseOrigin,
  EscalationLevel,
} from '@prisma/client';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────
// Sabitler
// ─────────────────────────────────────────────────────────────────

const COMPANY = {
  UNIVERA: { id: 'COMP-UNIVERA', name: 'UNIVERA' },
  FINROTA: { id: 'COMP-FINROTA', name: 'FINROTA' },
  PARAM: { id: 'COMP-PARAM', name: 'PARAM' },
};

// seedAuth'taki demo persona id'leri — User.id ile aynı.
const USER = {
  AGENT: 'USR-001',
  SUPERVISOR: 'USR-002',
  CSM: 'USR-003',
  ADMIN: 'USR-004',
  SYSADMIN: 'USR-005',
  BACKOFFICE: 'USR-006',
};

// ─────────────────────────────────────────────────────────────────
// Müşteri (Account) tanımları — şirket bazlı + multi-tenant izolasyon
// ─────────────────────────────────────────────────────────────────
type DemoAccount = {
  id: string;
  name: string;
  companyId: string;
  email?: string;
  phone?: string;
};

const ACCOUNTS: DemoAccount[] = [
  // Univera FMCG
  { id: 'DEMO-ACC-UNI-001', name: 'Akar Gıda Dağıtım A.Ş.',          companyId: COMPANY.UNIVERA.id, email: 'destek@akargida.demo',   phone: '+90 212 555 1001' },
  { id: 'DEMO-ACC-UNI-002', name: 'Doğa Lojistik Saha Satış',         companyId: COMPANY.UNIVERA.id, email: 'ops@dogalojistik.demo',  phone: '+90 232 555 1002' },
  { id: 'DEMO-ACC-UNI-003', name: 'Mavi Soğuk Zincir Ltd.',           companyId: COMPANY.UNIVERA.id, email: 'depo@mavizincir.demo',   phone: '+90 224 555 1003' },
  { id: 'DEMO-ACC-UNI-004', name: 'Anadolu Distribütörler Birliği',   companyId: COMPANY.UNIVERA.id, email: 'rota@anadolu-dis.demo',  phone: '+90 322 555 1004' },

  // Finrota SMB Finance
  { id: 'DEMO-ACC-FIN-001', name: 'Kemal Mali Müşavirlik',            companyId: COMPANY.FINROTA.id, email: 'destek@kmm.demo',         phone: '+90 216 555 2001' },
  { id: 'DEMO-ACC-FIN-002', name: 'Atlas Pazarlama Tic. Ltd.',        companyId: COMPANY.FINROTA.id, email: 'finans@atlaspazar.demo',  phone: '+90 312 555 2002' },
  { id: 'DEMO-ACC-FIN-003', name: 'Yıldız Eczanesi',                  companyId: COMPANY.FINROTA.id, email: 'yildiz@eczane.demo',      phone: '+90 232 555 2003' },
  { id: 'DEMO-ACC-FIN-004', name: 'Doğu Otomotiv Bayi',               companyId: COMPANY.FINROTA.id, email: 'bayi@doguoto.demo',       phone: '+90 442 555 2004' },

  // PARAM Fintech
  { id: 'DEMO-ACC-PAR-001', name: 'Sancaktepe Market Zinciri',        companyId: COMPANY.PARAM.id,   email: 'pos@sancakmarket.demo',   phone: '+90 216 555 3001' },
  { id: 'DEMO-ACC-PAR-002', name: 'GnG Online Mağaza',                companyId: COMPANY.PARAM.id,   email: 'sanal@gngonline.demo',    phone: '+90 212 555 3002' },
  { id: 'DEMO-ACC-PAR-003', name: 'İstanbul Restoranlar Bayi Grubu',  companyId: COMPANY.PARAM.id,   email: 'pos@istrest.demo',        phone: '+90 212 555 3003' },
  { id: 'DEMO-ACC-PAR-004', name: 'Anadolu Bankamatik Hizmetleri',    companyId: COMPANY.PARAM.id,   email: 'ops@anadolubam.demo',     phone: '+90 312 555 3004' },

  // Multi-tenant isolation test — aynı isim, 3 ayrı şirket.
  // UI/API'da bunların cross-tenant görünmemesi gerekir.
  { id: 'DEMO-ACC-MT-UNI', name: 'Multi-Tenant Test Müşterisi', companyId: COMPANY.UNIVERA.id, email: 'mt@univera.demo', phone: '+90 212 555 9001' },
  { id: 'DEMO-ACC-MT-FIN', name: 'Multi-Tenant Test Müşterisi', companyId: COMPANY.FINROTA.id, email: 'mt@finrota.demo', phone: '+90 212 555 9002' },
  { id: 'DEMO-ACC-MT-PAR', name: 'Multi-Tenant Test Müşterisi', companyId: COMPANY.PARAM.id,   email: 'mt@param.demo',   phone: '+90 212 555 9003' },
];

// ─────────────────────────────────────────────────────────────────
// Vaka şablonları — caseNumber stable (DEMO- prefix), upsert için.
// ─────────────────────────────────────────────────────────────────
type DemoCase = {
  caseNumber: string;
  title: string;
  description: string;
  caseType: CaseType;
  status: CaseStatus;
  priority: CasePriority;
  origin: CaseOrigin;
  category: string;
  subCategory: string;
  requestType: CaseRequestType;
  productGroup?: string;
  accountId: string;
  companyId: string;
  companyName: string;
  accountName: string;
  assignedTeamId?: string;
  assignedTeamName?: string;
  assignedPersonId?: string;
  assignedPersonName?: string;
  escalationLevel?: EscalationLevel;
  slaViolation?: boolean;
  /** scenario notları için tag (raporlama amaçlı). */
  scenarioTag?: string;
};

function univeraCase(partial: Partial<DemoCase> & Pick<DemoCase, 'caseNumber' | 'title' | 'description' | 'accountId' | 'accountName'>): DemoCase {
  return {
    caseType: 'GeneralSupport',
    status: 'Acik',
    priority: 'High',
    origin: 'Eposta',
    category: 'Yazılım',
    subCategory: 'Entegrasyon',
    requestType: 'Hata',
    productGroup: 'Enroute',
    companyId: COMPANY.UNIVERA.id,
    companyName: COMPANY.UNIVERA.name,
    assignedTeamId: 'TEAM-DESTEK',
    assignedTeamName: 'Destek Takımı',
    ...partial,
  } as DemoCase;
}
function finrotaCase(partial: Partial<DemoCase> & Pick<DemoCase, 'caseNumber' | 'title' | 'description' | 'accountId' | 'accountName'>): DemoCase {
  return {
    caseType: 'GeneralSupport',
    status: 'Acik',
    priority: 'High',
    origin: 'Telefon',
    category: 'Yazılım',
    subCategory: 'Performans',
    requestType: 'Hata',
    productGroup: 'Netahsilat',
    companyId: COMPANY.FINROTA.id,
    companyName: COMPANY.FINROTA.name,
    assignedTeamId: 'TEAM-FINANS',
    assignedTeamName: 'Finans Takımı',
    ...partial,
  } as DemoCase;
}
function paramCase(partial: Partial<DemoCase> & Pick<DemoCase, 'caseNumber' | 'title' | 'description' | 'accountId' | 'accountName'>): DemoCase {
  return {
    caseType: 'GeneralSupport',
    status: 'Acik',
    priority: 'Critical',
    origin: 'Telefon',
    category: 'Yazılım',
    subCategory: 'Entegrasyon',
    requestType: 'Hata',
    productGroup: 'Sanal POS',
    companyId: COMPANY.PARAM.id,
    companyName: COMPANY.PARAM.name,
    assignedTeamId: 'TEAM-DESTEK',
    assignedTeamName: 'Destek Takımı',
    ...partial,
  } as DemoCase;
}

const CASES: DemoCase[] = [
  // ───── Univera FMCG ─────
  univeraCase({
    caseNumber: 'DEMO-UNI-001',
    title: 'Enroute rota senkronizasyonu sahaya yansımıyor',
    description: 'Distribütör saha satış temsilcilerinin mobil cihazlarında günün rotası eksik geliyor. Backend export sorunsuz ama mobil app güncel rotayı çekmiyor. Pazartesi sabahı 14 araç etkilendi.',
    accountId: 'DEMO-ACC-UNI-001',
    accountName: 'Akar Gıda Dağıtım A.Ş.',
    productGroup: 'Enroute',
    scenarioTag: 'watcher',
  }),
  univeraCase({
    caseNumber: 'DEMO-UNI-002',
    title: 'Stokbar depo ile mobil sayım uyuşmazlığı',
    description: 'Stokbar üzerinde merkez depo stoğu ile soğuk zincir aracında okunan mobil sayım %12 farklı. WMS export logları temiz, mobil sync gecikmesi şüpheli.',
    accountId: 'DEMO-ACC-UNI-003',
    accountName: 'Mavi Soğuk Zincir Ltd.',
    productGroup: 'Stokbar',
    priority: 'Critical',
    status: 'Eskalasyon',
    escalationLevel: 'TakimLideri',
    slaViolation: true,
    scenarioTag: 'pulse-escalated',
  }),
  univeraCase({
    caseNumber: 'DEMO-UNI-003',
    title: 'Quest ziyaret planı önemli müşteride yüklenmiyor',
    description: 'Quest mobil tarafında key account ekibinin ziyaret planı boş geliyor. CRM tarafı senkron tetiklenmiş ama plan çekilmemiş. Sales direktörü iletti.',
    accountId: 'DEMO-ACC-UNI-002',
    accountName: 'Doğa Lojistik Saha Satış',
    productGroup: 'Quest',
    scenarioTag: 'note-reply',
  }),
  // Parent + Child (Linked Cases scenario)
  univeraCase({
    caseNumber: 'DEMO-UNI-PARENT-001',
    title: 'Ülke geneli FMCG rota planlama kesintisi',
    description: 'Enroute rota optimizasyon servisi sabah 04:00 itibarıyla yanıt vermiyor. Bağlı distribütör vakaları çocuk olarak buraya bağlanıyor.',
    accountId: 'DEMO-ACC-UNI-004',
    accountName: 'Anadolu Distribütörler Birliği',
    productGroup: 'Enroute',
    priority: 'Critical',
    status: 'Incelemede',
    scenarioTag: 'linked-parent',
  }),
  univeraCase({
    caseNumber: 'DEMO-UNI-CHILD-001',
    title: 'Marmara bölgesi distribütör — rota planı yok',
    description: 'Marmara bölgesi 4 distribütör için günün rota planı oluşmadı. Genel kesintinin (DEMO-UNI-PARENT-001) bölgesel yansıması.',
    accountId: 'DEMO-ACC-UNI-001',
    accountName: 'Akar Gıda Dağıtım A.Ş.',
    productGroup: 'Enroute',
    scenarioTag: 'linked-child',
  }),
  univeraCase({
    caseNumber: 'DEMO-UNI-CHILD-002',
    title: 'Ege bölgesi rota gecikmesi — Enroute',
    description: 'Ege bölgesi distribütörlerinde rota geç oluşturuldu, sahaya saat 09:30 itibarıyla ulaştı. Genel kesinti kapsamında.',
    accountId: 'DEMO-ACC-UNI-002',
    accountName: 'Doğa Lojistik Saha Satış',
    productGroup: 'Enroute',
    scenarioTag: 'linked-child',
  }),

  // ───── Finrota SMB Finance ─────
  finrotaCase({
    caseNumber: 'DEMO-FIN-001',
    title: 'Netahsilat: bayi tahsilatı sistemde görünmüyor',
    description: 'Atlas Pazarlama bayi tahsilat kanalından gelen ödeme 2 saat geçmesine rağmen ekranda görünmüyor. Banka extresi onaylı.',
    accountId: 'DEMO-ACC-FIN-002',
    accountName: 'Atlas Pazarlama Tic. Ltd.',
    productGroup: 'Netahsilat',
    scenarioTag: 'reaction',
  }),
  finrotaCase({
    caseNumber: 'DEMO-FIN-002',
    title: 'Netekstre: banka hareketi eksik',
    description: 'Garanti bankası hareket dökümü 17:00 sonrası işlemleri içermiyor. Müşterinin gün sonu mutabakatı engellendi.',
    accountId: 'DEMO-ACC-FIN-001',
    accountName: 'Kemal Mali Müşavirlik',
    productGroup: 'Netekstre',
    slaViolation: true,
    scenarioTag: 'sla-risk',
  }),
  finrotaCase({
    caseNumber: 'DEMO-FIN-003',
    title: 'Posrapor: gün sonu mutabakat farkı',
    description: 'Posrapor önceki hafta TL 2.450 fark gösteriyor; pos tarafı vs. banka extresi uyumsuz. Çözüldü, ek bilgi notları takipte.',
    accountId: 'DEMO-ACC-FIN-003',
    accountName: 'Yıldız Eczanesi',
    productGroup: 'Posrapor',
    status: 'Cozuldu',
    priority: 'Medium',
    scenarioTag: 'pulse-resolved',
  }),
  finrotaCase({
    caseNumber: 'DEMO-FIN-004',
    title: 'E-DBS banka cevabı gecikti — Otomatik talimat',
    description: 'E-DBS dosyası banka tarafına iletildi fakat onay cevabı 12 saattir gelmedi. Müşteri operasyonu bekliyor.',
    accountId: 'DEMO-ACC-FIN-001',
    accountName: 'Kemal Mali Müşavirlik',
    productGroup: 'E-DBS',
    status: 'ThirdPartyWaiting',
    scenarioTag: 'pulse-3rd-party',
  }),
  finrotaCase({
    caseNumber: 'DEMO-FIN-005',
    title: 'NAP360: nakit akışı tahmin verisi eksik',
    description: 'NAP360 nakit akışı tahmin tablosu son 7 günlük veriyi göstermiyor; CFO toplantısı engellendi.',
    accountId: 'DEMO-ACC-FIN-001',
    accountName: 'Kemal Mali Müşavirlik',
    productGroup: 'NAP360',
    priority: 'Critical',
    escalationLevel: 'Direktor',
    scenarioTag: 'pulse-critical',
  }),

  // ───── PARAM Fintech ─────
  // PARAM vakalarının bir kısmı Demo Agent'a (USR-001 = Burak Demir, TEAM-DESTEK)
  // atanır. Aksi halde Agent MyHome boş kalır.
  paramCase({
    caseNumber: 'DEMO-PAR-001',
    title: 'POS: "Bilinmeyen Hata" işlemi reddediyor',
    description: 'Saha pos cihazları işlem sırasında "Bilinmeyen Hata" dönüyor; gün boyunca 38 işlem etkilendi. Acquirer logları normal.',
    accountId: 'DEMO-ACC-PAR-001',
    accountName: 'Sancaktepe Market Zinciri',
    productGroup: 'Fiziki POS',
    assignedPersonId: 'USR-001',
    assignedPersonName: 'Burak Demir',
    scenarioTag: 'watcher',
  }),
  paramCase({
    caseNumber: 'DEMO-PAR-002',
    title: 'BKM gün sonu mutabakatında eksik işlem',
    description: 'BKM dosyasında dünkü gün sonunda 7 işlem eksik; bankaya iletildi, geri dönüş bekleniyor.',
    accountId: 'DEMO-ACC-PAR-003',
    accountName: 'İstanbul Restoranlar Bayi Grubu',
    productGroup: 'BKM Servisi',
    status: 'Eskalasyon',
    escalationLevel: 'Direktor',
    assignedPersonId: 'USR-001',
    assignedPersonName: 'Burak Demir',
    scenarioTag: 'ai-status-report',
  }),
  // Duplicate (Linked Cases scenario)
  paramCase({
    caseNumber: 'DEMO-PAR-DUP-A',
    title: 'Sanal POS settlement gecikmesi (GnG online)',
    description: 'GnG online mağazası sanal pos işlemleri settlement gecikmesi yaşıyor; D+2 olması gereken işlemler D+4\'te düştü.',
    accountId: 'DEMO-ACC-PAR-002',
    accountName: 'GnG Online Mağaza',
    productGroup: 'Sanal POS',
    assignedPersonId: 'USR-001',
    assignedPersonName: 'Burak Demir',
    scenarioTag: 'linked-duplicate-a',
  }),
  paramCase({
    caseNumber: 'DEMO-PAR-DUP-B',
    title: 'Sanal POS settlement gecikmesi — aynı problem ikinci başvuru',
    description: 'Aynı sanal pos settlement gecikmesi için müşteri ikinci bir vaka açtı; çoğaltılmış kayıt — Duplicate link kurulacak.',
    accountId: 'DEMO-ACC-PAR-002',
    accountName: 'GnG Online Mağaza',
    productGroup: 'Sanal POS',
    scenarioTag: 'linked-duplicate-b',
  }),

  // ───── Multi-tenant isolation test ─────
  paramCase({
    caseNumber: 'DEMO-MT-PAR',
    title: 'PARAM tarafında — Multi-Tenant Test vakası',
    description: 'Aynı müşteri adı 3 şirkette de mevcut. Bu vaka yalnız PARAM kapsamında görünmeli.',
    accountId: 'DEMO-ACC-MT-PAR',
    accountName: 'Multi-Tenant Test Müşterisi',
    productGroup: 'Fiziki POS',
    scenarioTag: 'multi-tenant',
  }),
  univeraCase({
    caseNumber: 'DEMO-MT-UNI',
    title: 'UNIVERA tarafında — Multi-Tenant Test vakası',
    description: 'Aynı müşteri adı 3 şirkette de mevcut. Bu vaka yalnız UNIVERA kapsamında görünmeli.',
    accountId: 'DEMO-ACC-MT-UNI',
    accountName: 'Multi-Tenant Test Müşterisi',
    productGroup: 'Enroute',
    scenarioTag: 'multi-tenant',
  }),
  finrotaCase({
    caseNumber: 'DEMO-MT-FIN',
    title: 'FINROTA tarafında — Multi-Tenant Test vakası',
    description: 'Aynı müşteri adı 3 şirkette de mevcut. Bu vaka yalnız FINROTA kapsamında görünmeli.',
    accountId: 'DEMO-ACC-MT-FIN',
    accountName: 'Multi-Tenant Test Müşterisi',
    productGroup: 'Netahsilat',
    scenarioTag: 'multi-tenant',
  }),
];

// caseNumber → DB id eşlemesi (cuid id), upsert sonrası doldurulur.
const caseIdByNumber = new Map<string, string>();

// ─────────────────────────────────────────────────────────────────
// Upsert helpers — idempotent
// ─────────────────────────────────────────────────────────────────

async function upsertAccounts() {
  console.log(`→ ${ACCOUNTS.length} demo müşteri upsert ediliyor...`);
  for (const a of ACCOUNTS) {
    await prisma.account.upsert({
      where: { id: a.id },
      update: { name: a.name, companyId: a.companyId, email: a.email, phone: a.phone, isActive: true },
      create: { id: a.id, name: a.name, companyId: a.companyId, email: a.email, phone: a.phone, isActive: true },
    });
    // P0 hotfix: legacy Account.companyId set ediliyor; AccountCompany ilişkisi
    // de aynı işlemde ensure et — aksi halde Account 360 detay/picker'da gap çıkar.
    if (a.companyId) {
      await prisma.accountCompany.upsert({
        where: { accountId_companyId: { accountId: a.id, companyId: a.companyId } },
        update: {}, // var olan ilişkiye dokunma (status/code/notes elle güncellenmiş olabilir)
        create: { accountId: a.id, companyId: a.companyId, status: 'active' },
      });
    }
  }
}

async function upsertCases() {
  console.log(`→ ${CASES.length} demo vaka upsert ediliyor...`);
  for (const c of CASES) {
    const existing = await prisma.case.findUnique({ where: { caseNumber: c.caseNumber }, select: { id: true } });
    // Phase D hotfix: assignedPersonId/Name eski seed'de eksikti; Demo Agent KPI
     //'larının dolması için scenario CASES'lerinde belirtilen kişiyi DB'ye yansıt.
    const baseData = {
      title: c.title,
      description: c.description,
      caseType: c.caseType,
      status: c.status,
      priority: c.priority,
      origin: c.origin,
      category: c.category,
      subCategory: c.subCategory,
      requestType: c.requestType,
      productGroup: c.productGroup,
      companyId: c.companyId,
      companyName: c.companyName,
      accountId: c.accountId,
      accountName: c.accountName,
      assignedTeamId: c.assignedTeamId,
      assignedTeamName: c.assignedTeamName,
      assignedPersonId: c.assignedPersonId ?? null,
      assignedPersonName: c.assignedPersonName ?? null,
      escalationLevel: c.escalationLevel ?? 'Yok',
      slaViolation: c.slaViolation ?? false,
    };
    if (existing) {
      const updated = await prisma.case.update({
        where: { caseNumber: c.caseNumber },
        data: baseData,
      });
      caseIdByNumber.set(c.caseNumber, updated.id);
    } else {
      const created = await prisma.case.create({
        data: { caseNumber: c.caseNumber, ...baseData },
      });
      caseIdByNumber.set(c.caseNumber, created.id);
    }
  }
}

/**
 * Idempotent not seed — aynı vakaya aynı içeriği ikinci kez yazma yok.
 * authorName + içerik kombinasyonu ile dedup eder (yaklaşık).
 */
async function ensureNote(opts: {
  caseNumber: string;
  authorId: string;
  authorName: string;
  content: string;
  parentNoteContent?: string; // top-level not içeriği — parent bul
  visibility?: 'Internal' | 'Customer';
}): Promise<string | null> {
  const caseId = caseIdByNumber.get(opts.caseNumber);
  if (!caseId) return null;

  const c = await prisma.case.findUnique({ where: { id: caseId }, select: { companyId: true } });
  if (!c) return null;

  // Parent çözümle (opsiyonel)
  let parentNoteId: string | null = null;
  if (opts.parentNoteContent) {
    const parent = await prisma.caseNote.findFirst({
      where: { caseId, content: opts.parentNoteContent, parentNoteId: null },
      select: { id: true },
    });
    if (!parent) return null; // parent yoksa reply seed atla
    parentNoteId = parent.id;
  }

  // Dedup — aynı parent altında aynı content varsa skip
  const dup = await prisma.caseNote.findFirst({
    where: { caseId, content: opts.content, parentNoteId },
    select: { id: true },
  });
  if (dup) return dup.id;

  const note = await prisma.caseNote.create({
    data: {
      caseId,
      companyId: c.companyId,
      authorName: opts.authorName,
      authorId: opts.authorId,
      content: opts.content,
      visibility: opts.visibility ?? 'Internal',
      parentNoteId,
    },
  });
  // replyCount bump (txn değil — seed'de yarış yok)
  if (parentNoteId) {
    await prisma.caseNote.update({
      where: { id: parentNoteId },
      data: { replyCount: { increment: 1 } },
    });
  }
  return note.id;
}

async function ensureReaction(opts: {
  noteId: string | null;
  userId: string;
  emoji: 'thumbs_up' | 'eyes' | 'check' | 'important' | 'thanks';
}) {
  if (!opts.noteId) return;
  // companyId — note üzerinden çek
  const n = await prisma.caseNote.findUnique({ where: { id: opts.noteId }, select: { companyId: true } });
  if (!n) return;
  const dup = await prisma.caseNoteReaction.findUnique({
    where: { noteId_userId_emoji: { noteId: opts.noteId, userId: opts.userId, emoji: opts.emoji } },
    select: { id: true },
  });
  if (dup) return;
  await prisma.caseNoteReaction.create({
    data: { noteId: opts.noteId, userId: opts.userId, companyId: n.companyId, emoji: opts.emoji },
  });
}

async function ensureWatcher(opts: { caseNumber: string; userId: string; addedBy: string }) {
  const caseId = caseIdByNumber.get(opts.caseNumber);
  if (!caseId) return;
  const c = await prisma.case.findUnique({ where: { id: caseId }, select: { companyId: true } });
  if (!c) return;
  const dup = await prisma.caseWatcher.findUnique({
    where: { caseId_userId: { caseId, userId: opts.userId } },
    select: { id: true },
  });
  if (dup) return;
  await prisma.caseWatcher.create({
    data: { caseId, userId: opts.userId, companyId: c.companyId, addedBy: opts.addedBy },
  });
}

async function ensureLink(opts: {
  caseNumber: string;
  linkedCaseNumber: string;
  linkType: 'Related' | 'Duplicate' | 'Parent';
  createdBy: string;
}) {
  const caseId = caseIdByNumber.get(opts.caseNumber);
  const linkedCaseId = caseIdByNumber.get(opts.linkedCaseNumber);
  if (!caseId || !linkedCaseId) return;
  const c = await prisma.case.findUnique({ where: { id: caseId }, select: { companyId: true } });
  if (!c) return;

  // Tek yön
  const dup = await prisma.caseLink.findUnique({
    where: {
      caseId_linkedCaseId_linkType: {
        caseId,
        linkedCaseId,
        linkType: opts.linkType,
      },
    },
    select: { id: true },
  });
  if (!dup) {
    await prisma.caseLink.create({
      data: {
        caseId,
        linkedCaseId,
        linkType: opts.linkType,
        companyId: c.companyId,
        createdBy: opts.createdBy,
      },
    });
  }

  // Duplicate symmetric — ters yön de ekle
  if (opts.linkType === 'Duplicate') {
    const reverse = await prisma.caseLink.findUnique({
      where: {
        caseId_linkedCaseId_linkType: {
          caseId: linkedCaseId,
          linkedCaseId: caseId,
          linkType: 'Duplicate',
        },
      },
      select: { id: true },
    });
    if (!reverse) {
      await prisma.caseLink.create({
        data: {
          caseId: linkedCaseId,
          linkedCaseId: caseId,
          linkType: 'Duplicate',
          companyId: c.companyId,
          createdBy: opts.createdBy,
        },
      });
    }
  }
}

async function ensureActivity(opts: {
  caseNumber: string;
  action: string;
  actor: string;
  actionType?: 'StatusChange' | 'FieldUpdate' | 'NoteAdded' | 'Transfer' | 'CaseCreated';
}) {
  const caseId = caseIdByNumber.get(opts.caseNumber);
  if (!caseId) return;
  const c = await prisma.case.findUnique({ where: { id: caseId }, select: { companyId: true } });
  if (!c) return;
  const dup = await prisma.caseActivity.findFirst({
    where: { caseId, action: opts.action, actor: opts.actor },
    select: { id: true },
  });
  if (dup) return;
  await prisma.caseActivity.create({
    data: {
      caseId,
      companyId: c.companyId,
      action: opts.action,
      actor: opts.actor,
      actionType: opts.actionType,
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Senaryo grupları
// ─────────────────────────────────────────────────────────────────

async function seedWatcherFlow() {
  console.log('→ Watcher + Notification senaryosu...');
  // DEMO-UNI-001: Supervisor agent'ı izleyici yapar
  await ensureWatcher({ caseNumber: 'DEMO-UNI-001', userId: USER.AGENT, addedBy: USER.SUPERVISOR });
  // DEMO-PAR-001: Supervisor + CSM izliyor
  await ensureWatcher({ caseNumber: 'DEMO-PAR-001', userId: USER.SUPERVISOR, addedBy: USER.SUPERVISOR });
  await ensureWatcher({ caseNumber: 'DEMO-PAR-001', userId: USER.CSM, addedBy: USER.SUPERVISOR });
  await ensureActivity({
    caseNumber: 'DEMO-PAR-001',
    action: 'Statü değişti: Açık → İncelemede',
    actor: 'Demo Supervisor',
    actionType: 'StatusChange',
  });
}

async function seedLinkedFlow() {
  console.log('→ Linked Cases senaryosu...');
  // Parent → 2 child (Parent direction: child → parent)
  await ensureLink({ caseNumber: 'DEMO-UNI-CHILD-001', linkedCaseNumber: 'DEMO-UNI-PARENT-001', linkType: 'Parent', createdBy: USER.SUPERVISOR });
  await ensureLink({ caseNumber: 'DEMO-UNI-CHILD-002', linkedCaseNumber: 'DEMO-UNI-PARENT-001', linkType: 'Parent', createdBy: USER.SUPERVISOR });
  // Related — aynı müşteri farklı kategori
  await ensureLink({ caseNumber: 'DEMO-UNI-001', linkedCaseNumber: 'DEMO-UNI-CHILD-001', linkType: 'Related', createdBy: USER.AGENT });
  // Duplicate — PARAM virtual POS
  await ensureLink({ caseNumber: 'DEMO-PAR-DUP-A', linkedCaseNumber: 'DEMO-PAR-DUP-B', linkType: 'Duplicate', createdBy: USER.SUPERVISOR });
}

async function seedReplyReactionFlow() {
  console.log('→ Note Reply + Reaction senaryosu...');
  // Top-level + 2-3 reply + reactions
  const noteId = await ensureNote({
    caseNumber: 'DEMO-UNI-003',
    authorId: USER.AGENT,
    authorName: 'Demo Agent',
    content: 'Quest planı tarafında sync trigger logu görmüyorum, bir bakar mısınız?',
  });
  if (noteId) {
    const reply1 = await ensureNote({
      caseNumber: 'DEMO-UNI-003',
      authorId: USER.BACKOFFICE,
      authorName: 'Demo Backoffice',
      content: 'CRM tarafında plan üretildi ama Quest API\'sine push edilmemiş, scheduler patch deniyoruz.',
      parentNoteContent: 'Quest planı tarafında sync trigger logu görmüyorum, bir bakar mısınız?',
    });
    const reply2 = await ensureNote({
      caseNumber: 'DEMO-UNI-003',
      authorId: USER.SUPERVISOR,
      authorName: 'Demo Supervisor',
      content: '@[Demo Agent](USR-001) müşteriye dakikada bir geri dönüş veriyor musun? Yarın sabaha kadar manuel sync alternatifi düşünelim.',
      parentNoteContent: 'Quest planı tarafında sync trigger logu görmüyorum, bir bakar mısınız?',
    });
    void reply1;
    void reply2;
    // Reactions
    await ensureReaction({ noteId, userId: USER.SUPERVISOR, emoji: 'eyes' });
    await ensureReaction({ noteId, userId: USER.CSM, emoji: 'important' });
  }

  // FIN-001 üzerinde de top-level + 1 reply + reactions
  const finNoteId = await ensureNote({
    caseNumber: 'DEMO-FIN-001',
    authorId: USER.AGENT,
    authorName: 'Demo Agent',
    content: 'Banka extresinde ödeme görünüyor; sistemde neden listede yok henüz tespit edemedim.',
  });
  if (finNoteId) {
    await ensureNote({
      caseNumber: 'DEMO-FIN-001',
      authorId: USER.BACKOFFICE,
      authorName: 'Demo Backoffice',
      content: 'Sync job log\'unda extstemp tablo lock\'u var, gece batch yeniden başlatılacak.',
      parentNoteContent: 'Banka extresinde ödeme görünüyor; sistemde neden listede yok henüz tespit edemedim.',
    });
    await ensureReaction({ noteId: finNoteId, userId: USER.SUPERVISOR, emoji: 'thumbs_up' });
    await ensureReaction({ noteId: finNoteId, userId: USER.AGENT, emoji: 'thanks' });
  }
}

async function seedAiStatusReportTimeline() {
  console.log('→ AI Status Report timeline senaryosu (DEMO-PAR-002)...');
  // Zengin activity feed — kronolojik olarak çeşitli action'lar
  const acts: Array<{ action: string; actor: string; type?: 'StatusChange' | 'FieldUpdate' | 'NoteAdded' | 'Transfer' | 'CaseCreated' }> = [
    { action: 'Vaka oluşturuldu', actor: 'Demo Agent', type: 'CaseCreated' },
    { action: 'Atama değişti: — → Demo Backoffice', actor: 'Demo Supervisor', type: 'FieldUpdate' },
    { action: 'Öncelik değişti: Yüksek → Kritik', actor: 'Demo Supervisor', type: 'FieldUpdate' },
    { action: 'Statü değişti: Açık → İncelemede', actor: 'Demo Backoffice', type: 'StatusChange' },
    { action: 'İç not eklendi', actor: 'Demo Backoffice', type: 'NoteAdded' },
    { action: 'Statü değişti: İncelemede → 3rdPartyBekleniyor', actor: 'Demo Backoffice', type: 'StatusChange' },
    { action: 'Eskalasyon: Direktör seviyesi', actor: 'Demo Supervisor', type: 'FieldUpdate' },
    { action: 'Aktarıldı: Destek Takımı → Finans Takımı', actor: 'Demo Supervisor', type: 'Transfer' },
    { action: 'Statü değişti: 3rdPartyBekleniyor → İncelemede', actor: 'Demo Backoffice', type: 'StatusChange' },
  ];
  for (const a of acts) {
    await ensureActivity({ caseNumber: 'DEMO-PAR-002', action: a.action, actor: a.actor, actionType: a.type });
  }
  // Bir de zengin not
  await ensureNote({
    caseNumber: 'DEMO-PAR-002',
    authorId: USER.BACKOFFICE,
    authorName: 'Demo Backoffice',
    content: 'BKM tarafından 7 işlemin manual fixle gönderilmesi onaylandı. Bankaya iletildi, dönüş bekleniyor.',
  });
}

async function seedCustomerPulseHistory() {
  console.log('→ Customer Pulse zengin geçmiş senaryosu (DEMO-ACC-FIN-001)...');
  // DEMO-FIN-002 (SLA risk), DEMO-FIN-003 (resolved), DEMO-FIN-004 (3rd party), DEMO-FIN-005 (critical)
  // hepsi aynı müşteri Kemal Mali Müşavirlik — Customer Pulse zengin sinyal
  // Resolved vakaya resolvedAt set et
  const finId = caseIdByNumber.get('DEMO-FIN-003');
  if (finId) {
    await prisma.case.update({
      where: { id: finId },
      data: { resolvedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000) },
    });
  }
}

async function seedMultiTenantIsolation() {
  console.log('→ Multi-tenant isolation senaryosu (DEMO-MT-*)...');
  // Multi-tenant test vakaları zaten upsertCases ile yaratıldı.
  // Her birinde küçük not ekleyelim — agent kullanıcısı sadece kendi şirketindekini görmeli
  await ensureNote({
    caseNumber: 'DEMO-MT-PAR',
    authorId: USER.AGENT,
    authorName: 'Demo Agent',
    content: 'PARAM kapsamında — diğer şirketlerden görünmemeli.',
  });
  await ensureNote({
    caseNumber: 'DEMO-MT-UNI',
    authorId: USER.AGENT,
    authorName: 'Demo Agent',
    content: 'UNIVERA kapsamında — diğer şirketlerden görünmemeli.',
  });
  await ensureNote({
    caseNumber: 'DEMO-MT-FIN',
    authorId: USER.AGENT,
    authorName: 'Demo Agent',
    content: 'FINROTA kapsamında — diğer şirketlerden görünmemeli.',
  });
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

/**
 * Prod safety guard.
 *  - --confirm-demo-seed flag zorunlu. Kazara `tsx prisma/seedScenarios.ts`
 *    veya `import('./seedScenarios')` ile tetiklenmesini onler.
 *  - DATABASE_URL'i kontrol etmek istersen ek guard ekleyebilirsin.
 */
function assertExplicitConsent() {
  if (!process.argv.includes('--confirm-demo-seed')) {
    console.error(
      '\n❌ Scenario seed yalniz `npm run db:seed:scenarios` ile calistirilir.\n' +
        '   Manuel cagri icin: tsx prisma/seedScenarios.ts --confirm-demo-seed\n' +
        '   Production DB\'ye yazmadan once .env URL\'inin local/demo oldugunu DOGRULAYIN.\n',
    );
    process.exit(1);
  }
}

async function main() {
  assertExplicitConsent();
  console.log('🎯 Scenario seed başlıyor — local/demo/sandbox kullanım.\n');

  // Şirketler zaten seed.ts ile geliyor — sadece var olduğunu doğrula
  for (const c of Object.values(COMPANY)) {
    const exists = await prisma.company.findUnique({ where: { id: c.id } });
    if (!exists) {
      console.warn(`⚠ ${c.id} şirketi yok — önce 'npm run db:seed' çalıştırın`);
      process.exit(1);
    }
  }

  await upsertAccounts();
  await upsertCases();
  await seedWatcherFlow();
  await seedLinkedFlow();
  await seedReplyReactionFlow();
  await seedAiStatusReportTimeline();
  await seedCustomerPulseHistory();
  await seedMultiTenantIsolation();

  // Özet
  const counts = {
    accounts: ACCOUNTS.length,
    cases: CASES.length,
    companies: Object.keys(COMPANY).length,
  };
  console.log('\n✅ Scenario seed tamamlandı.');
  console.log(`   • ${counts.accounts} demo müşteri`);
  console.log(`   • ${counts.cases} demo vaka`);
  console.log(`   • ${counts.companies} şirket (Univera / Finrota / PARAM)`);
  console.log('\nGiriş için demo personalar:');
  console.log('   - agent@varuna.dev (PARAM)');
  console.log('   - supervisor@varuna.dev (PARAM + UNIVERA)');
  console.log('   - admin@varuna.dev (tüm şirketler)');
  console.log('\n📖 Senaryo rehberi: docs/TEST_SCENARIOS.md');
}

// Sadece dogrudan calistirildiginda main()'i tetikle — module olarak import
// edildiginde (ornek: bir test runner) script otomatik calismaz.
// argv[1] tsx execute eden dosyanin path'i; bu dosya ile bitiyorsa direct run.
const isDirectRun =
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('seedScenarios.ts');

if (isDirectRun) {
  main()
    .catch((err) => {
      console.error('❌ Scenario seed hatası:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
