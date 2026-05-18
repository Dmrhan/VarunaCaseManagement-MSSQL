/**
 * QA score batch telemetry smoke.
 *
 * Doğruluyor:
 *  - runScoreCase() başarıyla çalıştığında AIUsageLog'a satır yazıyor
 *  - endpoint='qa-score-batch'
 *  - companyId + caseId set
 *  - tokenCount + responseTimeMs > 0
 *
 * Mutasyon: bir Cozuldu test vakası yaratır + skorlar + AIUsageLog yazılır.
 * Sonunda yarattığı veriyi (Case + QAScoreLog + AIUsageLog) temizler.
 *
 * Gerektirir: OPENAI_API_KEY. Yoksa SKIP raporu.
 *
 * Çalıştır: node --env-file=.env scripts/smoke-qa-score-batch-telemetry.js
 */

import { prisma } from '../server/db/client.js';
import { runScoreCase } from '../server/cron/qaScoreBatch.js';

const stamp = Date.now();
const PREFIX = `qaslog-${stamp}`;
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

if (!process.env.OPENAI_API_KEY) {
  console.log('SKIP — OPENAI_API_KEY tanımlı değil');
  await prisma.$disconnect();
  process.exit(0);
}

const company = await prisma.company.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
const person = await prisma.person.findFirst({ select: { id: true, name: true } });

let caseId = null;
let logIds = [];
try {
  const created = await prisma.case.create({
    data: {
      caseNumber: `${PREFIX}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      title: `${PREFIX} smoke`,
      description: 'smoke test case for QA telemetry verification',
      caseType: 'GeneralSupport',
      status: 'Cozuldu',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: company.id,
      companyName: company.name,
      assignedPersonId: person?.id ?? null,
      assignedPersonName: person?.name ?? null,
      category: 'Yazılım',
      subCategory: 'Genel',
      requestType: 'Talep',
      resolutionNote: 'Müşterinin parola sorunu çözüldü. Sistemden çıkış yapılıp yeniden giriş yapıldı.',
      resolvedAt: new Date(),
    },
  });
  caseId = created.id;

  // Önce log baseline (henüz qa-score-batch satırı olmamalı)
  const beforeCount = await prisma.aIUsageLog.count({
    where: { endpoint: 'qa-score-batch', caseId },
  });
  record('1. baseline: qa-score-batch log for this case = 0', beforeCount === 0, `count=${beforeCount}`);

  // Skorla
  const r = await runScoreCase(caseId);
  record('2. runScoreCase succeeded', !!r?.scored, JSON.stringify(r).slice(0, 100));

  // logAIUsage fire-and-forget; tiny pause
  await new Promise((r) => setTimeout(r, 300));

  const logs = await prisma.aIUsageLog.findMany({
    where: { endpoint: 'qa-score-batch', caseId },
    select: { id: true, endpoint: true, companyId: true, caseId: true, tokenCount: true, responseTimeMs: true, userId: true, createdAt: true },
  });
  logIds = logs.map((l) => l.id);

  record('3. AIUsageLog row written for caseId', logs.length === 1, `count=${logs.length}`);
  if (logs.length === 1) {
    const l = logs[0];
    record('3a. endpoint = qa-score-batch', l.endpoint === 'qa-score-batch');
    record('3b. companyId set', l.companyId === company.id, l.companyId);
    record('3c. caseId set', l.caseId === caseId);
    record('3d. userId null (cron)', l.userId === null);
    record('3e. tokenCount > 0', (l.tokenCount ?? 0) > 0, `tokens=${l.tokenCount}`);
    record('3f. responseTimeMs > 0', (l.responseTimeMs ?? 0) > 0, `ms=${l.responseTimeMs}`);
  }
} catch (err) {
  console.error('smoke fatal:', err);
  results.push({ name: 'fatal', ok: false, detail: err?.message });
} finally {
  if (logIds.length) await prisma.aIUsageLog.deleteMany({ where: { id: { in: logIds } } }).catch(() => {});
  if (caseId) {
    await prisma.qAScoreLog.deleteMany({ where: { caseId } }).catch(() => {});
    await prisma.case.delete({ where: { id: caseId } }).catch(() => {});
  }
  await prisma.$disconnect();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('[smoke] FAILED:');
  failed.forEach((f) => console.log(`  - ${f.name} ${f.detail ?? ''}`));
  process.exitCode = 1;
} else {
  console.log('[smoke] ALL GREEN');
}
