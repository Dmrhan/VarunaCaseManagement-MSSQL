// Smoke test — Varuna↔Connect GET-liste dilimi (server/routes/connectApi.js,
// server/db/connectResolver.js, server/lib/connectMapper.js).
//
// Canlı DB'ye DOKUNMAZ: connectResolver'ın validasyon adımları (invalid
// merkez kodu / boş codes) hiçbir prisma sorgusu ÇALIŞTIRMADAN throw/early-
// return eder — bu yüzden bu script sandbox'ta (ağ/DB izole) tam çalışır.
// Auth + fail-closed 400 yolları da DB'ye gitmeden döner (route handler
// erken return eder).
//
// Kullanım: node --env-file-if-exists=.env scripts/smoke-connect-tickets.mjs
//
// MANUEL CANLI TEST (bu script'in kapsamadığı, gerçek DB gerektiren adım):
//   CONNECT_API_KEY=<gercek-key> node --env-file=.env server/index.js
//   curl -s "http://localhost:3101/api/connect/tickets?scope=merkez&code=198" \
//     -H "x-api-key: <gercek-key>" | jq .
//   (merkez kod 198 = Vodafone örneği — görev talimatından)

import http from 'node:http';
import assert from 'node:assert/strict';
import { mapCaseToConnectTicket, toConnectStatus, STATUS_CROSSWALK } from '../server/lib/connectMapper.js';
import { M_STATUS } from '../server/db/enumMap.js';
import {
  resolveCodesForMerkez,
  findCasesByCodes,
  ConnectResolverError,
} from '../server/db/connectResolver.js';

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
  } finally {
    if (originalKey === undefined) delete process.env.CONNECT_API_KEY;
    else process.env.CONNECT_API_KEY = originalKey;
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\n${passed} kontrol geçti.`);
  if (process.exitCode) {
    console.error('SMOKE TEST BAŞARISIZ — yukarıdaki FAIL satırlarına bakın.');
  } else {
    console.log('SMOKE TEST PASS (auth + fail-closed yollar; canlı DB sorgusu bu scriptte YOK).');
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
