/**
 * Seed script — src/mocks/caseMockData.ts içeriğini Supabase'e taşır.
 *
 * Çalıştırma: `npm run db:seed`
 *
 * Strateji:
 *  - Mock ID'leri korunur (companyId="PARAM" → DB'de aynı). Cross-ref bozulmasın.
 *  - Idempotent değil — boş DB'ye seed atmak için. Tekrar atmak için önce reset.
 *  - Önce parent tablolar (Company, Team), sonra Account/Person, sonra
 *    Category/SLA/Checklist, en son Case + ilişkili tablolar.
 *
 * MSSQL'e geçişte bu script çalışır halde kalır (Prisma client provider farkını
 * abstract eder). Sadece `provider = "sqlserver"` ve DATABASE_URL değişir.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  MOCK_ACCOUNTS,
  MOCK_CASES,
  MOCK_CATEGORIES,
  MOCK_CHECKLIST_TEMPLATES,
  MOCK_COMPANIES,
  MOCK_DOCUMENT_TYPES,
  MOCK_OFFERED_SOLUTIONS,
  MOCK_PERSONS,
  MOCK_SLA_POLICIES,
  MOCK_TEAMS,
  MOCK_THIRD_PARTIES,
} from '../src/mocks/caseMockData';

const prisma = new PrismaClient();

const toDate = (iso?: string) => (iso ? new Date(iso) : undefined);

// ─────────────────────────────────────────────────────────────────
// Enum mapper'ları — Prisma identifier'ları ASCII (TR chars yasak),
// app içi enum'lar TR string. @map ile DB'ye TR yazılır ama client
// API'sı ASCII identifier ister. Mock TR → Prisma identifier dönüşümü.
// ─────────────────────────────────────────────────────────────────
const M_STATUS: Record<string, any> = {
  'Açık': 'Acik',
  'İncelemede': 'Incelemede',
  '3rdPartyBekleniyor': 'ThirdPartyWaiting',
  'Eskalasyon': 'Eskalasyon',
  'Çözüldü': 'Cozuldu',
  'YenidenAcildi': 'YenidenAcildi',
  'İptalEdildi': 'IptalEdildi',
};
const M_ORIGIN: Record<string, any> = {
  'Telefon': 'Telefon', 'E-posta': 'Eposta', 'Web': 'Web', 'Chatbot': 'Chatbot', 'Diğer': 'Diger',
};
const M_REQUEST: Record<string, any> = {
  'Bilgi': 'Bilgi', 'Öneri': 'Oneri', 'Talep': 'Talep', 'Şikayet': 'Sikayet', 'Hata': 'Hata',
};
const M_ESCALATION: Record<string, any> = {
  'Yok': 'Yok', 'TakımLideri': 'TakimLideri', 'Direktör': 'Direktor', 'ÜstYönetim': 'UstYonetim',
};
const M_FINANCIAL: Record<string, any> = {
  'Düşük': 'Dusuk', 'Orta': 'Orta', 'Yüksek': 'Yuksek', 'Kritik': 'Kritik',
};
const M_USAGE: Record<string, any> = {
  'Yüksek': 'Yuksek', 'Orta': 'Orta', 'Düşük': 'Dusuk', 'Yok': 'Yok',
};
const M_USAGE_CHANGE: Record<string, any> = {
  'Artış': 'Artis', 'Azalma': 'Azalma', 'Sabit': 'Sabit',
};
const M_RESPONSE_LEVEL: Record<string, any> = {
  'Yüksek Öncelik': 'YuksekOncelik', 'Orta Öncelik': 'OrtaOncelik', 'Düşük Öncelik': 'DusukOncelik',
};
const M_CALL_DISP: Record<string, any> = {
  'Cevapladı': 'Cevapladi', 'Cevaplamadı': 'Cevaplamadi', 'NumaraHatalı': 'NumaraHatali',
  'GörüşmekIstemedi': 'GorusmekIstemedi', 'TekrarAranacak': 'TekrarAranacak',
};
const M_CALL_OUT: Record<string, any> = {
  'Memnun': 'Memnun', 'MemnunDeğil': 'MemnunDegil', 'Tarafsız': 'Tarafsiz', 'Ulaşılamadı': 'Ulasilamadi',
};
const M_CHURN: Record<string, any> = {
  'İptalEdildi': 'IptalEdildi', 'DevamEdiyor': 'DevamEdiyor', 'TeklifKabulEdildi': 'TeklifKabulEdildi',
};
const M_RETENTION: Record<string, any> = {
  'Başarılı': 'Basarili', 'Başarısız': 'Basarisiz', 'DevamEdiyor': 'DevamEdiyor',
};

const map = <T>(m: Record<string, any>, v: T | undefined) =>
  v == null ? undefined : (m[v as string] ?? v);

async function main() {
  console.log('🌱 Seed başlıyor...\n');

  // -------------------------------------------------------------
  // 1. Şirketler
  // -------------------------------------------------------------
  console.log('→ Şirketler...');
  for (const c of MOCK_COMPANIES) {
    await prisma.company.upsert({
      where: { id: c.id },
      update: { name: c.name },
      create: { id: c.id, name: c.name, isActive: true },
    });
  }
  console.log(`  ✓ ${MOCK_COMPANIES.length} şirket`);

  // -------------------------------------------------------------
  // 2. Takımlar — multi-tenant izolasyon (Phase 1).
  // Mock'ta companyId hâlâ yok; varsayılan PARAM. İleride mock'a şirket
  // eklenince burası `t.companyId ?? DEFAULT_TEAM_COMPANY` olarak okunur.
  // -------------------------------------------------------------
  console.log('→ Takımlar...');
  const DEFAULT_TEAM_COMPANY = 'COMP-PARAM';
  for (const t of MOCK_TEAMS) {
    const companyId = (t as { companyId?: string }).companyId ?? DEFAULT_TEAM_COMPANY;
    await prisma.team.upsert({
      where: { id: t.id },
      update: { name: t.name, description: t.description, isActive: t.isActive, companyId },
      create: {
        id: t.id,
        name: t.name,
        description: t.description,
        isActive: t.isActive,
        companyId,
      },
    });
  }
  console.log(`  ✓ ${MOCK_TEAMS.length} takım (default companyId: ${DEFAULT_TEAM_COMPANY})`);

  // -------------------------------------------------------------
  // 3. Kişiler
  // -------------------------------------------------------------
  console.log('→ Kişiler...');
  for (const p of MOCK_PERSONS) {
    await prisma.person.upsert({
      where: { id: p.id },
      update: { name: p.name, email: p.email, teamId: p.teamId, isActive: p.isActive },
      create: {
        id: p.id,
        name: p.name,
        email: p.email,
        teamId: p.teamId,
        isActive: p.isActive,
      },
    });
  }
  console.log(`  ✓ ${MOCK_PERSONS.length} kişi`);

  // -------------------------------------------------------------
  // 4. Müşteriler (Account)
  // -------------------------------------------------------------
  console.log('→ Müşteriler...');
  for (const a of MOCK_ACCOUNTS) {
    await prisma.account.upsert({
      where: { id: a.id },
      update: {
        name: a.name,
        phone: a.phone,
        email: a.email ?? null,
      },
      create: {
        id: a.id,
        name: a.name,
        phone: a.phone,
        email: a.email ?? null,
        isActive: true,
      },
    });
  }
  console.log(`  ✓ ${MOCK_ACCOUNTS.length} müşteri`);

  // -------------------------------------------------------------
  // 5. 3. Partiler & Belge Türleri
  // -------------------------------------------------------------
  console.log('→ 3. Partiler & Belge Türleri...');
  for (const tp of MOCK_THIRD_PARTIES) {
    await prisma.thirdParty.upsert({
      where: { id: tp.id },
      update: { name: tp.name, description: tp.description, isActive: tp.isActive },
      create: { id: tp.id, name: tp.name, description: tp.description, isActive: tp.isActive },
    });
  }
  for (const e of MOCK_DOCUMENT_TYPES) {
    await prisma.documentType.upsert({
      where: { id: e.id },
      update: { name: e.name, description: e.description, isActive: e.isActive },
      create: { id: e.id, name: e.name, description: e.description, isActive: e.isActive },
    });
  }
  console.log(`  ✓ ${MOCK_THIRD_PARTIES.length} 3.parti / ${MOCK_DOCUMENT_TYPES.length} belge türü`);

  // -------------------------------------------------------------
  // 6. Teklif Tanımları
  // -------------------------------------------------------------
  console.log('→ Teklif Tanımları...');
  for (const o of MOCK_OFFERED_SOLUTIONS) {
    await prisma.offeredSolutionDef.upsert({
      where: { id: o.id },
      update: { name: o.name, description: o.description, isActive: o.isActive },
      create: { id: o.id, name: o.name, description: o.description, isActive: o.isActive },
    });
  }
  console.log(`  ✓ ${MOCK_OFFERED_SOLUTIONS.length} teklif tanımı`);

  // -------------------------------------------------------------
  // 7. Kategoriler — root + subCategories (self-relation)
  // -------------------------------------------------------------
  console.log('→ Kategoriler...');
  for (const c of MOCK_CATEGORIES) {
    await prisma.categoryDef.upsert({
      where: { id: c.id },
      update: { name: c.name, description: c.description, isActive: c.isActive },
      create: {
        id: c.id,
        name: c.name,
        description: c.description,
        isActive: c.isActive,
      },
    });
    for (const s of c.subCategories) {
      await prisma.categoryDef.upsert({
        where: { id: s.id },
        update: { name: s.name, parentId: c.id, isActive: s.isActive },
        create: { id: s.id, name: s.name, parentId: c.id, isActive: s.isActive },
      });
    }
  }
  const subCatCount = MOCK_CATEGORIES.reduce((n, c) => n + c.subCategories.length, 0);
  console.log(`  ✓ ${MOCK_CATEGORIES.length} kategori + ${subCatCount} alt kategori`);

  // -------------------------------------------------------------
  // 8. SLA Politikaları
  // -------------------------------------------------------------
  console.log('→ SLA Politikaları...');
  for (const p of MOCK_SLA_POLICIES) {
    await prisma.sLAPolicy.upsert({
      where: { id: p.id },
      update: {
        companyId: p.companyId,
        companyName: p.companyName,
        productGroup: p.productGroup,
        categoryName: p.categoryName,
        subCategoryName: p.subCategoryName,
        requestType: map(M_REQUEST, p.requestType),
        responseHours: p.responseHours,
        resolutionHours: p.resolutionHours,
        description: p.description,
        isActive: p.isActive,
      },
      create: {
        id: p.id,
        companyId: p.companyId,
        companyName: p.companyName,
        productGroup: p.productGroup,
        categoryName: p.categoryName,
        subCategoryName: p.subCategoryName,
        requestType: map(M_REQUEST, p.requestType),
        responseHours: p.responseHours,
        resolutionHours: p.resolutionHours,
        description: p.description,
        isActive: p.isActive,
      },
    });
  }
  console.log(`  ✓ ${MOCK_SLA_POLICIES.length} SLA policy`);

  // -------------------------------------------------------------
  // 9. Kontrol Listeleri
  // -------------------------------------------------------------
  console.log('→ Kontrol Listeleri...');
  for (const t of MOCK_CHECKLIST_TEMPLATES) {
    await prisma.checklistTemplate.upsert({
      where: { id: t.id },
      update: {
        name: t.name,
        companyId: t.companyId,
        companyName: t.companyName,
        productGroup: t.productGroup,
        categoryName: t.categoryName,
        description: t.description,
        // MSSQL: Json kolonlar String (nvarchar(max)) — uygulama katmanı stringify eder
        items: JSON.stringify(t.items),
        isActive: t.isActive,
      },
      create: {
        id: t.id,
        name: t.name,
        companyId: t.companyId,
        companyName: t.companyName,
        productGroup: t.productGroup,
        categoryName: t.categoryName,
        description: t.description,
        items: JSON.stringify(t.items),
        isActive: t.isActive,
      },
    });
  }
  console.log(`  ✓ ${MOCK_CHECKLIST_TEMPLATES.length} checklist template`);

  // -------------------------------------------------------------
  // 10. Vakalar — notes/files/history/callLogs nested create
  // -------------------------------------------------------------
  console.log(`→ Vakalar (${MOCK_CASES.length} adet)...`);
  let caseProgress = 0;
  for (const c of MOCK_CASES) {
    await prisma.case.upsert({
      where: { id: c.id },
      update: {}, // Re-seed: sadece eksikleri ekle, mevcudunu bozma
      create: {
        id: c.id,
        caseNumber: c.caseNumber,
        title: c.title,
        description: c.description,
        caseType: c.caseType,
        status: map(M_STATUS, c.status),
        priority: c.priority,
        origin: map(M_ORIGIN, c.origin),
        originDescription: c.originDescription,
        companyId: c.companyId,
        companyName: c.companyName,
        accountId: c.accountId,
        accountName: c.accountName,
        category: c.category,
        subCategory: c.subCategory,
        requestType: map(M_REQUEST, c.requestType),
        productGroup: c.productGroup,
        assignedTeamId: c.assignedTeamId,
        assignedTeamName: c.assignedTeamName,
        assignedPersonId: c.assignedPersonId,
        assignedPersonName: c.assignedPersonName,
        escalationLevel: map(M_ESCALATION, c.escalationLevel),
        thirdPartyId: c.thirdPartyId,
        thirdPartyName: c.thirdPartyName,
        // ProactiveTracking
        financialStatus: map(M_FINANCIAL, c.financialStatus),
        productUsage: map(M_USAGE, c.productUsage),
        usageChangeAlert: map(M_USAGE_CHANGE, c.usageChangeAlert),
        responseLevel: map(M_RESPONSE_LEVEL, c.responseLevel),
        // Churn
        cancellationRequest: c.cancellationRequest,
        offeredSolutions: c.offeredSolutions == null ? null : JSON.stringify(c.offeredSolutions),
        offerExpiryDate: toDate(c.offerExpiryDate),
        offerOutcome: c.offerOutcome,
        offerRejectionReason: c.offerRejectionReason,
        actionTaken: c.actionTaken,
        churnResult: map(M_CHURN, c.churnResult),
        retentionStatus: map(M_RETENTION, c.retentionStatus),
        followUpDate: toDate(c.followUpDate),
        // Çözüm / iptal
        resolutionNote: c.resolutionNote,
        cancellationReason: c.cancellationReason,
        // SLA
        slaResponseDueAt: toDate(c.slaResponseDueAt),
        slaResolutionDueAt: toDate(c.slaResolutionDueAt),
        slaViolation: c.slaViolation,
        slaPausedAt: toDate(c.slaPausedAt),
        slaPausedDurationMin: c.slaPausedDurationMin,
        slaThirdPartyWaitMin: c.slaThirdPartyWaitMin,
        // AI
        aiSummary: c.aiSummary,
        aiCategoryPrediction: c.aiCategoryPrediction,
        aiPriorityPrediction: c.aiPriorityPrediction,
        aiDuplicateScore: c.aiDuplicateScore,
        aiConfidenceScore: c.aiConfidenceScore,
        aiGeneratedFlag: c.aiGeneratedFlag,
        aiRejectReason: c.aiRejectReason,
        aiCallBrief: c.aiCallBrief,
        aiFollowupRecommendation: c.aiFollowupRecommendation,
        aiRetentionOfferSuggestion: c.aiRetentionOfferSuggestion,
        // Checklist
        checklistItems: c.checklistItems == null ? null : JSON.stringify(c.checklistItems),
        // Tarih
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        resolvedAt: toDate(c.resolvedAt),
        // İlişkili tablolar
        // Phase 1 add_company_id_to_child_tables migration sonrası tüm Case
        // child kayıtları companyId zorunlu — nested create'lerde Case.companyId
        // ile denormalize ediyoruz (schema: CaseNote/CaseAttachment/CaseActivity/
        // CaseCallLog hepsi `companyId String`).
        notes: {
          create: c.notes.map((n) => ({
            id: n.id,
            companyId: c.companyId,
            authorName: n.authorName,
            content: n.content,
            visibility: n.visibility,
            createdAt: new Date(n.createdAt),
          })),
        },
        attachments: {
          create: c.files.map((f) => ({
            id: f.id,
            companyId: c.companyId,
            fileName: f.fileName,
            fileSize: f.fileSize,
            mimeType: f.mimeType,
            fileUrl: f.dataUrl,
            uploadedBy: f.uploadedBy,
            uploadedAt: new Date(f.uploadedAt),
          })),
        },
        history: {
          create: c.history.map((h) => ({
            id: h.id,
            companyId: c.companyId,
            action: h.action,
            actionType: h.actionType,
            fieldName: h.fieldName,
            fromValue: h.fromValue,
            toValue: h.toValue,
            note: h.note,
            actor: h.actor,
            at: new Date(h.at),
          })),
        },
        callLogs: {
          create: c.callLogs.map((cl) => ({
            id: cl.id,
            companyId: c.companyId,
            callDate: new Date(cl.callDate),
            durationMin: cl.durationMin,
            callDisposition: map(M_CALL_DISP, cl.callDisposition),
            callOutcome: map(M_CALL_OUT, cl.callOutcome),
            description: cl.description,
            callerId: cl.callerId,
            callerName: cl.callerName,
            nextFollowupDate: toDate(cl.nextFollowupDate),
            lastInteractionDate: toDate(cl.lastInteractionDate),
          })),
        },
      },
    });
    caseProgress++;
    if (caseProgress % 25 === 0) {
      console.log(`    ${caseProgress}/${MOCK_CASES.length}`);
    }
  }
  console.log(`  ✓ ${MOCK_CASES.length} vaka`);

  console.log('\n✅ Seed tamamlandı.');
}

main()
  .catch((e) => {
    console.error('\n❌ Seed hatası:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
