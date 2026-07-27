import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import {
  resolveCodesForMerkez,
  findCasesByCodes,
  findCaseDetailByNumber,
  ConnectResolverError,
} from '../db/connectResolver.js';
import { mapCaseToConnectTicket, mapCaseToConnectDetail } from '../lib/connectMapper.js';
import { M_STATUS } from '../db/enumMap.js';

/**
 * /api/connect/* — Varuna↔Connect entegrasyonu.
 *   GET /tickets     — liste (bu dilimden önce eklendi).
 *   GET /tickets/:id — tek ticket'ın zengin detayı (bu dilim). `:id` =
 *     liste'nin döndürdüğü `id`, yani Case.caseNumber (globally unique).
 * Bu turda hâlâ YALNIZ OKUMA var (POST/PATCH sonraki dilimlerde).
 *
 * Auth: api-key, `x-api-key: <key>` VEYA `Authorization: Bearer <key>`
 * header; env CONNECT_API_KEY. server/routes/cron.js::checkCronSecret ile
 * aynı stil. Key yoksa (env tanımsız) veya yanlışsa: 401 — hangi sebep
 * olduğu client'a sızdırılmaz, yalnız server log'una yazılır. Her iki route
 * da AYNI `checkConnectApiKey`'i paylaşır (kopya YOK).
 *
 * FAIL-CLOSED sözleşmesi (scope/kod belirsizse ASLA "tüm vakalar" dönmez):
 *   - scope eksik/tanınmayan değer → 400 invalid_scope
 *   - scope=merkez, code eksik → 400 missing_param
 *   - scope=codes, codes eksik/boş/limit-aşımı → 400 missing_param/too_many_codes
 *   - GET /tickets: scope geçerli ama kod hiçbir Case'e eşleşmiyor → 200 +
 *     items:[] (geçerli bir arama kapsamı, sadece sonuç boş).
 *   - GET /tickets/:id: scope ZORUNLU (liste ile aynı) + IDOR kapatma —
 *     Case'in accountProject.code'u scope'un çözdüğü kod setinde DEĞİLSE
 *     (ya da Case hiç yoksa) 404 döner — 403 DEĞİL (varlık sızdırma yok).
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

// scope=merkez/codes validasyon hatası — ConnectResolverError ile aynı
// {code, message} sözleşmesini paylaşır (route'larda TEK catch bloğu ikisini
// de 400'e çevirir).
class ScopeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScopeError';
    this.code = code;
  }
}

/**
 * `scope` query paramını çözer — GET /tickets VE GET /tickets/:id TARAFINDAN
 * PAYLAŞILIR (kopya YOK). Başarılıysa yetkili AccountProject.code listesini
 * döner; aksi halde ScopeError veya (resolveCodesForMerkez'den)
 * ConnectResolverError throw eder — ikisi de caller'da aynı şekilde 400'e
 * çevrilir. FAIL-CLOSED: bilinmeyen/eksik scope ASLA "hepsi" anlamına gelmez.
 */
async function resolveScopeCodes({ scope, code, codesParam }) {
  if (scope === 'merkez') {
    if (code === undefined || code === null || String(code).trim() === '') {
      throw new ScopeError('missing_param', "scope=merkez için 'code' zorunlu.");
    }
    return resolveCodesForMerkez(code);
  }
  if (scope === 'codes') {
    if (!codesParam || typeof codesParam !== 'string' || !codesParam.trim()) {
      throw new ScopeError('missing_param', "scope=codes için 'codes' zorunlu.");
    }
    const codes = codesParam
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    if (!codes.length) {
      throw new ScopeError('missing_param', "'codes' listesi boş.");
    }
    // DB'ye gitmeden reddet — MSSQL parametre limiti + DoS payı (bkz. MAX_CODES yorumu).
    if (codes.length > MAX_CODES) {
      throw new ScopeError(
        'too_many_codes',
        `'codes' listesi en fazla ${MAX_CODES} kod içerebilir (gelen: ${codes.length}).`,
      );
    }
    return codes;
  }
  // FAIL-CLOSED — bilinmeyen/eksik scope asla tüm vakaları döndürmez.
  throw new ScopeError('invalid_scope', "'scope' 'merkez' veya 'codes' olmalı.");
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
    codes = await resolveScopeCodes({ scope, code, codesParam });
  } catch (err) {
    if (err instanceof ScopeError || err instanceof ConnectResolverError) {
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

router.get('/tickets/:id', async (req, res) => {
  if (!checkConnectApiKey(req, res)) return;

  const { scope, code, codes: codesParam } = req.query;
  const caseNumber = req.params.id;

  let authorizedCodes;
  try {
    authorizedCodes = await resolveScopeCodes({ scope, code, codesParam });
  } catch (err) {
    if (err instanceof ScopeError || err instanceof ConnectResolverError) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    console.error('[connect-api:ticket-detail] kod çözümleme hatası:', err);
    return res.status(500).json({ error: 'internal', message: 'Sunucu hatası' });
  }

  try {
    const caseRow = await findCaseDetailByNumber(caseNumber, authorizedCodes);
    if (!caseRow) {
      // Case yok VEYA çağıranın yetkili kod setinde değil (IDOR kapatma) —
      // ikisi için de AYNI 404; 403 ile "var ama erişemiyorsun" ima etmiyoruz.
      return res.status(404).json({ error: 'not_found' });
    }
    console.log('[connect-api:ticket-detail] audit', {
      scope,
      ...(scope === 'merkez' ? { code } : {}),
      ...(scope === 'codes' ? { codesCount: authorizedCodes.length } : {}),
      caseNumber,
    });
    res.json(mapCaseToConnectDetail(caseRow));
  } catch (err) {
    console.error('[connect-api:ticket-detail]', err);
    res.status(500).json({ error: 'internal', message: 'Sunucu hatası' });
  }
});

export default router;
