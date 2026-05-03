import OpenAI from 'openai';
import { prisma } from '../db/client.js';

/**
 * Smart QA Lite — Faz 1.5 Madde 4.
 *
 * Kapatılmış vakaları (Cozuldu) AI ile 3 kriterde puanlar (1-5):
 *   - empati: Ajan müşteriye nasıl davranmış
 *   - clarity: Çözüm netliği
 *   - speed: SLA'ya göre yanıt hızı
 *
 * Cost control: tek batch'te max 10 vaka. Materyali olmayan
 * vaka (not yok + çağrı yok + çözüm notu yok) skip edilir.
 *
 * caseId @unique → upsert pattern, yeniden skorlama replace eder.
 *
 * Tetikleme:
 *  - Production: GitHub Actions her gece 02:00 UTC POST
 *    /api/cron/qa-score-batch (x-uptime-secret).
 *  - Local CLI: `node server/cron/qaScoreBatch.js`
 */

const MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 400;
const BATCH_SIZE = 10;

const apiKey = process.env.OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['empathy', 'clarity', 'speed', 'feedback'],
  properties: {
    empathy: { type: 'integer', minimum: 1, maximum: 5 },
    clarity: { type: 'integer', minimum: 1, maximum: 5 },
    speed: { type: 'integer', minimum: 1, maximum: 5 },
    feedback: { type: 'string', minLength: 1, maxLength: 300 },
  },
};

const SYSTEM_PROMPT = [
  'Sen Varuna CRM kapalı vakalarını puanlayan bir kalite analistisin.',
  'Her vakayı 3 kriterde 1-5 arası puanla:',
  '  1. empati — ajan müşteriye nasıl davrandı (anlayışlı/profesyonel mi)',
  '  2. clarity — çözüm açık, anlaşılır, müşterinin sorununu kapsadı mı',
  '  3. speed — SLA hedefine göre ne kadar hızlı çözüldü',
  'feedback alanı: en fazla 2 cümle Türkçe değerlendirme.',
  'Sadece veriden göremediğin alanlarda 3 (orta) ver, kanıt yokken cömert puanlama.',
].join('\n');

/**
 * Tek vaka skor — internal helper.
 * Returns: { scored: true, scores } | { skipped: reason } | { error }
 */
export async function runScoreCase(caseId) {
  if (!client) return { error: 'OPENAI_API_KEY tanımlı değil.' };

  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      notes: { orderBy: { createdAt: 'asc' } },
      callLogs: { orderBy: { callDate: 'asc' } },
    },
  });
  if (!c) return { error: 'Vaka bulunamadı.' };
  if (c.status !== 'Cozuldu') return { skipped: 'not_closed' };
  if (c.qaScoredAt) return { skipped: 'already_scored' };

  const hasNotes = c.notes.length > 0;
  const hasCalls = c.callLogs.length > 0;
  const hasResolution = !!c.resolutionNote;
  if (!hasNotes && !hasCalls && !hasResolution) {
    console.warn(`[qa-score] case ${caseId} skipped — hiç materyal yok`);
    return { skipped: 'no_material' };
  }

  const notesPart = hasNotes
    ? c.notes.map((n) => `[${n.authorName}] ${n.content}`).join('\n').slice(0, 4000)
    : '(not yok)';
  const callsPart = hasCalls
    ? c.callLogs
        .map((l) => `[${l.callerName} • ${l.durationMin}dk] ${l.description ?? '—'}`)
        .join('\n')
        .slice(0, 2000)
    : '(çağrı yok)';
  const resolutionPart = c.resolutionNote ?? '(çözüm notu yok)';

  let slaInfo = 'SLA bilgisi yok';
  if (c.slaResolutionDueAt && c.resolvedAt) {
    const dueMs = new Date(c.slaResolutionDueAt).getTime();
    const resMs = new Date(c.resolvedAt).getTime();
    const diffHours = Math.round((dueMs - resMs) / (60 * 60 * 1000));
    slaInfo =
      diffHours >= 0
        ? `SLA'dan ${diffHours} saat önce çözüldü`
        : `SLA'dan ${Math.abs(diffHours)} saat sonra çözüldü (gecikme)`;
  }

  const userMsg = [
    `Vaka başlığı: ${c.title}`,
    `Müşteri: ${c.accountName}`,
    `Kategori: ${c.category} / ${c.subCategory ?? '—'}`,
    `Talep türü: ${c.requestType}`,
    `Öncelik: ${c.priority}`,
    `Atanan: ${c.assignedPersonName ?? '—'}`,
    '',
    `${slaInfo}`,
    '',
    'NOTLAR:',
    notesPart,
    '',
    'ÇAĞRI KAYITLARI:',
    callsPart,
    '',
    'ÇÖZÜM NOTU:',
    resolutionPart,
  ].join('\n');

  const completion = await client.chat.completions.create({
    model: MODEL,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'qa_score', strict: true, schema: SCHEMA },
    },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
    max_tokens: MAX_TOKENS,
    temperature: 0.3,
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) return { error: 'AI yanıtı boş' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'AI yanıtı parse edilemedi' };
  }

  // Persist — Case denormalize + QAScoreLog upsert
  const now = new Date();
  await prisma.$transaction([
    prisma.case.update({
      where: { id: caseId },
      data: {
        qaEmpathyScore: parsed.empathy,
        qaClarityScore: parsed.clarity,
        qaSpeedScore: parsed.speed,
        qaFeedback: parsed.feedback,
        qaScoredAt: now,
      },
    }),
    prisma.qAScoreLog.upsert({
      where: { caseId },
      update: {
        empathy: parsed.empathy,
        clarity: parsed.clarity,
        speed: parsed.speed,
        feedback: parsed.feedback,
        scoredAt: now,
      },
      create: {
        caseId,
        companyId: c.companyId,
        empathy: parsed.empathy,
        clarity: parsed.clarity,
        speed: parsed.speed,
        feedback: parsed.feedback,
      },
    }),
  ]);
  return { scored: true, ...parsed };
}

/**
 * Batch run — son resolved Cozuldu + qaScoredAt null olan ilk N vaka.
 */
export async function runQaScoreBatch() {
  const candidates = await prisma.case.findMany({
    where: { status: 'Cozuldu', qaScoredAt: null },
    select: { id: true },
    take: BATCH_SIZE,
    orderBy: { resolvedAt: 'desc' },
  });
  if (candidates.length === 0) {
    return { processed: 0, skipped: 0, errors: [] };
  }

  let processed = 0;
  let skipped = 0;
  const errors = [];
  for (const c of candidates) {
    try {
      const r = await runScoreCase(c.id);
      if (r?.scored) processed++;
      else if (r?.skipped) skipped++;
      else if (r?.error) errors.push({ caseId: c.id, error: r.error });
    } catch (e) {
      errors.push({ caseId: c.id, error: e?.message ?? 'unknown' });
    }
  }
  if (processed > 0 || errors.length > 0) {
    console.log(`[cron:qa-score-batch] processed=${processed} skipped=${skipped} errors=${errors.length}`);
  }
  return { processed, skipped, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runQaScoreBatch()
    .then((r) => {
      console.log('[cron:qa-score-batch] done', r);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[cron:qa-score-batch] failed', err);
      process.exit(1);
    });
}
