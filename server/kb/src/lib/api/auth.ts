/*
 * Public API (v1) auth — Bearer token doğrulama + tenant_id extract.
 *
 * Format: Authorization: Bearer <api_key>
 * .env'de API_KEYS=key1:tenant1,key2:tenant2 olarak tanımlanır.
 *
 * Önerilen key formatı: sk-<tenant>-<random32> — örn. sk-varuna-a1b2c3d4...
 * Üretmek için: openssl rand -hex 24 → "sk-varuna-${output}"
 */

import { env } from "../env";

export class ApiAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number = 401,
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

export type ApiCaller = {
  apiKey: string;     // ham key (loglamak için maskeleyin)
  tenantId: string;   // hangi tenant
  keyHint: string;    // log için ilk 8 karakter + ...
};

/**
 * Request'ten API caller'ı çıkar. Geçersizse fırlatır (401/403).
 *
 * Auth header eksikse 401.
 * Header var ama key tanınmıyorsa 401.
 */
export function authenticateApiRequest(req: Request): ApiCaller {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    throw new ApiAuthError("Authorization header eksik.");
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new ApiAuthError("Authorization header 'Bearer <token>' formatında olmalı.");
  }
  const apiKey = match[1]?.trim();
  if (!apiKey) throw new ApiAuthError("API key boş.");

  const keys = env().API_KEYS;
  const tenantId = keys[apiKey];
  if (!tenantId) {
    throw new ApiAuthError("Geçersiz API key.", 401);
  }

  return {
    apiKey,
    tenantId,
    keyHint: `${apiKey.slice(0, 8)}…`,
  };
}

/**
 * API error response — tutarlı JSON format.
 */
export function apiErrorResponse(
  message: string,
  status: number,
  details?: unknown,
): Response {
  return Response.json(
    {
      error: {
        message,
        status,
        ...(details ? { details } : {}),
      },
    },
    { status },
  );
}

/**
 * Auth hatasını yakalayıp standart response'a çevirir.
 * Diğer hataları geri fırlatır (genel handler yakalar).
 */
export function handleAuthError(err: unknown): Response | null {
  if (err instanceof ApiAuthError) {
    return apiErrorResponse(err.message, err.status);
  }
  return null;
}
