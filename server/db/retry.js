/**
 * Transient DB error retry helper.
 *
 * Yalnızca read-only / idempotent path'lerde kullan (verifyJwt, bootstrap).
 * Mutation'larda (case create, note add, vb.) KULLANMA — kısmen tamamlanmış
 * yazma yarısında retry duplicate oluşturabilir.
 *
 * Retry edilen Prisma hata kodları:
 *   - P1001: Can't reach database server (pooler aksaklığı, network blip)
 *   - P1017: Server has closed the connection (pooler restart)
 *   - P2024: Timed out fetching connection from pool (overload)
 *
 * Diğer hatalar (auth fail, schema mismatch, query error) anında throw edilir.
 *
 * Olay geçmişi: docs/INCIDENTS.md §3.1 (2026-05-02 pooler aksaklığı).
 */

const TRANSIENT_CODES = new Set(['P1001', 'P1017', 'P2024']);

export async function withDbRetry(fn, { retries = 1, delayMs = 300, label = 'db' } = {}) {
  const delays = Array.isArray(delayMs) ? delayMs : Array(retries).fill(delayMs);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isTransient = TRANSIENT_CODES.has(err?.code);
      if (!isTransient || attempt === retries) throw err;
      const wait = delays[attempt] ?? 300;
      console.warn(
        `[${label}-retry] transient error (${err.code}), retry ${attempt + 1}/${retries} in ${wait}ms`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
