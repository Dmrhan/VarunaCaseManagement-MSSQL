/*
 * CORS yardımcıları — public /v1/* endpoint'leri için.
 *
 * env CORS_ALLOWED_ORIGINS:
 *   - "*" → tüm origin'lere izin (dev için OK, production'da spesifik liste)
 *   - "https://varuna.com,https://app.varuna.com" → sadece bu origin'ler
 */

import { env } from "../env";

function parseAllowedOrigins(): string[] | "*" {
  const raw = env().CORS_ALLOWED_ORIGINS.trim();
  if (raw === "*" || raw === "") return "*";
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

export function corsHeadersFor(origin: string | null): Record<string, string> {
  const allowed = parseAllowedOrigins();
  let allowOrigin: string;
  if (allowed === "*") {
    allowOrigin = origin ?? "*";
  } else if (origin && allowed.includes(origin)) {
    allowOrigin = origin;
  } else {
    allowOrigin = allowed[0] ?? "*"; // fallback ilk izinli
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function applyCorsHeaders(res: Response, origin: string | null): Response {
  const headers = corsHeadersFor(origin);
  for (const [k, v] of Object.entries(headers)) {
    res.headers.set(k, v);
  }
  return res;
}

export function corsPreflight(origin: string | null): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeadersFor(origin),
  });
}
