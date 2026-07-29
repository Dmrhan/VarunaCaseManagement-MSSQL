// Smoke test — Varuna↔Connect GET-liste + GET-detay + POST-create +
// attachment-ingest dilimleri (server/routes/connectApi.js,
// server/db/connectResolver.js, server/db/caseRepository.js,
// server/lib/connectMapper.js).
//
// ⚠️ POST /tickets (create) VE POST /tickets/:id/attachments (ingest) — bu
// script PROD'A ASLA CASE/CaseAttachment INSERT ETMEZ, disk'e dosya YAZMAZ.
// HTTP route testleri yalnız yazma-ETMEYEN yolları dener: auth (401),
// scope/gövde validasyonu (400/413/404) ve code-çözümleme fail-closed'ı
// (422 code_not_found) — bunlar caseRepository.create()/
// ingestExternalAttachment()'a ULAŞMADAN erken döner. `createConnectCase` ve
// `caseRepository.ingestExternalAttachment` bu dosyada YALNIZ "wiring" birim
// testlerinde çağrılır; o testlerde `caseRepository.create` / `prisma.case.*`
// / `prisma.caseAttachment.create` / `storageApi.saveObject` GEÇİCİ OLARAK
// STUB'LANIR (DB'ye gitmez, diske yazmaz, sahte veriler döner) — orijinal
// fonksiyonlar try/finally ile HER KOŞULDA geri yüklenir. Gerçek create/
// upload happy-path canlı ortamda kontrollü/manuel yapılır (bkz.
// server/routes/connectApi.js dosya sonu curl yorumları).
//
// Canlı DB'ye ÇOĞUNLUKLA DOKUNMAZ: connectResolver'ın validasyon adımları
// (invalid merkez kodu / boş codes / boş authorizedCodes / IDOR guard /
// pickSingleProjectMatch 0-1-çoklu karar mantığı) hiçbir prisma sorgusu
// ÇALIŞTIRMADAN throw/early-return eder. Birkaç test (bkz. "canlı DB —
// best effort" ve "== 6)" bölümleri) gerçek tablolara SALT-OKUMA gider — bu
// ortamda DATABASE_URL erişilebilir olduğu doğrulandığı için dahil edildi,
// ama DB erişilemezse net bir FAIL ile (hang değil — timeout'lu fetch)
// haber verir.
//
// Kullanım: node --env-file-if-exists=.env scripts/smoke-connect-tickets.mjs
//
// MANUEL CANLI TEST (gerçek merkez/case ile, bu script'in KAPSAMADIĞI adım):
//   CONNECT_API_KEY=<gercek-key> node --env-file=.env server/index.js
//   curl -s "http://localhost:3101/api/connect/tickets?scope=merkez&code=198" \
//     -H "x-api-key: <gercek-key>" | jq .
//   (merkez kod 198 = Vodafone örneği — görev talimatından)
//   # Liste yanıtındaki bir "id" (Case.caseNumber, ör. "OLD_123456") ile detay:
//   curl -s "http://localhost:3101/api/connect/tickets/OLD_123456?scope=merkez&code=198" \
//     -H "x-api-key: <gercek-key>" | jq .
//   # POST create (GERÇEK INSERT — bkz. server/routes/connectApi.js dosya
//   # sonu için tam curl + test-sonrası temizleme notu):
//   #   ÖN KOŞUL: prisma/migrations/20260727_case_origin_connect UYGULANMIŞ
//   #   olmalı (CK_Case_origin constraint'i 'Connect' değerine izin vermeli),
//   #   aksi halde POST her zaman 500 (constraint violation) döner.
//   # POST attachment ingest (GERÇEK CaseAttachment INSERT + disk yazımı —
//   # bkz. server/routes/connectApi.js dosya sonu için tam curl + test-eki
//   # temizleme notu).

import http from 'node:http';
import assert from 'node:assert/strict';
import {
  mapCaseToConnectTicket,
  mapCaseToConnectDetail,
  mapConnectTypeToRequestType,
  CONNECT_TYPE_TO_REQUEST_TYPE,
  toConnectStatus,
  STATUS_CROSSWALK,
  desensitizeTeamJargon,
} from '../server/lib/connectMapper.js';
import { M_STATUS, M_REQUEST } from '../server/db/enumMap.js';
import {
  resolveCodesForMerkez,
  findCasesByCodes,
  findCaseDetailByNumber,
  resolveAuthorizedCaseId,
  resolveCreatorDisplayName,
  resolveWaitReason,
  isCodeAuthorized,
  pickSingleProjectMatch,
  resolveSingleProjectByCode,
  createConnectCase,
  CONNECT_CASE_CATEGORY,
  CONNECT_CASE_SUBCATEGORY,
  CONNECT_ACTOR_DISPLAY_NAME,
  ConnectResolverError,
  DETAIL_CHILD_CAP,
} from '../server/db/connectResolver.js';
import { caseRepository, CaseValidationError } from '../server/db/caseRepository.js';
import { prisma } from '../server/db/client.js';
import { storageApi } from '../server/db/storage.js';

// mapCaseToConnectDetail'in ihtiyaç duyduğu zorunlu alanlarla minimal sahte
// Case satırı — her yeni testte tüm alanları tekrar yazmamak için (Metz:
// erken-DRY değil ama burada gerçek tekrar var, factory mantıklı).
function makeFakeDetailRow(overrides = {}) {
  return {
    id: 'c-fake',
    caseNumber: 'UNV-FAKE',
    title: 'Sahte başlık',
    description: 'Sahte açıklama',
    status: 'Acik',
    category: null,
    subCategory: null,
    caseType: 'GeneralSupport',
    origin: 'Telefon',
    assignedPersonName: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    slaResponseDueAt: null,
    slaResolutionDueAt: null,
    slaViolation: false,
    resolutionNote: null,
    notes: [],
    history: [],
    attachments: [],
    ...overrides,
  };
}

// Live-DB dokunan testler için bounded timeout — sandbox'ta ağ/DB
// erişilemezse suite SONSUZ ASILI KALMASIN (Collina disiplini: hang yerine
// net, hızlı FAIL).
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

let passed = 0;
function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  OK   ${label}`);
    })
    .catch((err) => {
      console.error(`  FAIL ${label}\n       ${err?.message || err}`);
      process.exitCode = 1;
    });
}

async function main() {
  console.log('== 1) connectMapper — saf fonksiyon testleri (sahte Case) ==');

  await check('mapCaseToConnectTicket — bilinen status crosswalk', () => {
    const fakeCase = {
      id: 'c1',
      caseNumber: 'UNV-1000042',
      title: 'Fatura görünmüyor',
      description: 'Müşteri e-faturayı göremiyor.',
      status: 'Incelemede',
      category: 'Fatura',
      subCategory: 'E-Fatura',
      caseType: 'GeneralSupport',
      origin: 'Telefon',
      assignedPersonName: 'Ayşe Yılmaz',
      createdAt: new Date('2026-07-20T10:00:00.000Z'),
      updatedAt: new Date('2026-07-21T11:30:00.000Z'),
      slaResponseDueAt: new Date('2026-07-20T12:00:00.000Z'),
      slaResolutionDueAt: new Date('2026-07-22T10:00:00.000Z'),
      slaViolation: false,
    };
    const ticket = mapCaseToConnectTicket(fakeCase);
    assert.equal(ticket.id, 'UNV-1000042');
    assert.equal(ticket.status, 'Üzerinde Çalışılıyor');
    assert.equal(ticket.statusRaw, 'Incelemede');
    assert.equal(ticket.type, 'GeneralSupport');
    assert.equal(ticket.assignee, 'Ayşe Yılmaz');
    assert.equal(ticket.sla.violated, false);
    assert.equal(ticket.sla.responseDueAt, '2026-07-20T12:00:00.000Z');
    assert.equal(ticket.createdAt, '2026-07-20T10:00:00.000Z');
  });

  await check('STATUS_CROSSWALK — enumMap.js::M_STATUS\'un TAMAMINI kapsar (gerçek export\'lara karşı, elle kopya YOK)', () => {
    // enumMap.js M_STATUS TR→ASCII map'i; değerleri (ASCII identifier'lar)
    // Case.status'un olası tüm değerleridir. Yeni bir status eklenip
    // connectMapper.js'deki STATUS_CROSSWALK güncellenmezse bu test FAIL
    // olur (sessiz kaçağı derleme zamanında değil ama CI/smoke zamanında yakalar).
    const allCaseStatuses = Object.values(M_STATUS);
    const crosswalkKeys = new Set(Object.keys(STATUS_CROSSWALK));
    const missing = allCaseStatuses.filter((s) => !crosswalkKeys.has(s));
    assert.deepEqual(missing, [], `STATUS_CROSSWALK'ta eksik status(ler): ${missing.join(', ')}`);

    // Ters yön — crosswalk'ta M_STATUS'ta olmayan (artık kullanılmayan/yazım
    // hatalı) bir anahtar kalmışsa da yakala.
    const allCaseStatusSet = new Set(allCaseStatuses);
    const extra = Object.keys(STATUS_CROSSWALK).filter((k) => !allCaseStatusSet.has(k));
    assert.deepEqual(extra, [], `STATUS_CROSSWALK'ta M_STATUS'ta olmayan fazladan anahtar(lar): ${extra.join(', ')}`);
  });

  await check('toConnectStatus — crosswalk\'taki her değer doğru döner', () => {
    for (const [raw, expected] of Object.entries(STATUS_CROSSWALK)) {
      assert.equal(toConnectStatus(raw), expected, `crosswalk mismatch for ${raw}`);
    }
  });

  await check('mapCaseToConnectTicket — bilinmeyen status ham değeri geçirir (log + no throw)', () => {
    assert.equal(toConnectStatus('BilinmeyenStatu'), 'BilinmeyenStatu');
  });

  await check('mapCaseToConnectTicket — null Case → null (defensive)', () => {
    assert.equal(mapCaseToConnectTicket(null), null);
  });

  await check('mapCaseToConnectDetail — null Case → null (defensive)', () => {
    assert.equal(mapCaseToConnectDetail(null), null);
  });

  await check(
    'mapCaseToConnectDetail — comments/history/attachments doğru şekillenir (sahte Case + child\'lar)',
    () => {
      // createDownloadUrl (server/db/storage.js) JWT_SECRET ister — bu
      // sandbox'ın shell profile'ında yok; testin ortamdan bağımsız
      // deterministik çalışması için geçici bir değerle set edilip
      // hemen sonra eski haline döndürülür (env kirletme YOK).
      const originalJwtSecret = process.env.JWT_SECRET;
      process.env.JWT_SECRET = originalJwtSecret || 'smoke-test-only-not-a-real-secret';
      try {
        const fakeDetailRow = {
          id: 'c1',
          caseNumber: 'UNV-1000042',
          title: 'Fatura görünmüyor',
          description: 'Müşteri e-faturayı göremiyor.',
          status: 'Cozuldu',
          category: 'Fatura',
          subCategory: 'E-Fatura',
          caseType: 'GeneralSupport',
          origin: 'Telefon',
          assignedPersonName: 'Ayşe Yılmaz',
          createdAt: new Date('2026-07-20T10:00:00.000Z'),
          updatedAt: new Date('2026-07-21T11:30:00.000Z'),
          slaResponseDueAt: null,
          slaResolutionDueAt: null,
          slaViolation: false,
          resolutionNote: 'Müşteriye tekrar link gönderildi.',
          notes: [
            { id: 'n1', authorName: 'Mehmet Agent', content: 'Kontrol ediyorum.', createdAt: new Date('2026-07-20T11:00:00.000Z') },
          ],
          history: [
            {
              actionType: 'StatusChange',
              action: 'Statü değişti',
              fromValue: 'Açık',
              toValue: 'İncelemede',
              note: null,
              at: new Date('2026-07-20T10:05:00.000Z'),
              actor: 'Mehmet Agent',
            },
            {
              actionType: 'StatusChange',
              action: 'Statü değişti',
              fromValue: 'İncelemede',
              toValue: 'Çözüldü',
              note: null,
              at: new Date('2026-07-21T11:30:00.000Z'),
              actor: 'Mehmet Agent',
            },
          ],
          attachments: [
            {
              id: 'att1',
              fileName: 'fatura.pdf',
              fileSize: 12345,
              mimeType: 'application/pdf',
              fileUrl: 'cases/c1/att1-fatura.pdf',
              uploadedBy: 'Mehmet Agent',
              uploadedAt: new Date('2026-07-20T10:10:00.000Z'),
            },
          ],
        };

        const detail = mapCaseToConnectDetail(fakeDetailRow);

        // Liste alanları base'den (mapCaseToConnectTicket) miras kalıyor.
        assert.equal(detail.id, 'UNV-1000042');
        assert.equal(detail.status, 'Kapatıldı');
        assert.equal(detail.resolutionNote, 'Müşteriye tekrar link gönderildi.');

        assert.equal(detail.comments.length, 1);
        assert.deepEqual(detail.comments[0], {
          id: 'n1',
          author: 'Mehmet Agent',
          text: 'Kontrol ediyorum.',
          createdAt: '2026-07-20T11:00:00.000Z',
        });

        // history — TR label (Açık/İncelemede/Çözüldü) doğru crosswalk'lanır
        // (enumMap.js::M_STATUS TR→ASCII → connectMapper.js::STATUS_CROSSWALK).
        assert.equal(detail.history.length, 2);
        assert.equal(detail.history[0].fromStatus, 'Yeni Kayıt');
        assert.equal(detail.history[0].toStatus, 'Üzerinde Çalışılıyor');
        assert.equal(detail.history[0].type, 'StatusChange');
        assert.equal(detail.history[0].action, 'Statü değişti');
        assert.equal(detail.history[0].from, 'Açık');
        assert.equal(detail.history[0].to, 'İncelemede');
        assert.equal(detail.history[1].toStatus, 'Kapatıldı');
        assert.equal(detail.history[1].by, 'Mehmet Agent');

        assert.equal(detail.attachments.length, 1);
        const att = detail.attachments[0];
        assert.equal(att.fileName, 'fatura.pdf');
        assert.equal(att.mimeType, 'application/pdf');
        assert.equal(att.fileSize, 12345);
        assert.match(att.downloadUrl, /^\/api\/cases\/c1\/files\/att1\/raw\?token=.+$/);
      } finally {
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
      }
    },
  );

  await check(
    'mapCaseToConnectDetail — Transfer/CaseCreated aktiviteleri: ham from/to + note geçer, fromStatus/toStatus crosswalk\'a SOKULMAZ (gereksiz warn yok)',
    () => {
      const warnCalls = [];
      const originalWarn = console.warn;
      console.warn = (...args) => warnCalls.push(args.join(' '));
      try {
        const fakeRow = makeFakeDetailRow({
          history: [
            {
              actionType: 'CaseCreated',
              action: 'Vaka oluşturuldu',
              fromValue: null,
              toValue: null,
              note: null,
              at: new Date('2026-07-20T09:00:00.000Z'),
              actor: 'Ayşe Yılmaz',
            },
            {
              actionType: 'Transfer',
              // Gerçek Varuna takım adları (bkz. caseRepository.js Team seed) —
              // "Destek L1"/"Destek L2" DEĞİL, "Univera L1"/"Univera L2".
              action: '↔ Vaka aktarıldı: Univera L1 → Univera L2',
              fromValue: 'Univera L1',
              toValue: 'Univera L2',
              note: 'Gerekçe: Uzmanlık — konuyu size sunuyorum\n\nKişi: Yiğit Bayar → Damla Bülbül',
              at: new Date('2026-07-20T10:00:00.000Z'),
              actor: 'Mehmet Agent',
            },
          ],
        });
        const detail = mapCaseToConnectDetail(fakeRow);
        assert.equal(detail.history.length, 2);

        const created = detail.history[0];
        assert.equal(created.type, 'CaseCreated');
        assert.equal(created.action, 'Vaka oluşturuldu');
        assert.equal(created.fromStatus, null, 'CaseCreated status-crosswalk\'a girmemeli');
        assert.equal(created.toStatus, null);

        const transfer = detail.history[1];
        assert.equal(transfer.type, 'Transfer');
        // Security veto (2026-07-29, HIGH) — iç ekip kodu (Univera L1/L2)
        // müşteri-dostu etikete çevrilmiş dönmeli (bkz. desensitizeTeamJargon).
        assert.equal(transfer.from, 'Çağrı Merkezi', 'Univera L1 → Çağrı Merkezi çevrilmedi');
        assert.equal(transfer.to, 'Yazılım Destek', 'Univera L2 → Yazılım Destek çevrilmedi');
        assert.equal(transfer.action, '↔ Vaka aktarıldı: Çağrı Merkezi → Yazılım Destek');
        assert.equal(transfer.fromStatus, null, 'Transfer takım adı status-crosswalk\'a girmemeli');
        assert.equal(transfer.toStatus, null);
        // Kişi adları (kimden kime) AYNEN kalmalı — yalnız ekip kodu çevrilir.
        assert.equal(transfer.note, 'Gerekçe: Uzmanlık — konuyu size sunuyorum\n\nKişi: Yiğit Bayar → Damla Bülbül');
        assert.equal(transfer.by, 'Mehmet Agent');

        assert.deepEqual(warnCalls, [], 'Transfer/CaseCreated takım adları status-crosswalk uyarısı TETİKLEMEMELİ');
      } finally {
        console.warn = originalWarn;
      }
    },
  );

  await check(
    'desensitizeTeamJargon — Security veto (2026-07-29, HIGH): iç ekip/tier kodları (L1/L2) müşteri-dostu etikete çevrilir, kişi adları ETKİLENMEZ',
    () => {
      // Temel takım adları.
      assert.equal(desensitizeTeamJargon('Univera L1'), 'Çağrı Merkezi');
      assert.equal(desensitizeTeamJargon('Univera L2'), 'Yazılım Destek');
      // Alt takımlar — uzun/özgül desen ÖNCE eşleşmeli (yarım/bozuk çeviri YOK).
      assert.equal(desensitizeTeamJargon('Univera L2 Uzman Destek'), 'Yazılım Destek (Uzman)');
      assert.equal(desensitizeTeamJargon('Univera L2 Yurtdışı'), 'Yazılım Destek (Yurtdışı)');
      // Action cümlesi içinde geçtiğinde de doğru çevrilir.
      assert.equal(
        desensitizeTeamJargon('↔ Vaka aktarıldı: Univera L1 → Univera L2'),
        '↔ Vaka aktarıldı: Çağrı Merkezi → Yazılım Destek',
      );
      // Smart Ticket devir notundaki "L1 Notu:" literal işaretleyicisi.
      assert.equal(
        desensitizeTeamJargon('L1 Notu:\ndanone tikveşli projesi...'),
        'Çağrı Merkezi Notu:\ndanone tikveşli projesi...',
      );
      // AI'nin ürettiği serbest-metin özette (Smart Ticket composedSummary)
      // geçen STANDALONE "L1" token'ı — tam-dize tabloda YOK, word-boundary
      // regex ikinci geçişte yakalamalı.
      assert.equal(
        desensitizeTeamJargon('L1 çözüm adımı kaydı yok.'),
        'Çağrı Merkezi çözüm adımı kaydı yok.',
      );
      // False-positive KORUMASI — "L1"/"L2" başka bir kelimenin İÇİNDE
      // geçerse (word boundary yok) YAKALANMAMALI.
      assert.equal(desensitizeTeamJargon('URL2 parametresi geçersiz'), 'URL2 parametresi geçersiz');
      // Kişi adları (kimden kime) — jargon tablosunda YOK, ETKİLENMEMELİ.
      assert.equal(
        desensitizeTeamJargon('Kişi: Yiğit Bayar → Damla Bülbül'),
        'Kişi: Yiğit Bayar → Damla Bülbül',
      );
      // Jargon içermeyen diğer gerçek takım adları (zaten müşteri-dostu) —
      // ETKİLENMEMELİ.
      assert.equal(desensitizeTeamJargon('Univera Operasyon Destek'), 'Univera Operasyon Destek');
      assert.equal(desensitizeTeamJargon('Customer Success'), 'Customer Success');
      // Defensive — null/undefined/non-string olduğu gibi döner (throw YOK).
      assert.equal(desensitizeTeamJargon(null), null);
      assert.equal(desensitizeTeamJargon(undefined), undefined);
      assert.equal(desensitizeTeamJargon(''), '');
    },
  );

  await check(
    'resolveCreatorDisplayName — createdBy.fullName öncelikli, yoksa CaseCreated aktivitesinin actor\'ı, hiçbiri yoksa null',
    () => {
      assert.equal(
        resolveCreatorDisplayName({ createdBy: { fullName: 'Ayşe Yılmaz' }, history: [] }),
        'Ayşe Yılmaz',
      );
      assert.equal(
        resolveCreatorDisplayName({
          createdBy: null,
          history: [{ actionType: 'CaseCreated', actor: 'Connect Entegrasyonu' }],
        }),
        'Connect Entegrasyonu',
      );
      assert.equal(resolveCreatorDisplayName({ createdBy: null, history: [] }), null);
      assert.equal(resolveCreatorDisplayName({}), null);
    },
  );

  await check(
    'resolveWaitReason — yalnız ThirdPartyWaiting statüsünde dolu döner (stale thirdPartyNote başka statüde sızmaz)',
    () => {
      assert.deepEqual(
        resolveWaitReason({ status: 'ThirdPartyWaiting', thirdPartyName: 'Lojistik A.Ş.', thirdPartyNote: 'Kargo takip bekleniyor.' }),
        { waitReason: 'Kargo takip bekleniyor.', thirdPartyName: 'Lojistik A.Ş.' },
      );
      // Not girilmemiş (requiresNote=false tanım) — yalnız 3. parti adı.
      assert.deepEqual(
        resolveWaitReason({ status: 'ThirdPartyWaiting', thirdPartyName: 'Lojistik A.Ş.', thirdPartyNote: null }),
        { waitReason: 'Lojistik A.Ş.', thirdPartyName: 'Lojistik A.Ş.' },
      );
      // Statüden çıkılmış — thirdPartyNote kalıcı (schema yorumu) ama STALE,
      // gösterilmemeli.
      assert.deepEqual(
        resolveWaitReason({ status: 'Incelemede', thirdPartyName: null, thirdPartyNote: 'Eski bekleme nedeni.' }),
        { waitReason: null, thirdPartyName: null },
      );
      assert.deepEqual(
        resolveWaitReason({ status: 'Acik', thirdPartyName: null, thirdPartyNote: null }),
        { waitReason: null, thirdPartyName: null },
      );
    },
  );

  await check(
    'mapCaseToConnectDetail — history bozuk/case-mismatch TR label: KARAR — ham değer korunur + warn tetikler',
    () => {
      // KARAR (Delivery Lead, QA veto sonrası): CaseActivity.fromValue/
      // toValue kaynak `transitionStatus` tarafından HER ZAMAN geçerli
      // M_STATUS TR label'ı olarak yazılır — bozuk/case-mismatch bir değer
      // (ör. küçük harf "açık", ya da hiç enum olmayan "Bilinmeyen Durum")
      // ancak veri bozulmasında oluşur. Bu durumda BEKLENEN davranış: ham
      // değeri sessizce "hepsi aynı"laştırmadan geçirmek + LOGLAMAK — asla
      // throw/500 değil (görüntü alanı, akışı kilitlememeli).
      const warnCalls = [];
      const originalWarn = console.warn;
      console.warn = (...args) => warnCalls.push(args.join(' '));
      try {
        const fakeRow = makeFakeDetailRow({
          history: [
            {
              actionType: 'StatusChange',
              // Küçük harf — M_STATUS anahtarları TAM "Açık" (case-sensitive
              // object key lookup) — "açık" hiçbir tabloda eşleşmez.
              fromValue: 'açık',
              // Hiçbir enum değeri değil — ne M_STATUS'ta ne STATUS_CROSSWALK'ta.
              toValue: 'Bilinmeyen Durum',
              at: new Date('2026-01-05T00:00:00.000Z'),
              actor: 'Test Kullanıcı',
            },
          ],
        });
        const detail = mapCaseToConnectDetail(fakeRow);
        assert.equal(detail.history.length, 1);
        assert.equal(detail.history[0].fromStatus, 'açık', 'case-mismatch TR label ham geçmedi');
        assert.equal(detail.history[0].toStatus, 'Bilinmeyen Durum', 'bilinmeyen TR label ham geçmedi');
        assert.ok(warnCalls.some((w) => w.includes('açık')), "'açık' için console.warn tetiklenmedi");
        assert.ok(
          warnCalls.some((w) => w.includes('Bilinmeyen Durum')),
          "'Bilinmeyen Durum' için console.warn tetiklenmedi",
        );
      } finally {
        console.warn = originalWarn;
      }
    },
  );

  await check(
    `mapCaseToConnectDetail — DETAIL_CHILD_CAP (${DETAIL_CHILD_CAP}): aşım durumunda en-yeni-N tutulur + eski→yeni sıra korunur`,
    () => {
      const totalNotes = DETAIL_CHILD_CAP + 50;
      // Ascending (eski→yeni) — resolver sözleşmesiyle aynı sıra varsayımı.
      const notes = Array.from({ length: totalNotes }, (_, i) => ({
        id: `n${i}`,
        authorName: `Yazar ${i}`,
        content: `Not ${i}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i, 0)),
      }));
      const fakeRow = makeFakeDetailRow({ notes });

      const detail = mapCaseToConnectDetail(fakeRow);

      assert.equal(detail.comments.length, DETAIL_CHILD_CAP, 'cap uygulanmadı');
      // En yeni CAP kadarı tutulur — ilk kalan not = index (totalNotes - CAP).
      assert.equal(detail.comments[0].id, `n${totalNotes - DETAIL_CHILD_CAP}`);
      assert.equal(detail.comments[detail.comments.length - 1].id, `n${totalNotes - 1}`);
      // Eski→yeni sıra korunur (kalanlar arasında).
      const firstAt = new Date(detail.comments[0].createdAt).getTime();
      const lastAt = new Date(detail.comments[detail.comments.length - 1].createdAt).getTime();
      assert.ok(firstAt < lastAt, 'kronolojik (eski→yeni) sıra korunmadı');
    },
  );

  await check('mapCaseToConnectDetail — attachment fileUrl eksik → downloadUrl null fallback', () => {
    const fakeRow = makeFakeDetailRow({
      attachments: [
        {
          id: 'att-missing-url',
          fileName: 'eski-dosya.txt',
          fileSize: 10,
          mimeType: 'text/plain',
          fileUrl: null, // beklenmeyen eski/bozuk kayıt senaryosu
          uploadedBy: 'Eski Kullanıcı',
          uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });
    const detail = mapCaseToConnectDetail(fakeRow);
    assert.equal(detail.attachments.length, 1);
    assert.equal(detail.attachments[0].downloadUrl, null);
    assert.equal(detail.attachments[0].fileName, 'eski-dosya.txt');
  });

  await check(
    "mapConnectTypeToRequestType — Connect tipleri (Soru/Talep/Öneri/Şikayet/Hata) Varuna requestType'a eşlenir",
    () => {
      assert.equal(mapConnectTypeToRequestType('Soru'), 'Bilgi', "Varuna'da 'Soru' yok — en yakın 'Bilgi' olmalı");
      assert.equal(mapConnectTypeToRequestType('Talep'), 'Talep');
      assert.equal(mapConnectTypeToRequestType('Öneri'), 'Oneri');
      assert.equal(mapConnectTypeToRequestType('Şikayet'), 'Sikayet');
      assert.equal(mapConnectTypeToRequestType('Hata'), 'Hata');
    },
  );

  await check("mapConnectTypeToRequestType — bilinmeyen/geçersiz tip → null (route 400'e çevirir)", () => {
    assert.equal(mapConnectTypeToRequestType('BilinmeyenTip'), null);
    assert.equal(mapConnectTypeToRequestType(''), null);
    assert.equal(mapConnectTypeToRequestType(null), null);
    assert.equal(mapConnectTypeToRequestType(undefined), null);
    assert.equal(mapConnectTypeToRequestType(42), null);
  });

  await check(
    "CONNECT_TYPE_TO_REQUEST_TYPE — tüm değerler enumMap.js::M_REQUEST'in ÜRETTİĞİ ASCII kümesinin alt-kümesi (gerçek export'a karşı, elle kopya YOK)",
    () => {
      // M_REQUEST bir TR→ASCII forward map; ÜRETTİĞİ ASCII değerler
      // (Object.values) Case.requestType'ın olası tüm değerleridir.
      // CONNECT_TYPE_TO_REQUEST_TYPE'ın her değeri bu kümede olmalı —
      // aksi halde connectMapper yanlış/var-olmayan bir requestType üretir
      // ve caseRepository.create() bunu sessizce (ya da hatalı) kabul
      // edebilir. STATUS_CROSSWALK-tamlık testinin muadili (ama TAM eşleşme
      // değil, ALT-KÜME — Varuna'nın her requestType'ının Connect'te bir
      // karşılığı olması ZORUNLU değil).
      const validRequestTypes = new Set(Object.values(M_REQUEST));
      const invalidValues = Object.entries(CONNECT_TYPE_TO_REQUEST_TYPE).filter(
        ([, ascii]) => !validRequestTypes.has(ascii),
      );
      assert.deepEqual(
        invalidValues,
        [],
        `CONNECT_TYPE_TO_REQUEST_TYPE'da geçersiz/var-olmayan requestType değeri: ${JSON.stringify(invalidValues)}`,
      );
    },
  );

  console.log('\n== 2) connectResolver — fail-closed validasyon (DB\'ye GİTMEDEN) ==');

  await check(
    "pickSingleProjectMatch — saf karar mantığı (0/1/>1 eşleşme, DB'siz/mock)",
    () => {
      // 0 eşleşme → code_not_found.
      assert.throws(
        () => pickSingleProjectMatch([], '10005'),
        (err) => err instanceof ConnectResolverError && err.code === 'code_not_found',
      );
      // 1 eşleşme → aynı öğeyi döner (throw YOK).
      const single = { id: 'ap1', name: 'Proje 1' };
      assert.equal(pickSingleProjectMatch([single], '10005'), single);
      // >1 eşleşme → code_ambiguous (mock — iki sahte aday).
      assert.throws(
        () => pickSingleProjectMatch([{ id: 'ap1' }, { id: 'ap2' }], '10005'),
        (err) => err instanceof ConnectResolverError && err.code === 'code_ambiguous',
      );
    },
  );

  await check(
    "createConnectCase — wiring birim testi (caseRepository.create GEÇİCİ STUB'lanır, DB'ye gitmez)",
    async () => {
      // caseRepository bir plain object export'u (Object.freeze YOK) —
      // ES module namespace import'u AYNI obje referansını verir, bu
      // yüzden burada bir property'sini geçici değiştirmek
      // connectResolver.js::createConnectCase'in kullandığı AYNI
      // caseRepository.create'i etkiler. try/finally ile HER KOŞULDA
      // (assertion fail etse bile) orijinal fonksiyon geri yüklenir.
      const originalCreate = caseRepository.create;
      let capturedInput = null;
      let capturedActor = null;
      caseRepository.create = async (input, actor) => {
        capturedInput = input;
        capturedActor = actor;
        // Sahte dönüş — gerçek create()'in shape()'inden (fromDb) TR-label
        // döndürdüğü sözleşmeyi taklit eder (connectApi.js POST handler'ı
        // created.status'u böyle bekliyor).
        return { id: 'fake-id', caseNumber: 'UNV-FAKE-9999', status: 'Açık' };
      };
      try {
        const fakeProject = {
          accountProjectId: 'ap-fake-1',
          accountId: 'acc-fake-1',
          accountName: 'Sahte Hesap',
          companyId: 'comp-fake-univera',
        };
        const result = await createConnectCase({
          project: fakeProject,
          title: 'Wiring test başlık',
          description: 'Wiring test açıklama',
          requestType: 'Talep',
          createdByEmail: 'wiring-test@example.com',
        });

        assert.ok(capturedInput, 'caseRepository.create hiç çağrılmadı');
        assert.equal(capturedInput.origin, 'Connect');
        assert.equal(capturedInput.accountId, fakeProject.accountId);
        assert.equal(capturedInput.accountProjectId, fakeProject.accountProjectId);
        assert.equal(capturedInput.companyId, fakeProject.companyId);
        assert.equal(capturedInput.category, CONNECT_CASE_CATEGORY);
        assert.equal(capturedInput.subCategory, CONNECT_CASE_SUBCATEGORY);
        assert.equal(capturedInput.requestType, 'Talep');
        assert.equal(capturedInput.customerContactEmail, 'wiring-test@example.com', "createdByEmail customerContactEmail'e bağlanmadı");
        assert.equal(capturedInput.title, 'Wiring test başlık');
        assert.equal(capturedInput.description, 'Wiring test açıklama');

        assert.ok(capturedActor, 'actor caseRepository.create()e iletilmedi');
        assert.equal(capturedActor.userId, null, 'servis-actor userId NULL olmalı (User FK ihlali yok)');
        assert.equal(typeof capturedActor.displayName, 'string');
        assert.ok(capturedActor.displayName.length > 0, 'displayName dolu olmalı (assertActor gereği)');
        assert.notEqual(capturedActor.role, 'SystemAdmin', 'servis-actor SystemAdmin rolü KULLANMAMALI');

        assert.equal(result.caseNumber, 'UNV-FAKE-9999');
      } finally {
        caseRepository.create = originalCreate;
      }
    },
  );

  await check('resolveCodesForMerkez — tamsayı olmayan kod throw eder (ConnectResolverError)', async () => {
    await assert.rejects(() => resolveCodesForMerkez('abc'), ConnectResolverError);
  });

  await check('resolveCodesForMerkez — negatif/sıfır kod throw eder', async () => {
    await assert.rejects(() => resolveCodesForMerkez(-1), ConnectResolverError);
    await assert.rejects(() => resolveCodesForMerkez(0), ConnectResolverError);
  });

  await check('resolveCodesForMerkez — SQLi denemesi (string) tamsayı-değil olarak reddedilir', async () => {
    // Number("198; DROP TABLE Case;--") => NaN → Number.isInteger false → throw.
    // Query'ye hiç ULAŞMAZ (fail-closed, ikinci savunma katmanı).
    await assert.rejects(() => resolveCodesForMerkez('198; DROP TABLE Case;--'), ConnectResolverError);
  });

  await check('findCasesByCodes — boş codes → boş sonuç, DB\'ye gitmez (fail-closed)', async () => {
    const result = await findCasesByCodes([]);
    assert.deepEqual(result, { items: [], total: 0 });
  });

  await check('findCasesByCodes — codes array değilse (null/undefined) → boş sonuç', async () => {
    assert.deepEqual(await findCasesByCodes(null), { items: [], total: 0 });
    assert.deepEqual(await findCasesByCodes(undefined), { items: [], total: 0 });
  });

  await check('isCodeAuthorized — IDOR guard saf mantık (DB\'siz)', () => {
    assert.equal(isCodeAuthorized('A', ['A', 'B']), true);
    assert.equal(isCodeAuthorized('C', ['A', 'B']), false);
    assert.equal(isCodeAuthorized(null, ['A', 'B']), false);
    assert.equal(isCodeAuthorized('', ['A', 'B']), false);
    assert.equal(isCodeAuthorized('A', null), false);
    assert.equal(isCodeAuthorized('A', []), false);
  });

  await check('findCaseDetailByNumber — authorizedCodes boş → null, DB\'ye gitmez (fail-closed)', async () => {
    assert.equal(await findCaseDetailByNumber('UNV-1000042', []), null);
    assert.equal(await findCaseDetailByNumber('UNV-1000042', null), null);
  });

  await check('findCaseDetailByNumber — caseNumber boş/geçersiz → null, DB\'ye gitmez', async () => {
    assert.equal(await findCaseDetailByNumber('', ['A']), null);
    assert.equal(await findCaseDetailByNumber(null, ['A']), null);
    assert.equal(await findCaseDetailByNumber(undefined, ['A']), null);
  });

  await check(
    "resolveAuthorizedCaseId — authorizedCodes/caseNumber boş → null, DB'ye gitmez (fail-closed, findCaseDetailByNumber ile aynı desen)",
    async () => {
      assert.equal(await resolveAuthorizedCaseId('UNV-1000042', []), null);
      assert.equal(await resolveAuthorizedCaseId('UNV-1000042', null), null);
      assert.equal(await resolveAuthorizedCaseId('', ['A']), null);
      assert.equal(await resolveAuthorizedCaseId(null, ['A']), null);
    },
  );

  await check(
    "caseRepository.ingestExternalAttachment — wiring birim testi (prisma.case/caseAttachment + storageApi GEÇİCİ STUB'lanır, gerçek disk/DB YOK)",
    async () => {
      const originalFindUnique = prisma.case.findUnique;
      const originalCaseUpdate = prisma.case.update;
      const originalAttachmentCreate = prisma.caseAttachment.create;
      const originalSaveObject = storageApi.saveObject;
      const originalBuildPath = storageApi.buildPath;

      let capturedFindUniqueWhere = null;
      let capturedAttachmentData = null;
      let capturedHistoryEntry = null;
      let capturedSavedPath = null;
      let capturedSavedBuffer = null;

      prisma.case.findUnique = async ({ where }) => {
        capturedFindUniqueWhere = where;
        return { id: 'fake-case-id-1', companyId: 'fake-company-1', attachments: [] };
      };
      storageApi.buildPath = (caseId, attachmentId, fileName) => `cases/${caseId}/${attachmentId}-${fileName}`;
      storageApi.saveObject = async (relPath, buffer) => {
        capturedSavedPath = relPath;
        capturedSavedBuffer = buffer;
        // GERÇEK DİSK YAZMA YOK — bu stub yalnız argümanları yakalar.
      };
      prisma.caseAttachment.create = async ({ data }) => {
        capturedAttachmentData = data;
        return { ...data };
      };
      prisma.case.update = async ({ data }) => {
        capturedHistoryEntry = data.history?.create ?? null;
        return {};
      };

      try {
        const fakeBuffer = Buffer.from('smoke test attachment content', 'utf8');
        const result = await caseRepository.ingestExternalAttachment('fake-case-id-1', {
          fileName: 'smoke-test.txt',
          mimeType: 'text/plain',
          buffer: fakeBuffer,
          uploadedByLabel: CONNECT_ACTOR_DISPLAY_NAME,
        });

        assert.equal(capturedFindUniqueWhere?.id, 'fake-case-id-1', 'caseId ile Case sorgulanmadı');

        assert.ok(capturedAttachmentData, 'prisma.caseAttachment.create hiç çağrılmadı');
        assert.equal(capturedAttachmentData.caseId, 'fake-case-id-1');
        assert.equal(capturedAttachmentData.fileName, 'smoke-test.txt');
        assert.equal(capturedAttachmentData.mimeType, 'text/plain');
        assert.equal(capturedAttachmentData.fileSize, fakeBuffer.length);
        assert.equal(capturedAttachmentData.uploadedBy, CONNECT_ACTOR_DISPLAY_NAME);
        assert.equal(capturedAttachmentData.uploadedByUserId, null, 'uploadedByUserId NULL olmalı (User FK ihlali yok)');

        assert.ok(capturedSavedPath, 'storageApi.saveObject hiç çağrılmadı (gerçek disk yazılmadı)');
        assert.equal(capturedSavedBuffer, fakeBuffer);

        assert.ok(capturedHistoryEntry, 'Case history log hiç yazılmadı');
        assert.equal(capturedHistoryEntry.actor, CONNECT_ACTOR_DISPLAY_NAME);
        assert.equal(capturedHistoryEntry.actorUserId, null);
        assert.equal(capturedHistoryEntry.actionType, 'FileUploaded');

        assert.equal(result.fileName, 'smoke-test.txt');
      } finally {
        prisma.case.findUnique = originalFindUnique;
        prisma.case.update = originalCaseUpdate;
        prisma.caseAttachment.create = originalAttachmentCreate;
        storageApi.saveObject = originalSaveObject;
        storageApi.buildPath = originalBuildPath;
      }
    },
  );

  await check(
    'caseRepository.ingestExternalAttachment — defense-in-depth: desteklenmeyen tip → CaseValidationError unsupported_file_type (stub)',
    async () => {
      const originalFindUnique = prisma.case.findUnique;
      prisma.case.findUnique = async () => ({ id: 'fake-case-id-2', companyId: 'fake-company-1', attachments: [] });
      try {
        await assert.rejects(
          () =>
            caseRepository.ingestExternalAttachment('fake-case-id-2', {
              fileName: 'malware.exe',
              mimeType: 'application/octet-stream',
              buffer: Buffer.from('x'),
              uploadedByLabel: CONNECT_ACTOR_DISPLAY_NAME,
            }),
          (err) => err?.code === 'unsupported_file_type',
        );
      } finally {
        prisma.case.findUnique = originalFindUnique;
      }
    },
  );

  await check(
    'caseRepository.ingestExternalAttachment — defense-in-depth: CASE_FILE_MAX_COUNT (20) aşımı → CaseValidationError case_file_limit_reached (stub)',
    async () => {
      const originalFindUnique = prisma.case.findUnique;
      prisma.case.findUnique = async () => ({
        id: 'fake-case-id-3',
        companyId: 'fake-company-1',
        attachments: Array.from({ length: 20 }, (_, i) => ({ id: `att${i}` })),
      });
      try {
        await assert.rejects(
          () =>
            caseRepository.ingestExternalAttachment('fake-case-id-3', {
              fileName: 'ok.txt',
              mimeType: 'text/plain',
              buffer: Buffer.from('x'),
              uploadedByLabel: CONNECT_ACTOR_DISPLAY_NAME,
            }),
          (err) => err?.code === 'case_file_limit_reached',
        );
      } finally {
        prisma.case.findUnique = originalFindUnique;
      }
    },
  );

  await check(
    "caseRepository.ingestExternalAttachment — storage hata yolu: saveObject throw ederse caseAttachment.create'e HİÇ GİDİLMEZ (orphan-DB-row yok, stub)",
    async () => {
      const originalFindUnique = prisma.case.findUnique;
      const originalSaveObject = storageApi.saveObject;
      const originalAttachmentCreate = prisma.caseAttachment.create;

      let attachmentCreateCalled = false;
      prisma.case.findUnique = async () => ({ id: 'fake-case-id-4', companyId: 'fake-company-1', attachments: [] });
      storageApi.saveObject = async () => {
        throw new Error('simulated disk full / storage outage');
      };
      prisma.caseAttachment.create = async (args) => {
        attachmentCreateCalled = true;
        return { ...args.data };
      };

      try {
        await assert.rejects(
          () =>
            caseRepository.ingestExternalAttachment('fake-case-id-4', {
              fileName: 'ok.txt',
              mimeType: 'text/plain',
              buffer: Buffer.from('x'),
              uploadedByLabel: CONNECT_ACTOR_DISPLAY_NAME,
            }),
          (err) => err.message.includes('simulated disk full'),
        );
        assert.equal(attachmentCreateCalled, false, 'storage başarısız olduğu halde caseAttachment.create çağrıldı (orphan-DB-row riski)');
      } finally {
        prisma.case.findUnique = originalFindUnique;
        storageApi.saveObject = originalSaveObject;
        prisma.caseAttachment.create = originalAttachmentCreate;
      }
    },
  );

  await check(
    "caseRepository.ingestExternalAttachment — repo-katmanı defense-in-depth simetrisi: authorizedCodes verilip proje kodu setin dışındaysa → null (route 404'e çevirir, stub)",
    async () => {
      const originalFindUnique = prisma.case.findUnique;
      prisma.case.findUnique = async () => ({
        id: 'fake-case-id-5',
        companyId: 'fake-company-1',
        attachments: [],
        accountProject: { code: 'YETKISIZ-KOD' },
      });
      try {
        const result = await caseRepository.ingestExternalAttachment('fake-case-id-5', {
          fileName: 'ok.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('x'),
          uploadedByLabel: CONNECT_ACTOR_DISPLAY_NAME,
          authorizedCodes: ['BASKA-KOD'],
        });
        assert.equal(result, null, "yetkisiz authorizedCodes verildiğinde null dönmedi (repo-katmanı IDOR guard'ı çalışmıyor)");
      } finally {
        prisma.case.findUnique = originalFindUnique;
      }
    },
  );

  console.log('\n== 3) connectApi route — auth + fail-closed 400/401 (canlı HTTP, DB dokunmadan) ==');

  const { default: app } = await import('../server/app.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const originalKey = process.env.CONNECT_API_KEY;

  try {
    await check('CONNECT_API_KEY env yok → 401 (fail-closed, doğru key verilse bile)', async () => {
      delete process.env.CONNECT_API_KEY;
      const res = await fetch(`${base}/api/connect/tickets?scope=merkez&code=198`, {
        headers: { 'x-api-key': 'anything' },
      });
      assert.equal(res.status, 401);
    });

    process.env.CONNECT_API_KEY = 'test-key-smoke-12345';

    await check('key header yok → 401', async () => {
      const res = await fetch(`${base}/api/connect/tickets?scope=merkez&code=198`);
      assert.equal(res.status, 401);
    });

    await check('yanlış key (x-api-key) → 401', async () => {
      const res = await fetch(`${base}/api/connect/tickets?scope=merkez&code=198`, {
        headers: { 'x-api-key': 'wrong-key' },
      });
      assert.equal(res.status, 401);
    });

    await check('doğru key ama scope eksik → 400 invalid_scope (fail-closed, "hepsi" YOK)', async () => {
      const res = await fetch(`${base}/api/connect/tickets`, {
        headers: { 'x-api-key': process.env.CONNECT_API_KEY },
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'invalid_scope');
    });

    await check('scope=merkez ama code eksik → 400 missing_param', async () => {
      const res = await fetch(`${base}/api/connect/tickets?scope=merkez`, {
        headers: { 'x-api-key': process.env.CONNECT_API_KEY },
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'missing_param');
    });

    await check('scope=codes ama codes eksik → 400 missing_param', async () => {
      const res = await fetch(`${base}/api/connect/tickets?scope=codes`, {
        headers: { 'x-api-key': process.env.CONNECT_API_KEY },
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'missing_param');
    });

    await check('Bearer header ile de auth geçer (401 değil — scope validasyonuna düşer)', async () => {
      const res = await fetch(`${base}/api/connect/tickets?scope=merkez`, {
        headers: { Authorization: `Bearer ${process.env.CONNECT_API_KEY}` },
      });
      // Auth geçti (401 değil), scope=merkez code eksik → 400 bekleniyor.
      assert.equal(res.status, 400);
    });

    await check('geçersiz status filtresi → 400 invalid_status (DB\'ye gitmeden)', async () => {
      const res = await fetch(`${base}/api/connect/tickets?scope=merkez&code=198&status=BosStatu`, {
        headers: { 'x-api-key': process.env.CONNECT_API_KEY },
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'invalid_status');
    });

    await check('geçersiz updatedSince → 400 invalid_updatedSince', async () => {
      const res = await fetch(
        `${base}/api/connect/tickets?scope=merkez&code=198&updatedSince=not-a-date`,
        { headers: { 'x-api-key': process.env.CONNECT_API_KEY } },
      );
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'invalid_updatedSince');
    });

    await check('scope=codes — 500 kod sınır dahilinde → 400 DEĞİL (validasyonu geçer)', async () => {
      const codes = Array.from({ length: 500 }, (_, i) => `C${i}`).join(',');
      const res = await fetch(`${base}/api/connect/tickets?scope=codes&codes=${codes}`, {
        headers: { 'x-api-key': process.env.CONNECT_API_KEY },
      });
      // DB'ye gidecek (findCasesByCodes çağrılır) — sandbox'ta DB yoksa 500
      // internal olabilir, ÖNEMLİ OLAN: too_many_codes/400 DEĞİL.
      assert.notEqual(res.status, 400);
    });

    await check('scope=codes — 501 kod (sınır aşımı) → 400 too_many_codes, DB\'ye gitmeden', async () => {
      const codes = Array.from({ length: 501 }, (_, i) => `C${i}`).join(',');
      const res = await fetch(`${base}/api/connect/tickets?scope=codes&codes=${codes}`, {
        headers: { 'x-api-key': process.env.CONNECT_API_KEY },
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'too_many_codes');
    });

    await check('timing-safe key — yanlış key AYNI uzunlukta olsa da 401', async () => {
      const wrongSameLength = 'x'.repeat(process.env.CONNECT_API_KEY.length);
      const res = await fetch(`${base}/api/connect/tickets?scope=merkez&code=198`, {
        headers: { 'x-api-key': wrongSameLength },
      });
      assert.equal(res.status, 401);
    });

    console.log('\n== 4) GET /tickets/:id (detay) — auth + fail-closed (DB dokunmadan) ==');

    await check('GET /tickets/:id — key yok → 401 (paylaşılan checkConnectApiKey)', async () => {
      const res = await fetch(`${base}/api/connect/tickets/UNV-1000042?scope=merkez&code=198`);
      assert.equal(res.status, 401);
    });

    await check('GET /tickets/:id — doğru key ama scope eksik → 400 invalid_scope', async () => {
      const res = await fetch(`${base}/api/connect/tickets/UNV-1000042`, {
        headers: { 'x-api-key': process.env.CONNECT_API_KEY },
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'invalid_scope');
    });

    await check('GET /tickets/:id — scope=merkez ama code eksik → 400 missing_param', async () => {
      const res = await fetch(`${base}/api/connect/tickets/UNV-1000042?scope=merkez`, {
        headers: { 'x-api-key': process.env.CONNECT_API_KEY },
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'missing_param');
    });

    await check('GET /tickets/:id — scope=codes ama codes eksik → 400 missing_param', async () => {
      const res = await fetch(`${base}/api/connect/tickets/UNV-1000042?scope=codes`, {
        headers: { 'x-api-key': process.env.CONNECT_API_KEY },
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'missing_param');
    });

    console.log('\n== 5) GET /tickets/:id — canlı DB, best-effort (bu ortamda DB erişilebilir; timeout\'lu) ==');

    await check(
      "GET /tickets/:id — var olmayan caseNumber → 404 not_found (gerçek Case tablosu, cross-DB YOK — scope=codes ile)",
      async () => {
        const res = await fetchWithTimeout(
          `${base}/api/connect/tickets/NOPE-DOES-NOT-EXIST-XYZ?scope=codes&codes=ZZZ-NONEXISTENT-CODE`,
          { headers: { 'x-api-key': process.env.CONNECT_API_KEY } },
        );
        assert.equal(res.status, 404);
        const body = await res.json();
        assert.equal(body.error, 'not_found');
      },
    );

    // QA veto düzeltmesi — canlı authorized/IDOR regresyonu. Önce liste
    // uctan gerçek bir case keşfedilir (merkez 198 — görev talimatındaki
    // Vodafone örneği); sonraki iki test bu id üzerine kurulur. Discovery
    // başarısızsa (data churn) sonraki testler NET FAIL verir — sessizce
    // geçmez (assert.ok liveCaseNumber guard'ı).
    let liveCaseNumber = null;

    await check(
      'canlı keşif — merkez 198 için en az 1 case bulunur (sonraki 2 canlı testin ön koşulu)',
      async () => {
        const res = await fetchWithTimeout(
          `${base}/api/connect/tickets?scope=merkez&code=198&pageSize=1`,
          { headers: { 'x-api-key': process.env.CONNECT_API_KEY } },
        );
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(Array.isArray(body.items) && body.items.length > 0, 'merkez 198 için hiç case bulunamadı');
        liveCaseNumber = body.items[0].id;
      },
    );

    await check(
      'canlı authorized → 200 + şekil doğrulaması (gerçek case, doğru merkez scope)',
      async () => {
        assert.ok(liveCaseNumber, 'keşif adımı başarısız oldu — bu test koşulamaz');
        const res = await fetchWithTimeout(
          `${base}/api/connect/tickets/${encodeURIComponent(liveCaseNumber)}?scope=merkez&code=198`,
          { headers: { 'x-api-key': process.env.CONNECT_API_KEY } },
        );
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.id, liveCaseNumber);
        assert.equal(typeof body.status, 'string');
        assert.ok(Array.isArray(body.comments), 'comments[] eksik/yanlış tip');
        assert.ok(Array.isArray(body.history), 'history[] eksik/yanlış tip');
        assert.ok(Array.isArray(body.attachments), 'attachments[] eksik/yanlış tip');
      },
    );

    await check(
      'canlı IDOR → 404 (AYNI gerçek case, ait OLMADIĞI bir scope/kod ile — asıl güvenlik garantisi)',
      async () => {
        assert.ok(liveCaseNumber, 'keşif adımı başarısız oldu — bu test koşulamaz');
        const res = await fetchWithTimeout(
          `${base}/api/connect/tickets/${encodeURIComponent(liveCaseNumber)}?scope=codes&codes=ZZZ-KESINLIKLE-YETKISIZ-KOD`,
          { headers: { 'x-api-key': process.env.CONNECT_API_KEY } },
        );
        assert.equal(res.status, 404);
        const body = await res.json();
        assert.equal(body.error, 'not_found');
      },
    );

    console.log(
      "\n== 6) POST /tickets (create) — auth + fail-closed + code-çözüm 422 (⚠️ PROD'A INSERT YOK — bkz. dosya başı) ==",
    );

    // Bu bölümdeki HİÇBİR test caseRepository.create()'e ULAŞMAZ: her
    // senaryo ya auth/400 validasyonunda ya da (son 2 test) code çözümleme
    // 422'sinde erken-return eder — createConnectCase BU SCRIPT'TEN HİÇ
    // İMPORT EDİLMEDİ BİLE (yanlışlıkla çağrılması yapısal olarak engellendi).
    const VALID_POST_BODY_SHAPE = {
      code: 'ZZZ-KESINLIKLE-YOK-BU-KOD', // kasıtlı bogus — code_not_found'a düşsün, create()'e hiç gidilmesin
      title: 'Smoke test başlığı',
      description: 'Smoke test açıklaması.',
      type: 'Talep',
    };

    await check('POST /tickets — key yok → 401 (paylaşılan checkConnectApiKey)', async () => {
      const res = await fetch(`${base}/api/connect/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_POST_BODY_SHAPE),
      });
      assert.equal(res.status, 401);
    });

    await check('POST /tickets — doğru key ama TÜM zorunlu alanlar eksik → 400 missing_param', async () => {
      const res = await fetch(`${base}/api/connect/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'missing_param');
      for (const field of ['code', 'title', 'description', 'type']) {
        assert.ok(body.message.includes(field), `eksik alan mesajında '${field}' yok`);
      }
    });

    await check("POST /tickets — yalnız 'code' eksik → 400 missing_param", async () => {
      const { code, ...rest } = VALID_POST_BODY_SHAPE;
      const res = await fetch(`${base}/api/connect/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
        body: JSON.stringify(rest),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'missing_param');
      assert.ok(body.message.includes('code'));
    });

    await check("POST /tickets — bilinmeyen 'type' → 400 invalid_type (code çözümlemeye hiç gidilmez)", async () => {
      const res = await fetch(`${base}/api/connect/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
        body: JSON.stringify({ ...VALID_POST_BODY_SHAPE, type: 'BilinmeyenTip' }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'invalid_type');
    });

    await check("POST /tickets — 'title' üst sınırı aşılırsa → 400 title_too_long", async () => {
      const res = await fetch(`${base}/api/connect/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
        body: JSON.stringify({ ...VALID_POST_BODY_SHAPE, title: 'x'.repeat(501) }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'title_too_long');
    });

    await check("POST /tickets — 'description' üst sınırı aşılırsa → 400 description_too_long", async () => {
      const res = await fetch(`${base}/api/connect/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
        body: JSON.stringify({ ...VALID_POST_BODY_SHAPE, description: 'x'.repeat(20001) }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'description_too_long');
    });

    await check("POST /tickets — geçersiz tipte 'createdByEmail' (string değil) → 400 invalid_param", async () => {
      const res = await fetch(`${base}/api/connect/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
        body: JSON.stringify({ ...VALID_POST_BODY_SHAPE, createdByEmail: 12345 }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'invalid_param');
    });

    await check(
      "canlı (salt-okuma) — resolveSingleProjectByCode: var olmayan kod → code_not_found (create()'e hiç gidilmez)",
      async () => {
        await assert.rejects(
          () => resolveSingleProjectByCode('ZZZ-KESINLIKLE-YOK-BU-KOD-XYZ'),
          (err) => err instanceof ConnectResolverError && err.code === 'code_not_found',
        );
      },
    );

    await check(
      "canlı — POST /tickets: geçerli gövde ama code hiçbir projeye çözülmez → 422 code_not_found (⚠️ hiçbir Case INSERT edilmez — resolveSingleProjectByCode create()'ten ÖNCE fail eder)",
      async () => {
        const res = await fetchWithTimeout(`${base}/api/connect/tickets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
          body: JSON.stringify(VALID_POST_BODY_SHAPE),
        });
        assert.equal(res.status, 422);
        const body = await res.json();
        assert.equal(body.error, 'code_not_found');
      },
    );

    console.log(
      "\n== 7) POST /tickets/:id/attachments (ingest) — auth + scope-404 + gövde validasyonu (⚠️ PROD'A YAZMA YOK) ==",
    );

    // Küçük, geçerli bir base64 dosya — yalnız şekil/validasyon testleri
    // için (gerçek ingest'e HİÇ ULAŞMAZ — scope=codes ile fake bir code
    // kullanıldığında resolveAuthorizedCaseId'e bile gidilmeden önce
    // parseAttachmentIngestBody zaten kendi başına yeterli/yetersiz
    // senaryoları test eder; case-var mı sorgusu yalnız "404" testinde
    // gerçekten tetiklenir).
    const SMALL_VALID_FILE = {
      fileName: 'smoke-test.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from('smoke test content').toString('base64'),
    };

    await check('POST /tickets/:id/attachments — key yok → 401 (paylaşılan checkConnectApiKey)', async () => {
      const res = await fetch(`${base}/api/connect/tickets/UNV-1000042/attachments?scope=merkez&code=198`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [SMALL_VALID_FILE] }),
      });
      assert.equal(res.status, 401);
    });

    await check('POST /tickets/:id/attachments — doğru key ama scope eksik → 400 invalid_scope', async () => {
      const res = await fetch(`${base}/api/connect/tickets/UNV-1000042/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
        body: JSON.stringify({ files: [SMALL_VALID_FILE] }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'invalid_scope');
    });

    await check("POST /tickets/:id/attachments — 'files' eksik → 400 missing_param (scope=codes, DB'ye gitmeden)", async () => {
      const res = await fetch(`${base}/api/connect/tickets/UNV-1000042/attachments?scope=codes&codes=ZZZ-ANY`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'missing_param');
    });

    await check("POST /tickets/:id/attachments — 6 dosya (limit=5 aşımı) → 400 too_many_files", async () => {
      const files = Array.from({ length: 6 }, (_, i) => ({ ...SMALL_VALID_FILE, fileName: `f${i}.txt` }));
      const res = await fetch(`${base}/api/connect/tickets/UNV-1000042/attachments?scope=codes&codes=ZZZ-ANY`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
        body: JSON.stringify({ files }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'too_many_files');
    });

    await check("POST /tickets/:id/attachments — desteklenmeyen dosya türü (.exe) → 400 unsupported_file_type", async () => {
      const res = await fetch(`${base}/api/connect/tickets/UNV-1000042/attachments?scope=codes&codes=ZZZ-ANY`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
        body: JSON.stringify({
          files: [{ fileName: 'malware.exe', mimeType: 'application/octet-stream', contentBase64: SMALL_VALID_FILE.contentBase64 }],
        }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'unsupported_file_type');
    });

    await check("POST /tickets/:id/attachments — geçersiz base64 → 400 invalid_base64", async () => {
      const res = await fetch(`${base}/api/connect/tickets/UNV-1000042/attachments?scope=codes&codes=ZZZ-ANY`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
        body: JSON.stringify({
          files: [{ fileName: 'not-base64.txt', mimeType: 'text/plain', contentBase64: '%%%not-valid-base64%%%' }],
        }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'invalid_base64');
    });

    await check("POST /tickets/:id/attachments — tek dosya üst sınırı (10MB) aşımı → 413 file_too_large", async () => {
      // ~10.5MB decode edilmiş içerik — 10MB cap'inin hemen üstü.
      const oversized = Buffer.alloc(10.5 * 1024 * 1024, 'a').toString('base64');
      const res = await fetch(`${base}/api/connect/tickets/UNV-1000042/attachments?scope=codes&codes=ZZZ-ANY`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
        body: JSON.stringify({ files: [{ fileName: 'big.txt', mimeType: 'text/plain', contentBase64: oversized }] }),
      });
      assert.equal(res.status, 413);
      const body = await res.json();
      assert.equal(body.error, 'file_too_large');
    });

    await check(
      "POST /tickets/:id/attachments — 3×9MB dosya (toplam 25MB üst sınırını aşar, her biri tek-dosya cap altında) → 413 request_too_large",
      async () => {
        const nineMb = Buffer.alloc(9 * 1024 * 1024, 'b').toString('base64');
        const files = Array.from({ length: 3 }, (_, i) => ({ fileName: `f${i}.txt`, mimeType: 'text/plain', contentBase64: nineMb }));
        const res = await fetch(`${base}/api/connect/tickets/UNV-1000042/attachments?scope=codes&codes=ZZZ-ANY`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
          body: JSON.stringify({ files }),
        });
        assert.equal(res.status, 413);
        const body = await res.json();
        assert.equal(body.error, 'request_too_large');
      },
    );

    await check(
      "canlı (salt-okuma) — POST /tickets/:id/attachments: var olmayan caseNumber → 404 not_found (ingestExternalAttachment'a hiç gidilmez)",
      async () => {
        const res = await fetchWithTimeout(
          `${base}/api/connect/tickets/NOPE-DOES-NOT-EXIST-XYZ/attachments?scope=codes&codes=ZZZ-NONEXISTENT-CODE`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
            body: JSON.stringify({ files: [SMALL_VALID_FILE] }),
          },
        );
        assert.equal(res.status, 404);
        const body = await res.json();
        assert.equal(body.error, 'not_found');
      },
    );

    // Aşağıdaki 2 test GERÇEK bir case gerektirir (route'un tam döngüsünü —
    // resolveAuthorizedCaseId dahil — egzersiz etmek için); liveCaseNumber
    // section 5)'te (merkez 198 keşfi) zaten çözüldü. caseRepository.
    // ingestExternalAttachment STUB'lanır — hiçbir gerçek CaseAttachment
    // INSERT edilmez / diske yazılmaz, yalnız route'un kısmi-başarı/hata
    // işleme mantığı test edilir.
    await check(
      'canlı case + STUB ingestExternalAttachment — mid-loop kısmi başarısızlık: 3 dosyadan 3.\'sü patlarsa ilk 2\'si ingested[]\'te döner + failed doğru (⚠️ hiçbir gerçek CaseAttachment INSERT edilmez)',
      async () => {
        assert.ok(liveCaseNumber, 'keşif adımı başarısız oldu — bu test koşulamaz');
        const originalIngest = caseRepository.ingestExternalAttachment;
        let callCount = 0;
        caseRepository.ingestExternalAttachment = async (caseId, { fileName }) => {
          callCount++;
          if (callCount === 3) {
            throw new Error('simulated infra failure (storage/DB) on 3rd file');
          }
          return {
            id: `stub-att-${callCount}`,
            fileName,
            mimeType: 'text/plain',
            fileSize: 10,
            fileUrl: `cases/${caseId}/stub-${callCount}`,
          };
        };
        try {
          const files = [1, 2, 3].map((i) => ({ ...SMALL_VALID_FILE, fileName: `part${i}.txt` }));
          const res = await fetchWithTimeout(
            `${base}/api/connect/tickets/${encodeURIComponent(liveCaseNumber)}/attachments?scope=merkez&code=198`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
              body: JSON.stringify({ files }),
            },
          );
          assert.equal(res.status, 500, 'infra hatası 500 dönmeli');
          const body = await res.json();
          assert.equal(body.ingested.length, 2, 'ilk 2 başarılı dosya ingested[]\'te kaybolmuş');
          assert.equal(body.ingested[0].fileName, 'part1.txt');
          assert.equal(body.ingested[1].fileName, 'part2.txt');
          assert.equal(body.failed.fileName, 'part3.txt');
          assert.equal(body.failed.error, 'internal');
        } finally {
          caseRepository.ingestExternalAttachment = originalIngest;
        }
      },
    );

    await check(
      'canlı case + STUB ingestExternalAttachment — CaseValidationError → handleConnectApiError doğru 4xx\'e çevirir (⚠️ DB/disk\'e gitmeden)',
      async () => {
        assert.ok(liveCaseNumber, 'keşif adımı başarısız oldu — bu test koşulamaz');
        const originalIngest = caseRepository.ingestExternalAttachment;
        caseRepository.ingestExternalAttachment = async () => {
          throw new CaseValidationError('Bu vakada en fazla 20 dosya olabilir.', {
            status: 400,
            code: 'case_file_limit_reached',
          });
        };
        try {
          const res = await fetchWithTimeout(
            `${base}/api/connect/tickets/${encodeURIComponent(liveCaseNumber)}/attachments?scope=merkez&code=198`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
              body: JSON.stringify({ files: [SMALL_VALID_FILE] }),
            },
          );
          assert.equal(res.status, 400);
          const body = await res.json();
          assert.equal(body.ingested.length, 0);
          assert.equal(body.failed.error, 'case_file_limit_reached');
        } finally {
          caseRepository.ingestExternalAttachment = originalIngest;
        }
      },
    );

    // Rate-limit 429 — POST /tickets ve POST /tickets/:id/attachments AYNI
    // key-bazlı bucket'ı paylaşır (checkCreateRateLimit). Bu noktaya kadar
    // zaten onlarca POST isteği gönderildi (tam sayı testler değiştikçe
    // kırılgan); bu yüzden KESİN limiti aşmak için BOL miktarda (35) YENİ
    // istek gönderilir — en az birinin 429 dönmesi YETERLİ kanıt (mevcut
    // bucket doluluğundan BAĞIMSIZ sağlam bir doğrulama). BUNDAN SONRA bu
    // key ile gönderilecek her istek 429 döneceği için bu test BİLEREK
    // dosyanın/bölümün EN SONUNA konur.
    await check(
      "rate-limit — POST /tickets/:id/attachments key başına dakika sınırını (30) aşınca 429 rate_limited (paylaşımlı sayaç)",
      async () => {
        const results = await Promise.all(
          Array.from({ length: 35 }, () =>
            fetchWithTimeout(`${base}/api/connect/tickets/UNV-1000042/attachments?scope=codes&codes=ZZZ-ANY`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CONNECT_API_KEY },
              body: JSON.stringify({}), // missing_param'a düşer ama rate-limit ÖNCE kontrol edilir
            }),
          ),
        );
        const statuses = results.map((r) => r.status);
        assert.ok(statuses.includes(429), `35 istekten hiçbiri 429 dönmedi — rate-limit tetiklenmedi (statuses: ${statuses.join(',')})`);
      },
    );
  } finally {
    if (originalKey === undefined) delete process.env.CONNECT_API_KEY;
    else process.env.CONNECT_API_KEY = originalKey;
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\n${passed} kontrol geçti.`);
  if (process.exitCode) {
    console.error('SMOKE TEST BAŞARISIZ — yukarıdaki FAIL satırlarına bakın.');
  } else {
    console.log(
      'SMOKE TEST PASS (auth + fail-closed yollar çoğunlukla DB\'siz; birkaç test bu ortamda erişilebilir gerçek DB\'ye SALT-OKUMA timeout\'lu gider — bkz. 3)/5)/6)/7) bölümleri; PROD\'A HİÇBİR Case/CaseAttachment INSERT EDİLMEDİ, DİSKE YAZILMADI — createConnectCase/ingestExternalAttachment yalnız STUB\'lanmış wiring testlerinde çağrıldı).',
    );
  }
}

main()
  .catch((err) => {
    console.error('FATAL:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Prisma bağlantı havuzunu HER KOŞULDA (başarı/başarısızlık) hemen
    // serbest bırak — bu script arka arkaya birçok kez çalıştırılabiliyor
    // (iteratif geliştirme); disconnect etmeden process.exit'e güvenmek
    // paylaşımlı bir DB'de (düşük connection_limit) havuz tükenmesine yol
    // açabilir ("Timed out fetching a new connection from the connection
    // pool" — _n4bmigrate.mjs de aynı desenle (finally + $disconnect) bitiyor).
    await prisma.$disconnect();
  });
