#!/usr/bin/env node
/**
 * smoke-client-cache.mjs — WR-H2 client cache focused tests (unit-style).
 *
 * Çalıştır:
 *   node scripts/smoke-client-cache.mjs
 *
 * Frontend test infra (Vitest, BACKLOG #7) henüz set up değil; bu script
 * pure ESM olarak çalışır ve `src/services/clientCache.ts`'nin saf logic'ini
 * (Map + TTL + invalidation) inline kopya ile re-implement edip aynı
 * davranışı doğrular. Asıl modül değişirse buradaki kopya da güncellenir.
 *
 * Test edilen kontrat:
 *  1. cachedGet hit/miss + TTL expiration
 *  2. invalidateCachePath tek key drop
 *  3. invalidateCachePrefix prefix toplu drop
 *  4. invalidateCacheMatching predicate (WR-H2 review fix — customer-context wipe)
 *  5. clearClientCache hepsini siler
 *  6. Failed fetcher (undefined) cache'e yazılmaz
 *
 * Kaynak gerçek: src/services/clientCache.ts — bu testteki davranış o
 * dosyanın public API'sini yansıtmalı. Sürüm tutarlılığı için CI'da
 * çalıştırılması önerilir.
 */

// ─────────────────────────────────────────────────────────────────
// clientCache logic (mirror of src/services/clientCache.ts)
// ─────────────────────────────────────────────────────────────────
const memCache = new Map();
const DEFAULT_CLIENT_CACHE_TTL_MS = 30_000;

async function cachedGet(key, ttlMs, fetcher) {
  const now = Date.now();
  const hit = memCache.get(key);
  if (hit && hit.expiresAt > now) return hit.data;
  const data = await fetcher();
  if (data !== undefined) memCache.set(key, { data, expiresAt: now + ttlMs });
  return data;
}

function invalidateCacheMatching(predicate) {
  let count = 0;
  for (const key of Array.from(memCache.keys())) {
    if (predicate(key)) {
      memCache.delete(key);
      count++;
    }
  }
  return count;
}

function invalidateCachePath(key) {
  return memCache.delete(key);
}

function invalidateCachePrefix(prefix) {
  return invalidateCacheMatching((key) => key.startsWith(prefix));
}

function clearClientCache() {
  memCache.clear();
}

function _internalCacheSize() {
  return memCache.size;
}

// ─────────────────────────────────────────────────────────────────
// Test harness
// ─────────────────────────────────────────────────────────────────
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

function makeFetcher(value) {
  let calls = 0;
  return {
    fn: async () => {
      calls++;
      return value;
    },
    get calls() {
      return calls;
    },
  };
}

// ── Test 1: hit/miss + TTL ──
console.log('\n── 1) cachedGet hit/miss + TTL ──');
clearClientCache();
const f1 = makeFetcher({ id: 'A' });
const first = await cachedGet('/api/a', 30_000, f1.fn);
record('1a. First call returns fetcher result', first?.id === 'A' && f1.calls === 1, `calls=${f1.calls}`);

const second = await cachedGet('/api/a', 30_000, f1.fn);
record('1b. Second call returns cached (fetcher NOT called)', second?.id === 'A' && f1.calls === 1, `calls=${f1.calls}`);

// TTL expiration
clearClientCache();
const f2 = makeFetcher({ id: 'B' });
await cachedGet('/api/b', 1, f2.fn); // 1ms TTL
await new Promise((r) => setTimeout(r, 5));
await cachedGet('/api/b', 1, f2.fn);
record('1c. TTL expiration triggers refetch', f2.calls === 2, `calls=${f2.calls}`);

// ── Test 2: invalidateCachePath ──
console.log('\n── 2) invalidateCachePath ──');
clearClientCache();
const f3 = makeFetcher({ id: 'C' });
await cachedGet('/api/c', 30_000, f3.fn);
record('2a. Path stored', _internalCacheSize() === 1);
const dropped = invalidateCachePath('/api/c');
record('2b. invalidateCachePath returns true on hit', dropped === true);
record('2c. After invalidate, cache empty', _internalCacheSize() === 0);
await cachedGet('/api/c', 30_000, f3.fn);
record('2d. Re-fetch after invalidate', f3.calls === 2, `calls=${f3.calls}`);

// ── Test 3: invalidateCachePrefix ──
console.log('\n── 3) invalidateCachePrefix ──');
clearClientCache();
await cachedGet('/api/cases/X', 30_000, async () => ({ id: 'X' }));
await cachedGet('/api/cases/X/customer-context', 30_000, async () => ({ ctx: 'X' }));
await cachedGet('/api/cases/Y', 30_000, async () => ({ id: 'Y' }));
record('3a. 3 entries before prefix invalidate', _internalCacheSize() === 3);
const dropPrefix = invalidateCachePrefix('/api/cases/X');
record('3b. Prefix drop count = 2 (X + X/customer-context)', dropPrefix === 2, `count=${dropPrefix}`);
record('3c. Y entry preserved', _internalCacheSize() === 1);

// ── Test 4: invalidateCacheMatching (WR-H2 review fix critical path) ──
console.log('\n── 4) invalidateCacheMatching — customer-context broad wipe ──');
clearClientCache();
await cachedGet('/api/accounts/ACC1', 30_000, async () => ({ id: 'ACC1' }));
await cachedGet('/api/cases/CASE1', 30_000, async () => ({ id: 'CASE1' }));
await cachedGet('/api/cases/CASE1/customer-context', 30_000, async () => ({ ctx: 'CASE1' }));
await cachedGet('/api/cases/CASE2/customer-context', 30_000, async () => ({ ctx: 'CASE2' }));
await cachedGet('/api/cases/CASE3/customer-context', 30_000, async () => ({ ctx: 'CASE3' }));
record('4a. 5 mixed entries', _internalCacheSize() === 5);

// Account mutation simulation — broad invalidation
const wiped = invalidateCacheMatching(
  (k) => k.startsWith('/api/cases/') && k.endsWith('/customer-context'),
);
record('4b. customer-context wipe drops 3 entries', wiped === 3, `count=${wiped}`);
record('4c. Account detail + case detail preserved', _internalCacheSize() === 2);

// ── Test 5: clearClientCache ──
console.log('\n── 5) clearClientCache (logout / session invalidation) ──');
await cachedGet('/api/accounts/ACC2', 30_000, async () => ({ id: 'ACC2' }));
await cachedGet('/api/cases/CASE4', 30_000, async () => ({ id: 'CASE4' }));
record('5a. Cache has entries before clear', _internalCacheSize() >= 2);
clearClientCache();
record('5b. clearClientCache empties cache', _internalCacheSize() === 0);

// ── Test 6: Failed fetcher (undefined) is NOT cached ──
console.log('\n── 6) Undefined fetcher result is not cached ──');
clearClientCache();
let attempt = 0;
const flaky = async () => {
  attempt++;
  return attempt === 1 ? undefined : { ok: true };
};
const r1 = await cachedGet('/api/flaky', 30_000, flaky);
record('6a. First (failed) returns undefined', r1 === undefined);
record('6b. Failed result not cached', _internalCacheSize() === 0);
const r2 = await cachedGet('/api/flaky', 30_000, flaky);
record('6c. Second call retries fetcher', r2?.ok === true && attempt === 2, `attempt=${attempt}`);

// ── Summary ──
const failed = results.filter((r) => !r.ok);
console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('[smoke] FAILED:');
  failed.forEach((f) => console.log(`  - ${f.name} ${f.detail ?? ''}`));
  process.exitCode = 1;
} else {
  console.log('[smoke] ALL GREEN');
}
