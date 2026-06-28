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

/**
 * Mevcut imzayı çek.
 * undefined → fetch fail (network/server error; apiFetch toast atar).
 * null     → backend imza tanımlı değil (kullanıcı henüz set etmedi).
 * string   → mevcut imza HTML.
 *
 * Codex P2 fix — failure signal'i null'a coalesce ETME; caller
 * (UserSignatureModal) `result === undefined` ile fail durumunu
 * "henüz imza yok" durumundan ayırt eder.
 */
export async function getMySignature(): Promise<string | null | undefined> {
  const r = await apiFetch<{ signatureHtml: string | null }>(
    ENDPOINT,
    undefined,
    'İmza',
  );
  if (r === undefined) return undefined; // fetch fail — caller success göstermesin
  return r.signatureHtml ?? null;
}

/**
 * İmzayı set et veya kaldır (null/empty → kaldır).
 * Backend sanitize-html allowlist uygular.
 * undefined → fetch fail (network/server error).
 */
export async function updateMySignature(
  signatureHtml: string | null,
): Promise<string | null | undefined> {
  const r = await apiFetch<{ signatureHtml: string | null }>(
    ENDPOINT,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureHtml }),
    },
    'İmza güncelle',
  );
  if (r === undefined) return undefined; // Codex P2 fix — fail preserve
  return r.signatureHtml ?? null;
}

export const userSignatureService = {
  getMySignature,
  updateMySignature,
};
