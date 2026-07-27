// Smoke test — Varuna↔Connect GET-liste + GET-detay dilimleri
// (server/routes/connectApi.js, server/db/connectResolver.js,
// server/lib/connectMapper.js).
//
// Canlı DB'ye ÇOĞUNLUKLA DOKUNMAZ: connectResolver'ın validasyon adımları
// (invalid merkez kodu / boş codes / boş authorizedCodes / IDOR guard) hiçbir
// prisma sorgusu ÇALIŞTIRMADAN throw/early-return eder. Yalnız İKİ test (bkz.
// "canlı DB — best effort" bölümü) gerçek Case tablosuna gider — bu ortamda
// DATABASE_URL erişilebilir olduğu doğrulandığı için dahil edildi, ama DB
// erişilemezse net bir FAIL ile (hang değil — timeout'lu fetch) haber verir.
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

import http from 'node:http';
import assert from 'node:assert/strict';
import {
  mapCaseToConnectTicket,
  mapCaseToConnectDetail,
  toConnectStatus,
  STATUS_CROSSWALK,
} from '../server/lib/connectMapper.js';
import { M_STATUS } from '../server/db/enumMap.js';
import {
  resolveCodesForMerkez,
  findCasesByCodes,
  findCaseDetailByNumber,
  isCodeAuthorized,
  ConnectResolverError,
  DETAIL_CHILD_CAP,
} from '../server/db/connectResolver.js';

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
            { fromValue: 'Açık', toValue: 'İncelemede', at: new Date('2026-07-20T10:05:00.000Z'), actor: 'Mehmet Agent' },
            { fromValue: 'İncelemede', toValue: 'Çözüldü', at: new Date('2026-07-21T11:30:00.000Z'), actor: 'Mehmet Agent' },
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

  console.log('\n== 2) connectResolver — fail-closed validasyon (DB\'ye GİTMEDEN) ==');

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
      'SMOKE TEST PASS (auth + fail-closed yollar çoğunlukla DB\'siz; birkaç test bu ortamda erişilebilir gerçek DB\'ye timeout\'lu gider — bkz. 3) ve 5) bölümleri; 5) authorized/IDOR/not-found canlı regresyonlarını da içerir).',
    );
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
