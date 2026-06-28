/**
 * Mail M6.3b Faz 3 — CaseEmailTemplate repository.
 *
 * Composer "Mail Şablonu" dropdown'unu besleyen agent self-service
 * template'ler. Per-tenant scope.
 *
 * API:
 *  - list(companyId)              — admin CRUD (active + inactive)
 *  - listActive(companyId)         — composer fetch (yalnız active)
 *  - getById(companyId, id)        — admin read
 *  - upsert(companyId, draft, actorUserId)
 *      draft.id varsa update; yoksa create.
 *  - remove(companyId, id)         — admin delete
 *
 * sanitize-html bodyHtml save öncesi (M6.1 allowlist deseni — admin route
 * tarafında uygulanır; repository raw kabul eder).
 *
 * REUSE: externalMailFromAliasRepository deseni (companyId scope check +
 * upsert + remove).
 */

import { prisma } from './client.js';

const MAX_NAME_LEN = 255;

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    category: row.category,
    subject: row.subject,
    bodyHtml: row.bodyHtml,
    variables: row.variables,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
  };
}

async function list(companyId) {
  if (!companyId) return [];
  const rows = await prisma.caseEmailTemplate.findMany({
    where: { companyId },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
  return rows.map(shape);
}

async function listActive(companyId) {
  if (!companyId) return [];
  const rows = await prisma.caseEmailTemplate.findMany({
    where: { companyId, isActive: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
  return rows.map(shape);
}

async function getById(companyId, id) {
  if (!companyId || !id) return null;
  const row = await prisma.caseEmailTemplate.findUnique({ where: { id } });
  if (!row || row.companyId !== companyId) return null;
  return shape(row);
}

/**
 * upsert — draft.id varsa update; yoksa create.
 * @returns { ok: true, template } | { ok: false, code }
 *   code: 'name_required', 'body_required', 'name_too_long',
 *         'name_already_exists', 'not_found'
 */
async function upsert(companyId, draft, actorUserId = null) {
  if (!companyId) return { ok: false, code: 'company_missing' };
  if (!draft || typeof draft !== 'object') return { ok: false, code: 'invalid' };

  // Update path
  if (draft.id) {
    const existing = await prisma.caseEmailTemplate.findUnique({ where: { id: draft.id } });
    if (!existing || existing.companyId !== companyId) {
      return { ok: false, code: 'not_found' };
    }
    const updateData = {};
    if (draft.name !== undefined) {
      const n = typeof draft.name === 'string' ? draft.name.trim() : '';
      if (!n) return { ok: false, code: 'name_required' };
      if (n.length > MAX_NAME_LEN) return { ok: false, code: 'name_too_long' };
      updateData.name = n;
    }
    if (draft.category !== undefined) {
      const c = typeof draft.category === 'string' && draft.category.trim()
        ? draft.category.trim()
        : null;
      updateData.category = c;
    }
    if (draft.subject !== undefined) {
      updateData.subject = typeof draft.subject === 'string' && draft.subject.trim()
        ? draft.subject
        : null;
    }
    if (draft.bodyHtml !== undefined) {
      if (typeof draft.bodyHtml !== 'string' || !draft.bodyHtml.trim()) {
        return { ok: false, code: 'body_required' };
      }
      updateData.bodyHtml = draft.bodyHtml;
    }
    if (draft.variables !== undefined) {
      updateData.variables = typeof draft.variables === 'string'
        ? draft.variables
        : JSON.stringify(draft.variables ?? []);
    }
    if (typeof draft.isActive === 'boolean') updateData.isActive = draft.isActive;
    if (actorUserId) updateData.updatedByUserId = actorUserId;

    try {
      const row = await prisma.caseEmailTemplate.update({
        where: { id: draft.id },
        data: updateData,
      });
      return { ok: true, template: shape(row) };
    } catch (err) {
      if (err?.code === 'P2002') return { ok: false, code: 'name_already_exists' };
      throw err;
    }
  }

  // Create path
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  if (!name) return { ok: false, code: 'name_required' };
  if (name.length > MAX_NAME_LEN) return { ok: false, code: 'name_too_long' };
  const bodyHtml = typeof draft.bodyHtml === 'string' ? draft.bodyHtml : '';
  if (!bodyHtml.trim()) return { ok: false, code: 'body_required' };

  try {
    const row = await prisma.caseEmailTemplate.create({
      data: {
        companyId,
        name,
        category: typeof draft.category === 'string' && draft.category.trim()
          ? draft.category.trim()
          : null,
        subject: typeof draft.subject === 'string' && draft.subject.trim()
          ? draft.subject
          : null,
        bodyHtml,
        variables: typeof draft.variables === 'string'
          ? draft.variables
          : JSON.stringify(draft.variables ?? []),
        isActive: draft.isActive !== false,
        createdByUserId: actorUserId ?? null,
        updatedByUserId: actorUserId ?? null,
      },
    });
    return { ok: true, template: shape(row) };
  } catch (err) {
    if (err?.code === 'P2002') return { ok: false, code: 'name_already_exists' };
    throw err;
  }
}

async function remove(companyId, id) {
  if (!companyId || !id) return { ok: false, code: 'invalid' };
  const existing = await prisma.caseEmailTemplate.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) {
    return { ok: false, code: 'not_found' };
  }
  await prisma.caseEmailTemplate.delete({ where: { id } });
  return { ok: true };
}

export const caseEmailTemplateRepo = {
  list,
  listActive,
  getById,
  upsert,
  remove,
};
