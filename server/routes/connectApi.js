import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { resolveCodesForMerkez, findCasesByCodes, ConnectResolverError } from '../db/connectResolver.js';
import { mapCaseToConnectTicket } from '../lib/connectMapper.js';
import { M_STATUS } from '../db/enumMap.js';

/**
 * /api/connect/* — Varuna↔Connect entegrasyonu, ilk uçtan-uca dilim.
 * Bu turda YALNIZ GET-liste var (POST/PATCH/detay/attachment sonraki
 * dilimlerde).
 *
 * Auth: api-key, `x-api-key: <key>` VEYA `Authorization: Bearer <key>`
 * header; env CONNECT_API_KEY. server/routes/cron.js::checkCronSecret ile
 * aynı stil. Key yoksa (env tanımsız) veya yanlışsa: 401 — hangi sebep
 * olduğu client'a sızdırılmaz, yalnız server log'una yazılır.
 *
 * FAIL-CLOSED sözleşmesi (scope/kod belirsizse ASLA "tüm vakalar" dönmez):
 *   - scope eksik/tanınmayan değer → 400 invalid_scope
 *   - scope=merkez, code eksik → 400 missing_param
 *   - scope=codes, codes eksik/boş → 400 missing_param
 *   - scope geçerli ama kod hiçbir Case'e eşleşmiyor → 200 + items:[]
 *     (geçerli bir arama kapsamı, sadece sonuç boş — "tüm kayıtlar" değil)
 */

const router = Router();

// Sabit-zaman key karşılaştırma — server/routes/system.js::healthTokenMatches
// ve server/db/storage.js::verifyStorageToken ile aynı desen (uzunluk
// guard'ı ÖNCE, sonra timingSafeEqual; uzunluk farkında kısa-devre timing
// bilgisi sızdırmaz çünkü zaten `!==` uzunluk karşılaştırması sabit-zaman
// gerektirmez — yalnız EŞİT uzunluktaki string'lerin byte-byte karşılaştırma
// süresi timing side-channel taşır, timingSafeEqual bunu kapatır).
function keyMatches(provided, expected) {
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function checkConnectApiKey(req, res) {
  const expected = process.env.CONNECT_API_KEY;
  if (!expected) {
    console.error('[connect-api] CONNECT_API_KEY tanımlı değil — istek reddedildi (fail-closed).');
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  const bearerMatch = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  const provided = req.headers['x-api-key'] || (bearerMatch ? bearerMatch[1] : null);
  if (!provided || !keyMatches(provided, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

// Case.status ASCII identifier kümesi (server/db/enumMap.js tek kaynak) —
// burada ayrı bir liste DUPLICATE edilmez.
const VALID_STATUSES = new Set(Object.values(M_STATUS));

// scope=codes üst sınırı — MSSQL 2100 parametre limiti (bkz. _n4bmigrate.mjs
// MSSQL_MAX_PARAMS yorumu) + DoS payı (tek istekte binlerce kod ile Case
// tablosunda geniş IN taraması). 500 kod IN filtresi tek başına parametre
// limitine yaklaşmaz (bu sorguda kod başına 1 parametre) ama makul bir
// istemci-hatası/kötüye-kullanım tavanı olarak konuldu.
const MAX_CODES = 500;
// Sayfa üst sınırı — MAX_SAFE_INTEGER makul değil (skip hesaplaması keyfi
// büyür, tam sayı taşması riski yok ama anlamsız geniş skip DB'ye gereksiz
// yük bindirir). 100000 sayfa * pageSize=200 zaten pratik sınırın çok
// üstünde bir tavan.
const MAX_PAGE = 100000;

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

router.get('/tickets', async (req, res) => {
  if (!checkConnectApiKey(req, res)) return;

  const { scope, code, codes: codesParam, status, updatedSince } = req.query;
  const page = clampInt(req.query.page, 1, 1, MAX_PAGE);
  const pageSize = clampInt(req.query.pageSize, 50, 1, 200);

  if (status !== undefined && !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'invalid_status', message: `Bilinmeyen status: ${status}` });
  }
  if (updatedSince !== undefined && Number.isNaN(new Date(updatedSince).getTime())) {
    return res
      .status(400)
      .json({ error: 'invalid_updatedSince', message: "'updatedSince' geçerli bir ISO tarih olmalı." });
  }

  let codes;
  try {
    if (scope === 'merkez') {
      if (code === undefined || code === null || String(code).trim() === '') {
        return res.status(400).json({ error: 'missing_param', message: "scope=merkez için 'code' zorunlu." });
      }
      codes = await resolveCodesForMerkez(code);
    } else if (scope === 'codes') {
      if (!codesParam || typeof codesParam !== 'string' || !codesParam.trim()) {
        return res.status(400).json({ error: 'missing_param', message: "scope=codes için 'codes' zorunlu." });
      }
      codes = codesParam
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (!codes.length) {
        return res.status(400).json({ error: 'missing_param', message: "'codes' listesi boş." });
      }
      // DB'ye gitmeden reddet — MSSQL parametre limiti + DoS payı (bkz. MAX_CODES yorumu).
      if (codes.length > MAX_CODES) {
        return res.status(400).json({
          error: 'too_many_codes',
          message: `'codes' listesi en fazla ${MAX_CODES} kod içerebilir (gelen: ${codes.length}).`,
        });
      }
    } else {
      // FAIL-CLOSED — bilinmeyen/eksik scope asla tüm vakaları döndürmez.
      return res.status(400).json({ error: 'invalid_scope', message: "'scope' 'merkez' veya 'codes' olmalı." });
    }
  } catch (err) {
    if (err instanceof ConnectResolverError) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    console.error('[connect-api:tickets] kod çözümleme hatası:', err);
    return res.status(500).json({ error: 'internal', message: 'Sunucu hatası' });
  }

  try {
    const { items, total } = await findCasesByCodes(codes, { status, updatedSince, page, pageSize });
    // Audit log — yalnız BAŞARILI istekte, tek yapılandırılmış satır.
    // API key ASLA loglanmaz (ne header adı ne değeri). scope'a göre ya
    // `code` (merkez) ya `codesCount` (codes) doldurulur — ham `codes`
    // listesi (potansiyel PII/uzun liste) loglanmaz, yalnız sayısı.
    console.log('[connect-api:tickets] audit', {
      scope,
      ...(scope === 'merkez' ? { code } : {}),
      ...(scope === 'codes' ? { codesCount: codes.length } : {}),
      resultCount: items.length,
      page,
    });
    res.json({ items: items.map(mapCaseToConnectTicket), page, pageSize, total });
  } catch (err) {
    console.error('[connect-api:tickets]', err);
    res.status(500).json({ error: 'internal', message: 'Sunucu hatası' });
  }
});

export default router;
