/*
 * Basit in-memory rate limiter — tenant başına sliding window.
 *
 * Production'da Redis tabanlı bir limiter (örn. @upstash/ratelimit) tercih
 * edilir, ama tek-instance dev/MVP için bu yeter. 50 ticket/gün hedefi
 * dakikada 1 istek; default 60/dk limiti rahatlıkla yeter.
 *
 * Bellek temizliği: her 5 dakikada bir dolu pencerelerden eski entry'leri at.
 */

import { env } from "../env";

type Window = number[]; // istek timestamp'larının dizisi (ms)

const buckets = new Map<string, Window>();
const WINDOW_MS = 60_000; // 1 dakika

function nowMs(): number {
  return Date.now();
}

/**
 * Bir tenant için rate limit kontrolü. İzin verilirse true, aksi halde false +
 * `retryAfterSec` döner.
 */
export function checkRateLimit(tenantId: string): {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
} {
  const limit = env().API_RATE_LIMIT_PER_MIN;
  const now = nowMs();
  const cutoff = now - WINDOW_MS;

  let window = buckets.get(tenantId);
  if (!window) {
    window = [];
    buckets.set(tenantId, window);
  }
  // Eski timestamp'ları temizle (sliding window)
  while (window.length > 0 && window[0]! < cutoff) {
    window.shift();
  }

  if (window.length >= limit) {
    const oldest = window[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSec, remaining: 0 };
  }

  window.push(now);
  return { allowed: true, retryAfterSec: 0, remaining: limit - window.length };
}

/**
 * Periyodik temizlik — node process boyunca çalışır.
 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
if (typeof setInterval !== "undefined" && !cleanupTimer) {
  cleanupTimer = setInterval(() => {
    const cutoff = nowMs() - WINDOW_MS;
    for (const [tenant, window] of buckets) {
      while (window.length > 0 && window[0]! < cutoff) window.shift();
      if (window.length === 0) buckets.delete(tenant);
    }
  }, 5 * 60_000);
  // Test ve production'da Node'un kapatılmasını engellemesin
  (cleanupTimer as unknown as { unref?: () => void }).unref?.();
}

export function rateLimitErrorResponse(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: "Çok fazla istek (rate limit). Lütfen biraz sonra tekrar deneyin.",
        status: 429,
        retry_after_seconds: retryAfterSec,
      },
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
      },
    },
  );
}
