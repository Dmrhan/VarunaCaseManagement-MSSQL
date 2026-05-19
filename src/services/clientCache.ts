/**
 * WR-H2 / AGENTIC_PLANNING_PROTOCOL v2.0 §③ #2 — Client-side TTL cache.
 *
 * Amaç: Drawer ve detay sayfaları reopen edildiğinde aynı GET endpoint'ini
 * tekrar tekrar fetch etmekten kaçınmak. Kullanıcı 30 saniye içinde aynı
 * vakaya/hesaba dönerse network'e gitmeden cache'ten döner.
 *
 * Sınırlar:
 *  - Sadece GET endpoint'leri (mutasyonlarda kullanılmaz).
 *  - Cache module-level singleton; her browser tab kendi cache'ini tutar.
 *  - Tab kapandığında cache de gider (persistent storage yok — PII güvenliği).
 *  - Logout (`app:unauthenticated`) sırasında `clearClientCache()` çağrılır
 *    (AuthContext tarafından).
 *
 * Tasarım kararı (no circular import): `cachedGet` apiFetch'i direkt
 * import etmez — caller fetcher callback'ini verir. Bu sayede service'ler
 * apiFetch'i kendileri kullanırken cache layer'ı izole kalır.
 *
 * Invalidation:
 *  - Mutation'ı tetikleyen service metodu, mutation success sonrası
 *    `invalidateCachePath(url)` veya `invalidateCachePrefix(prefix)` çağırır.
 *
 * Cache shape (her entry):
 *   { data: T, expiresAt: epochMs }
 */

type CacheEntry<T = unknown> = {
  data: T;
  expiresAt: number;
};

const memCache = new Map<string, CacheEntry>();

/** Varsayılan TTL — drawer/detail reopen pattern için 30 saniye. */
export const DEFAULT_CLIENT_CACHE_TTL_MS = 30_000;

/**
 * Cache-aware fetcher wrapper. Hit → cached data; miss → fetcher() + cache write.
 *
 * Sadece başarılı (data !== undefined) yanıtlar cache'lenir; fetcher hata
 * durumunda undefined döner ve cache yazılmaz, böylece bir sonraki çağrı
 * fresh denemesi olur.
 *
 * @param key      Cache anahtarı — genelde GET path (`${API_BASE}/${id}` vb.)
 * @param ttlMs    Cache yaşam süresi (default 30s)
 * @param fetcher  Cache miss durumunda çağrılacak async fonksiyon (genelde apiFetch wrapper'ı)
 */
export async function cachedGet<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const now = Date.now();
  const hit = memCache.get(key);
  if (hit && hit.expiresAt > now) {
    if (typeof window !== 'undefined' && import.meta.env?.DEV) {
      console.debug('[clientCache] hit', key, `ttl=${hit.expiresAt - now}ms`);
    }
    return hit.data as T;
  }
  const data = await fetcher();
  if (data !== undefined) {
    memCache.set(key, { data, expiresAt: now + ttlMs });
  }
  return data;
}

/** Tek key'i cache'ten düşür. Bilinmeyen key için false döner. */
export function invalidateCachePath(key: string): boolean {
  return memCache.delete(key);
}

/**
 * Prefix match toplu drop. Örnek: invalidateCachePrefix('/api/cases/abc123')
 * hem `/api/cases/abc123`'ü hem de `/api/cases/abc123/customer-context`'i siler.
 * Silinen entry sayısını döner.
 */
export function invalidateCachePrefix(prefix: string): number {
  let count = 0;
  for (const key of Array.from(memCache.keys())) {
    if (key.startsWith(prefix)) {
      memCache.delete(key);
      count++;
    }
  }
  return count;
}

/** Tüm cache'i temizle. AuthContext logout'ta çağırır. */
export function clearClientCache(): void {
  memCache.clear();
}

/** Debug için cache boyutu. */
export function _internalCacheSize(): number {
  return memCache.size;
}
