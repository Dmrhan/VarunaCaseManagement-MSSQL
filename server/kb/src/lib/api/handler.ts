/*
 * Public /v1/* endpoint'leri için ortak handler wrapper.
 * Auth + rate limit + CORS + standart error handling tek yerde.
 */

import {
  authenticateApiRequest,
  apiErrorResponse,
  handleAuthError,
  type ApiCaller,
} from "./auth";
import { checkRateLimit, rateLimitErrorResponse } from "./rate-limit";
import { applyCorsHeaders, corsPreflight } from "./cors";

type V1Handler = (req: Request, caller: ApiCaller) => Promise<Response>;

export function v1Endpoint(handler: V1Handler) {
  return async function wrapped(req: Request): Promise<Response> {
    const origin = req.headers.get("origin");

    // 1) CORS preflight
    if (req.method === "OPTIONS") {
      return corsPreflight(origin);
    }

    // 2) Auth
    let caller: ApiCaller;
    try {
      caller = authenticateApiRequest(req);
    } catch (err) {
      const r = handleAuthError(err);
      if (r) return applyCorsHeaders(r, origin);
      throw err;
    }

    // 3) Rate limit
    const rl = checkRateLimit(caller.tenantId);
    if (!rl.allowed) {
      return applyCorsHeaders(rateLimitErrorResponse(rl.retryAfterSec), origin);
    }

    // 4) Handler — hata yakala
    try {
      const res = await handler(req, caller);
      // Rate limit info header
      res.headers.set("X-RateLimit-Remaining", String(rl.remaining));
      return applyCorsHeaders(res, origin);
    } catch (err) {
      const msg = (err as Error)?.message ?? "Bilinmeyen sunucu hatası";
      console.error(
        `[v1] handler error (tenant=${caller.tenantId}, key=${caller.keyHint}):`,
        err,
      );
      return applyCorsHeaders(apiErrorResponse(msg, 500), origin);
    }
  };
}

export const OPTIONS_HANDLER = (req: Request): Response => {
  return corsPreflight(req.headers.get("origin"));
};
