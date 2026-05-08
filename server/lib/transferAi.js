import { prisma } from '../db/client.js';
import { aiClient, callOpenAI, logAIUsage } from './aiClient.js';

/**
 * FAZ 2 §20.2 — aktarım AI yardımcıları.
 *
 * 1. generateTransferBrief — devir notu üretir (kısa madde madde özet).
 * 2. triggerTransferRootCause — transferCount >= 2 durumunda fire-and-forget:
 *    supervisor CaseNotification yaratır + OpenAI kök neden analizi sonucunu
 *    CaseActivity satırı olarak ekler.
 */

const REASON_LABEL = {
  wrong_team: 'Yanlış Takım',
  expertise: 'Uzmanlık',
  workload: 'İş Yükü',
  escalation: 'Eskalasyon',
  customer_request: 'Müşteri Talebi',
  other: 'Diğer',
};

/**
 * Devir notu üret — yeni takıma "şimdiye kadar yapılanlar / çözülemeyen
 * noktalar / önerilen ilk adım / dikkat" formatında 3 madde.
 */
export async function generateTransferBrief({ caseId, toTeamId, toPersonId, userId, allowedCompanyIds }) {
  if (!aiClient) {
    return { error: 'ai_unavailable', message: 'AI servisi yapılandırılmamış.' };
  }

  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      notes: { orderBy: { createdAt: 'desc' }, take: 5 },
      callLogs: { orderBy: { callDate: 'desc' }, take: 3 },
      history: { orderBy: { at: 'desc' }, take: 8 },
    },
  });
  if (!c) return { error: 'not_found' };
  if (allowedCompanyIds && !allowedCompanyIds.includes(c.companyId)) {
    return { error: 'forbidden' };
  }

  const targetTeam = toTeamId
    ? await prisma.team.findUnique({ where: { id: toTeamId }, select: { name: true } })
    : null;
  const targetPerson = toPersonId
    ? await prisma.person.findUnique({ where: { id: toPersonId }, select: { name: true } })
    : null;

  const lastNotes = c.notes.map((n) => `- ${n.content}`).join('\n') || '(yok)';
  const lastCalls = c.callLogs
    .map((cl) => `- ${cl.callOutcome ?? '-'}/${cl.callDisposition ?? '-'}: ${(cl.description ?? '').slice(0, 120)}`)
    .join('\n') || '(yok)';
  const recentHistory = c.history
    .map((h) => `- ${h.action ?? h.fieldName ?? ''}${h.toValue ? `: ${h.toValue}` : ''}`)
    .join('\n') || '(yok)';

  const t0 = Date.now();
  const system = [
    "Sen Varuna CRM'de vaka aktarımlarına yardımcı olan bir asistanısın.",
    'Bir vaka yeni bir takıma/kişiye devredildi. Senden devir notu yazman isteniyor.',
    'Kısa, net, profesyonel Türkçe. Sadece madde madde liste ver — üst başlık veya açıklama EKLEME.',
  ].join('\n');

  const user = [
    `Vaka: ${c.title}`,
    `Kategori: ${c.category}/${c.subCategory}`,
    `Statü: ${c.status} · Öncelik: ${c.priority}`,
    `Mevcut Takım: ${c.assignedTeamName ?? '-'}${c.assignedPersonName ? ` (${c.assignedPersonName})` : ''}`,
    `Yeni Takım: ${targetTeam?.name ?? '-'}${targetPerson?.name ? ` (${targetPerson.name})` : ''}`,
    `Açıklama: ${c.description}`,
    '',
    'Son notlar:',
    lastNotes,
    '',
    'Son aramalar:',
    lastCalls,
    '',
    'Son aksiyon geçmişi:',
    recentHistory,
    '',
    'Yeni takım için 3 madde yaz:',
    '1) Şimdiye kadar yapılanlar (1 cümle)',
    '2) Çözülemeyen / kritik nokta (1 cümle)',
    '3) Önerilen ilk adım (1 cümle)',
    '',
    'Çıktı sadece 3 madde olsun — başlık/numara/giriş cümlesi koyma. Her madde kısa olmalı.',
  ].join('\n');

  try {
    const { text, tokenCount } = await callOpenAI({ system, user });
    void logAIUsage({
      endpoint: 'transfer-brief',
      companyId: c.companyId,
      caseId,
      userId,
      responseTimeMs: Date.now() - t0,
      tokenCount,
    });
    return { brief: text };
  } catch (err) {
    console.error('[transfer-brief]', err?.message ?? err);
    return { error: 'ai_failed', message: err?.message ?? 'AI çağrısı başarısız.' };
  }
}

/**
 * Fire-and-forget: transferCount >= 2 olunca supervisor uyarısı + kök neden
 * analizi. Hatalar yutulur — ana akış (transfer response) bağımlı değil.
 */
export async function triggerTransferRootCause({ caseId, companyId, transferCount, caseNumber, userId }) {
  // 1) Supervisor bildirimleri (UserCompany.role === Supervisor + isActive)
  try {
    const supervisors = await prisma.userCompany.findMany({
      where: { companyId, role: 'Supervisor', isActive: true },
      select: { userId: true },
    });
    if (supervisors.length > 0) {
      const message = `⚠️ ${caseNumber} aynı vakada ${transferCount}. kez aktarıldı`;
      await prisma.caseNotification.createMany({
        data: supervisors.map((s) => ({
          caseId,
          companyId,
          eventType: 'transfer_warning',
          channel: 'InApp',
          recipient: s.userId,
          payload: { message, transferCount },
        })),
      });
    }
  } catch (err) {
    console.warn('[transfer-warning] supervisor notify hatası:', err?.message ?? err);
  }

  // 2) AI kök neden analizi — sonucu CaseActivity'ye yaz
  if (!aiClient) return; // AI key yoksa sessizce skip; supervisor zaten bildirildi

  try {
    const transfers = await prisma.caseTransfer.findMany({
      where: { caseId },
      orderBy: { transferredAt: 'asc' },
      take: 10,
    });
    if (transfers.length === 0) return;

    const teamIds = new Set();
    transfers.forEach((t) => {
      if (t.fromTeamId) teamIds.add(t.fromTeamId);
      if (t.toTeamId) teamIds.add(t.toTeamId);
    });
    const teams = await prisma.team.findMany({
      where: { id: { in: [...teamIds] } },
      select: { id: true, name: true },
    });
    const teamName = new Map(teams.map((t) => [t.id, t.name]));

    const transferList = transfers
      .map((t, i) => {
        const from = t.fromTeamId ? teamName.get(t.fromTeamId) ?? '—' : '—';
        const to = teamName.get(t.toTeamId) ?? '—';
        const code = t.reasonCode ? ` [${REASON_LABEL[t.reasonCode] ?? t.reasonCode}]` : '';
        return `${i + 1}. ${from} → ${to}${code} | ${t.reason.slice(0, 100)}`;
      })
      .join('\n');

    const t0 = Date.now();
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['rootCause', 'recommendation', 'patternDetected'],
      properties: {
        rootCause: { type: 'string' },
        recommendation: { type: 'string' },
        patternDetected: { type: 'boolean' },
      },
    };

    const system = [
      "Sen Varuna CRM'de vaka yönetimine yardımcı olan bir analistsin.",
      'Bir vaka birden fazla kez devredilmiş. Sen kök neden analizi yaparsın.',
      'Türkçe yaz. SADECE JSON döndür.',
    ].join('\n');

    const userPrompt = [
      `Bu vaka ${transferCount} kez aktarıldı.`,
      '',
      'Transfer geçmişi (eski → yeni):',
      transferList,
      '',
      'Kök neden analizi yap:',
      '- rootCause: neden bu vaka tekrar tekrar aktarılıyor (max 200 karakter)',
      '- recommendation: bu örüntüyü kırmak için somut öneri (max 200 karakter)',
      '- patternDetected: tekrarlayan bir örüntü var mı (true/false)',
    ].join('\n');

    const { json, tokenCount } = await callOpenAI({
      system,
      user: userPrompt,
      schema,
      schemaName: 'transfer_root_cause',
    });
    void logAIUsage({
      endpoint: 'transfer-root-cause',
      companyId,
      caseId,
      userId,
      responseTimeMs: Date.now() - t0,
      tokenCount,
    });

    const rootCause = String(json.rootCause ?? '').slice(0, 200);
    const recommendation = String(json.recommendation ?? '').slice(0, 200);

    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: `🔍 AI Kök Neden Analizi: ${rootCause}`,
        actionType: 'FieldUpdate',
        fieldName: 'aiRootCause',
        toValue: rootCause,
        note: `Öneri: ${recommendation}${json.patternDetected ? ' (örüntü tespit edildi)' : ''}`,
        actor: 'RUNA AI',
      },
    });
  } catch (err) {
    console.warn('[transfer-root-cause] hata:', err?.message ?? err);
  }
}
