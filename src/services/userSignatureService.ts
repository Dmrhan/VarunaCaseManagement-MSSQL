/**
 * M6.3b Faz 2 — User signature self-service service.
 *
 * Endpoint'ler `server/routes/auth.js`:
 *  - GET   /api/auth/me/signature → { signatureHtml: string | null }
 *  - PATCH /api/auth/me/signature  body { signatureHtml: string | null }
 *
 * Save sanitize-html backend tarafında (M6.1 allowlist deseni).
 *
 * REUSE: caseService apiFetch deseni — error/toast otomatik.
 */
import { apiFetch } from './caseService';

const ENDPOINT = '/api/auth/me/signature';

/** Mevcut imzayı çek. */
export async function getMySignature(): Promise<string | null> {
  const r = await apiFetch<{ signatureHtml: string | null }>(
    ENDPOINT,
    undefined,
    'İmza',
  );
  return r?.signatureHtml ?? null;
}

/**
 * İmzayı set et veya kaldır (null/empty → kaldır).
 * Backend sanitize-html allowlist uygular.
 */
export async function updateMySignature(signatureHtml: string | null): Promise<string | null> {
  const r = await apiFetch<{ signatureHtml: string | null }>(
    ENDPOINT,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureHtml }),
    },
    'İmza güncelle',
  );
  return r?.signatureHtml ?? null;
}

export const userSignatureService = {
  getMySignature,
  updateMySignature,
};
