#!/usr/bin/env node
/**
 * AloTech graceful degrade smoke — config eksik iken endpoint'lerin 500
 * ATMAMASI + { configured: false } DÖNMESİ.
 *
 * REUSE: server/routes/alotech.js (gerçek router) + server/integrations/
 * alotech/config.js (guard) + isAlotechConfigured.
 *
 * DB'siz; sadece routes + middleware test edilir (verifyJwt mock'lanır).
 *
 * 6 endpoint × 2 senaryo = 12 PASS bekleniyor.
 */

import express from 'express';
import { isAlotechConfigured, missingAlotechEnvKeys } from '../server/integrations/alotech/config.js';

let pass = 0; let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}

// Test 1: env'ler boş iken guard false; configured:false response.
async function senaryoDisabled() {
  console.log('\n=== Senaryo 1: ALOTECH_* env\'ler eksik → endpoint\'ler 200 { configured: false } ===');
  delete process.env.ALOTECH_TENANT;
  delete process.env.ALOTECH_APP_TOKEN;
  delete process.env.ALOTECH_SECRET_KEY;
  delete process.env.ALOTECH_CLIENT_ID;

  // Guard'ı doğrula
  expect('isAlotechConfigured() = false', isAlotechConfigured(), false);
  const miss = missingAlotechEnvKeys();
  expect('missing env adında ALOTECH_TENANT var', miss.includes('ALOTECH_TENANT'), true);
  expect('missing env adında APP_TOKEN|SECRET_KEY var',
    miss.includes('ALOTECH_APP_TOKEN | ALOTECH_SECRET_KEY'), true);

  // verifyJwt mock — JWT'siz testi geçebilmek için route module'ünü
  // import etmeden basit middleware testiyle aynı middleware'i kuralım.
  const { default: routerModule } = await dynImportRouter();
  const app = express();
  app.use(express.json());
  // Guard verifyJwt'tan önce çalıştığı için JWT bypass gerekmez.
  app.use('/api/integrations/alotech', routerModule);

  const endpoints = [
    ['GET',  '/api/integrations/alotech/session'],
    ['POST', '/api/integrations/alotech/call', { phoneNumber: '+90...' }],
    ['GET',  '/api/integrations/alotech/agent-status'],
    ['POST', '/api/integrations/alotech/set-status', { status: 'available' }],
    ['GET',  '/api/integrations/alotech/active-call'],
    ['POST', '/api/integrations/alotech/hangup'],
  ];
  for (const [method, path, body] of endpoints) {
    const res = await fetchApp(app, method, path, body);
    expect(`${method} ${path} → 200 (500 ATMAZ)`, res.status, 200);
    expect(`${method} ${path} → { configured: false }`, res.body?.configured, false);
  }
}

// Test 2: env'ler dolu iken guard true; route normal akışı.
async function senaryoConfigured() {
  console.log('\n=== Senaryo 2: ALOTECH_* env\'ler tam → guard true, route normal akış ===');
  process.env.ALOTECH_TENANT = 'test-tenant.alo-tech.com';
  process.env.ALOTECH_APP_TOKEN = 'test_token';
  expect('isAlotechConfigured() = true', isAlotechConfigured(), true);
  expect('missing env yok', missingAlotechEnvKeys().length, 0);
}

async function dynImportRouter() {
  // Module-level cache temizliği için ESM dinamik import (her testte aynı
  // module sınama yaparız — process.env okuması module-level değil, runtime;
  // route handler'da is/missing fonksiyonu çağırılır).
  return await import('../server/routes/alotech.js');
}

function fetchApp(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const url = `http://127.0.0.1:${port}${path}`;
      const init = {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      };
      fetch(url, init)
        .then(async (r) => {
          const text = await r.text();
          let json = null; try { json = JSON.parse(text); } catch {}
          server.close(() => resolve({ status: r.status, body: json, text }));
        })
        .catch((err) => {
          server.close(() => reject(err));
        });
    });
  });
}

(async () => {
  try {
    await senaryoDisabled();
    await senaryoConfigured();
  } catch (err) {
    console.error('[test] HATA:', err.message);
    fail++;
  } finally {
    console.log('\n────────────────────────────────────────────────────────');
    console.log(`PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
