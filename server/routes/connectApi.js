import { Router, json } from 'express';
import { timingSafeEqual } from 'node:crypto';
import {
  resolveCodesForMerkez,
  findCasesByCodes,
  findCaseDetailByNumber,
  resolveSingleProjectByCode,
  createConnectCase,
  resolveAuthorizedCaseId,
  CONNECT_ACTOR_DISPLAY_NAME,
  ConnectResolverError,
} from '../db/connectResolver.js';
import { CaseValidationError, caseRepository, CONNECT_ATTACHMENT_MAX_FILE_BYTES } from '../db/caseRepository.js';
import { createDownloadUrl } from '../db/storage.js';
import { isAcceptedUpload } from '../lib/uploadWhitelist.js';
import {
  mapCaseToConnectTicket,
  mapCaseToConnectDetail,
  mapConnectTypeToRequestType,
  toConnectStatus,
  trStatusLabelToAscii,
} from '../lib/connectMapper.js';
import { M_STATUS } from '../db/enumMap.js';

/**
 * /api/connect/* — Varuna↔Connect entegrasyonu.
 *   GET  /tickets                  — liste.
 *   GET  /tickets/:id               — tek ticket'ın zengin detayı. `:id` =
 *     liste'nin döndürdüğü `id`, yani Case.caseNumber (globally unique).
 *   POST /tickets                   — Connect'ten talep açma → yeni Varuna
 *     Case.
 *   POST /tickets/:id/attachments   — Connect'ten dosya ekleme (server-to-
 *     server, base64 gövde) — bu dilim. PATCH sonraki dilimde.
 *
 * Auth: api-key, `x-api-key: <key>` VEYA `Authorization: Bearer <key>`
 * header; env CONNECT_API_KEY. server/routes/cron.js::checkCronSecret ile
 * aynı stil. Key yoksa (env tanımsız) veya yanlışsa: 401 — hangi sebep
 * olduğu client'a sızdırılmaz, yalnız server log'una yazılır. Dört route da
 * AYNI `checkConnectApiKey`'i paylaşır (kopya YOK).
 *
 * FAIL-CLOSED sözleşmesi (scope/kod belirsizse ASLA "tüm vakalar" dönmez):
 *   - scope eksik/tanınmayan değer → 400 invalid_scope
 *   - scope=merkez, code eksik → 400 missing_param
 *   - scope=codes, codes eksik/boş/limit-aşımı → 400 missing_param/too_many_codes
 *   - GET /tickets: scope geçerli ama kod hiçbir Case'e eşleşmiyor → 200 +
 *     items:[] (geçerli bir arama kapsamı, sadece sonuç boş).
 *   - GET /tickets/:id VE POST /tickets/:id/attachments: scope ZORUNLU (liste
 *     ile aynı) + IDOR kapatma — Case'in accountProject.code'u scope'un
 *     çözdüğü kod setinde DEĞİLSE (ya da Case hiç yoksa) 404 döner — 403
 *     DEĞİL (varlık sızdırma yok).
 *   - POST /tickets: `code` ZORUNLU + TEKİL eşleşme — 0 veya >1
 *     AccountProject'e çözülürse 422 (code_not_found/code_ambiguous);
 *     sessizce "ilkini seç" YOK (yanlış müşteriye/projeye bağlama riski).
 *     Eksik zorunlu alan (code/title/description/type) → 400. Bilinmeyen
 *     `type` → 400 invalid_type.
 *   - POST /tickets/:id/attachments: `files[]` zorunlu, dosya sayısı/boyut/
 *     tip cap'lerinin herhangi biri aşılırsa/ihlal edilirse 400/413 (bkz.
 *     parseAttachmentIngestBody). Bilinmeyen mime/uzantı → 400
 *     unsupported_file_type. Geçersiz base64 → 400 invalid_base64. Bu
 *     validasyonun TAMAMI ağır (50mb) body-parser'dan ÖNCE değil — auth/
 *     rate-limit `connectGuard` middleware'i ile parser'dan ÖNCE çalışır
 *     (security fix: pre-auth DoS yüzeyi kapatıldı). Çoklu dosyada kısmi
 *     başarısızlık (ör. 3 dosyadan 3.'sünde storage/DB hatası) SESSİZCE
 *     kaybolmaz: o ana kadar eklenmiş dosyalar `{ ingested: [...], failed:
 *     {fileName, error, message} }` ile birlikte döner (uygun 4xx/500 ile) —
 *     Connect hangi dosyanın gerçekten eklendiğini görür, kör-retry yapmaz.
 *     Hepsi başarılıysa `201 { ingested: [...] }`.
 *   - İki YAZMA yolu da (POST /tickets, POST /tickets/:id/attachments) key
 *     başına dakikada 30 istekle sınırlıdır (checkCreateRateLimit, PAYLAŞIMLI
 *     sayaç) — aşımda 429 rate_limited.
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

// ----------------------------------------------------------------
// POST /tickets rate limit — key başına dakikada N create. Basit
// sliding-window in-memory; server/routes/ai.js::rateLimit ile AYNI
// prensip (IP/anahtar başına zaman-damgalı bucket, pencere dışı temizlik),
// ama Express middleware zinciri yerine bu dosyanın zaten kullandığı
// "checkX(req,res) → bool, false ise kendi response'unu yazar" deseniyle
// (checkConnectApiKey) TUTARLI hale getirildi.
//
// Yalnız YAZMA yolu (POST) sınırlanır — GET uçları (liste/detay) bu turda
// EKLENMEDİ, ayrı bir sertleştirme turuna bırakıldı (görev kararı).
// checkConnectApiKey BUNDAN ÖNCE çalıştığı için buraya yalnız doğrulanmış
// key ile gelinir; key bazlı bucket bu yüzden anlamlı (Connect tek bir
// entegrasyon kimliği paylaşır). IP fallback yalnız savunma-derinliği.
// ----------------------------------------------------------------
const CREATE_RATE_LIMIT_PER_MIN = 30;
const createRateBuckets = new Map();

function checkCreateRateLimit(req, res) {
  const bearerMatch = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  const key = req.headers['x-api-key'] || (bearerMatch ? bearerMatch[1] : null) || req.ip || 'unknown';
  const now = Date.now();
  const windowStart = now - 60_000;
  const bucket = (createRateBuckets.get(key) ?? []).filter((t) => t > windowStart);
  if (bucket.length >= CREATE_RATE_LIMIT_PER_MIN) {
    res.status(429).json({ error: 'rate_limited', message: 'Çok fazla istek, lütfen bekleyin.' });
    return false;
  }
  bucket.push(now);
  createRateBuckets.set(key, bucket);
  return true;
}

// Security MEDIUM fix — POST /tickets/:id/attachments'ta ağır (50mb) body
// parser'ı auth/rate-limit'ten ÖNCE çalışıyordu: kimliksiz bir saldırgan
// hiçbir key vermeden 50MB'a kadar gövde bufferlatabiliyordu (pre-auth DoS
// yüzeyi). connectGuard bunu Express MIDDLEWARE olarak (route'ta
// `attachmentBodyParser`'dan ÖNCE) uygular — auth/rate-limit BAŞARISIZSA
// ağır parser'a HİÇ GİRİLMEZ. checkConnectApiKey/checkCreateRateLimit zaten
// kendi response'unu yazıp `false` döndüğü için burada yalnız zincirlemek
// yeterli (aynı iki fonksiyon; kopya YOK).
function connectGuard(req, res, next) {
  if (!checkConnectApiKey(req, res)) return;
  if (!checkCreateRateLimit(req, res)) return;
  next();
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

// Bilinen hata kodu → HTTP status. Belirtilmeyen kodlar 400'e düşer (istemci
// hatası varsayımı — ScopeError/ConnectResolverError zaten hep bir istemci
// girdisi sorununu temsil eder, tek istisna univera_company_not_found:
// bu bir ALTYAPI sorunu (yanlış deploy/DB durumu), istemcinin düzeltebileceği
// bir şey değil → 500.
const CONNECT_ERROR_STATUS = {
  invalid_merkez_kod: 400,
  univera_company_not_found: 500,
  code_not_found: 422,
  code_ambiguous: 422,
};

/**
 * Dört endpoint'in (GET /tickets, GET /tickets/:id, POST /tickets, POST
 * /tickets/:id/attachments) PAYLAŞTIĞI tek hata → HTTP yanıt çevirici (kopya
 * YOK). ScopeError/ConnectResolverError → CONNECT_ERROR_STATUS ile status +
 * {error: code, message}. CaseValidationError (caseRepository.create()/
 * ingestExternalAttachment()'tan) → kendi status/code'unu taşır. NOT:
 * parseCreateTicketBody/parseAttachmentIngestBody'nin ürettiği gövde-
 * validasyonu hataları (title_too_long, unsupported_file_type, vb.) BU
 * FONKSİYONA hiç GİRMEZ — onlar throw etmeyen bir {error} return-value
 * deseniyle route'ta doğrudan 400/413'e çevrilir (kendi status'larını zaten
 * taşırlar; CONNECT_ERROR_STATUS'a taşınmaları GEREKSİZ olurdu). Bilinmeyen
 * hata → 500 + log (detay client'a sızmaz).
 */
function handleConnectApiError(res, err, logLabel) {
  if (err instanceof ScopeError || err instanceof ConnectResolverError) {
    const status = CONNECT_ERROR_STATUS[err.code] ?? 400;
    return res.status(status).json({ error: err.code, message: err.message });
  }
  if (err instanceof CaseValidationError) {
    return res.status(err.status ?? 400).json({ error: err.code, message: err.message });
  }
  console.error(`[${logLabel}]`, err);
  return res.status(500).json({ error: 'internal', message: 'Sunucu hatası' });
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
    return handleConnectApiError(res, err, 'connect-api:tickets');
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
    handleConnectApiError(res, err, 'connect-api:tickets');
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
    return handleConnectApiError(res, err, 'connect-api:ticket-detail');
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
    handleConnectApiError(res, err, 'connect-api:ticket-detail');
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /tickets — Connect'ten talep açma → yeni Varuna Case.
//
// ⚠️ PROD YAZMA YOLU — bu endpoint gerçek bir Case INSERT eder. Smoke test
// bu route'u YALNIZ create-ETMEYEN yollarla test eder (auth/400/422);
// gerçek create canlı ortamda kontrollü/manuel yapılır (bkz. dosya sonu
// MANUEL CANLI TEST yorumu + scripts/smoke-connect-tickets.mjs başlığı).
//
// ÖN KOŞUL: CaseOrigin 'Connect' değeri DB CHECK constraint'inde (CK_Case_origin)
// izinli olmalı — prisma/migrations/20260727_case_origin_connect UYGULANMADAN
// bu endpoint her istekte 500 (constraint violation) döner. Bu migration bu
// PR'da YAZILDI ama otomatik UYGULANMADI (prod şema değişikliği — kontrollü
// deploy gerekir, bkz. migration dosyası başlığı).
// ─────────────────────────────────────────────────────────────────

const MAX_TITLE_LEN = 500;
const MAX_DESCRIPTION_LEN = 20000;

/**
 * POST /tickets gövde validasyonu — tek yerde, saf fonksiyon (route'tan
 * ayrık, DB'siz test edilebilir). Throw ETMEZ — `{ error }` veya
 * `{ value }` döner; route bunu düz bir if/return ile 400'e çevirir.
 *
 * @param {unknown} body - req.body (herhangi bir şekil olabilir).
 * @returns {{ error: { status: number, code: string, message: string } } |
 *           { value: { code: string, title: string, description: string,
 *                      type: string, requestType: string,
 *                      createdByEmail: string|undefined } }}
 */
function parseCreateTicketBody(body) {
  const safeBody = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const { code, title, description, type, createdByEmail } = safeBody;

  const missing = [];
  if (typeof code !== 'string' || !code.trim()) missing.push('code');
  if (typeof title !== 'string' || !title.trim()) missing.push('title');
  if (typeof description !== 'string' || !description.trim()) missing.push('description');
  if (typeof type !== 'string' || !type.trim()) missing.push('type');
  if (missing.length) {
    return {
      error: { status: 400, code: 'missing_param', message: `Zorunlu alan(lar) eksik: ${missing.join(', ')}` },
    };
  }

  if (title.trim().length > MAX_TITLE_LEN) {
    return {
      error: { status: 400, code: 'title_too_long', message: `'title' en fazla ${MAX_TITLE_LEN} karakter olabilir.` },
    };
  }
  if (description.trim().length > MAX_DESCRIPTION_LEN) {
    return {
      error: {
        status: 400,
        code: 'description_too_long',
        message: `'description' en fazla ${MAX_DESCRIPTION_LEN} karakter olabilir.`,
      },
    };
  }
  if (createdByEmail !== undefined && createdByEmail !== null && typeof createdByEmail !== 'string') {
    return { error: { status: 400, code: 'invalid_param', message: "'createdByEmail' string olmalı." } };
  }

  const requestType = mapConnectTypeToRequestType(type);
  if (!requestType) {
    return {
      error: {
        status: 400,
        code: 'invalid_type',
        message: `Bilinmeyen 'type': ${type}. Beklenen: Soru, Talep, Öneri, Şikayet, Hata.`,
      },
    };
  }

  return {
    value: {
      code,
      title: title.trim(),
      description: description.trim(),
      type,
      requestType,
      createdByEmail: typeof createdByEmail === 'string' ? createdByEmail.trim() : undefined,
    },
  };
}

router.post('/tickets', async (req, res) => {
  if (!checkConnectApiKey(req, res)) return;
  if (!checkCreateRateLimit(req, res)) return;

  const parsed = parseCreateTicketBody(req.body);
  if (parsed.error) {
    return res.status(parsed.error.status).json({ error: parsed.error.code, message: parsed.error.message });
  }
  const { code, title, description, type, requestType, createdByEmail } = parsed.value;

  let project;
  try {
    // KARAR: code ZORUNLU + TEKİL eşleşme. 0/>1 → 422 (fail-closed) —
    // handleConnectApiError CONNECT_ERROR_STATUS ile map'ler.
    project = await resolveSingleProjectByCode(code);
  } catch (err) {
    return handleConnectApiError(res, err, 'connect-api:create-ticket');
  }

  try {
    const created = await createConnectCase({ project, title, description, requestType, createdByEmail });
    // Audit log — API key/istek gövdesi (title/description PII olabilir)
    // ASLA loglanmaz; yalnız kod/tip/üretilen vaka no.
    console.log('[connect-api:create-ticket] audit', {
      code,
      type,
      caseNumber: created.caseNumber,
      accountProjectId: project.accountProjectId,
    });
    // created.status caseRepository.create()'in shape()'inden (fromDb) TR
    // label olarak gelir (örn. "Açık") — Connect görünüm sözlüğüne çevirmeden
    // önce ASCII'ye (trStatusLabelToAscii) dönülür, aynen history mapping'i gibi.
    res.status(201).json({
      id: created.caseNumber,
      status: toConnectStatus(trStatusLabelToAscii(created.status)),
    });
  } catch (err) {
    handleConnectApiError(res, err, 'connect-api:create-ticket');
  }
});

// MANUEL CANLI TEST (bu dosyanın smoke script'i PROD'a create YAPMAZ —
// gerçek INSERT'i kontrollü/tek-seferlik olarak elle çalıştırın):
//
//   curl -s -X POST "http://localhost:3101/api/connect/tickets" \
//     -H "x-api-key: <gercek-key>" -H "Content-Type: application/json" \
//     -d '{
//       "code": "10005",
//       "title": "[CONNECT-TEST] deneme talebi",
//       "description": "[CONNECT-TEST] smoke sonrası silinecek/arşivlenecek.",
//       "type": "Talep",
//       "createdByEmail": "test@example.com"
//     }' | jq .
//
//   Test SONRASI: dönen `id` (caseNumber, örn. "UNV-1000123") ile Case'i
//   SystemAdmin panelinden arşivleyin (soft-archive — PR-SD, hard delete
//   YOK) VEYA bilinçli olarak "[CONNECT-TEST]" prefix'li vakaları ayrı
//   temizlik script'iyle işaretleyin. code_ambiguous/code_not_found
//   senaryosu için: code='10005' yerine hiç var olmayan bir kod (422
//   code_not_found) ya da (varsa) birden fazla AccountProject'e düşen bir
//   kod (422 code_ambiguous) deneyin.

// ─────────────────────────────────────────────────────────────────
// POST /tickets/:id/attachments — Connect'ten dosya ekleme (server-to-server,
// base64 gövde).
//
// ⚠️ PROD YAZMA YOLU — bu endpoint gerçek bir CaseAttachment INSERT eder +
// storage'a dosya yazar. Smoke test bu route'u YALNIZ yazma-ETMEYEN yollarla
// test eder (auth/scope-404/gövde-validasyonu); ingestExternalAttachment'ın
// gerçek DB/storage çağrıları smoke'ta STUB'lanır (bkz. dosya sonu MANUEL
// CANLI TEST yorumu + scripts/smoke-connect-tickets.mjs başlığı).
//
// Body: `Content-Type: application/json`, global 2mb body-parser limitini
// AŞMASI beklenen (base64 + çoklu dosya) bir JSON — bu route KENDİ
// (daha büyük limitli) express.json parser'ını kullanır; server/app.js bu
// path'i global 2mb parser'dan MUAF TUTAR (bkz. app.js yorumu).
// ─────────────────────────────────────────────────────────────────

// 50mb — MAX_ATTACHMENT_TOTAL_BYTES (25MB decoded) base64'te ~33.3MB'a
// şişer; JSON yapısal ek yükü + güvenlik payı ile 50mb'a yuvarlandı. Bu
// yalnız parser'ın PARSE ETMEYİ REDDETMEYECEĞİ üst sınır — asıl semantik
// cap'ler (dosya başı/istek toplamı) parseAttachmentIngestBody'de.
//
// GÜVENLİK (route sırası önemli): bu parser route'a `connectGuard`'DAN
// SONRA takılır (bkz. router.post çağrısı altta) — auth/rate-limit
// BAŞARISIZSA bu (ağır) parser'a HİÇ GİRİLMEZ. Önceki sürümde bu parser
// auth'tan ÖNCE çalışıyordu: kimliksiz bir istemci hiç key vermeden 50MB'a
// kadar gövde bufferlatabiliyordu (pre-auth DoS — security MEDIUM bulgusu).
const attachmentBodyParser = json({ limit: '50mb' });

// Tek istekte en fazla kaç dosya — "bir veya çok" ama sınırsız değil.
const MAX_FILES_PER_REQUEST = 5;
// İstek başına TOPLAM decode edilmiş boyut cap'i (birden fazla dosya
// toplamı) — tek dosya cap'i CONNECT_ATTACHMENT_MAX_FILE_BYTES'tan
// (server/db/caseRepository.js — TEK KAYNAK, audit nit) bağımsız ikinci
// bir DoS/kötüye-kullanım tavanı.
const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

// Boşluk/satır sonu (yaygın MIME-stili 76-karakter satır kırma) tolere
// edilir, ama içerik saf base64 alfabesi + padding olmalı.
const BASE64_SHAPE_RX = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * POST /tickets/:id/attachments gövde validasyonu — tek yerde, saf
 * fonksiyon (route'tan ayrık, DB'siz test edilebilir). parseCreateTicketBody
 * ile AYNI desen: throw ETMEZ, `{ error }` veya `{ value }` döner.
 *
 * @param {unknown} body - req.body. Beklenen şekil:
 *   `{ files: [{ fileName, mimeType, contentBase64 }, ...] }`.
 * @returns {{ error: { status: number, code: string, message: string } } |
 *           { value: Array<{ fileName: string, mimeType: string, buffer: Buffer }> }}
 */
function parseAttachmentIngestBody(body) {
  const safeBody = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const files = safeBody.files;

  if (!Array.isArray(files) || files.length === 0) {
    return { error: { status: 400, code: 'missing_param', message: "'files' zorunlu ve boş olmayan bir dizi olmalı." } };
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return {
      error: {
        status: 400,
        code: 'too_many_files',
        message: `Tek istekte en fazla ${MAX_FILES_PER_REQUEST} dosya gönderilebilir (gelen: ${files.length}).`,
      },
    };
  }

  const parsed = [];
  let totalBytes = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i] && typeof files[i] === 'object' ? files[i] : {};
    const { fileName, mimeType, contentBase64 } = f;

    if (typeof fileName !== 'string' || !fileName.trim()) {
      return { error: { status: 400, code: 'missing_param', message: `files[${i}].fileName zorunlu.` } };
    }
    if (typeof mimeType !== 'string' || !mimeType.trim()) {
      return { error: { status: 400, code: 'missing_param', message: `files[${i}].mimeType zorunlu.` } };
    }
    if (typeof contentBase64 !== 'string' || !contentBase64.trim()) {
      return { error: { status: 400, code: 'missing_param', message: `files[${i}].contentBase64 zorunlu.` } };
    }

    // Tip whitelist — server/lib/uploadWhitelist.js::isAcceptedUpload
    // (browser upload akışıyla AYNI fonksiyon, ayrı bir liste DUPLICATE
    // edilmedi). ingestExternalAttachment BUNU TEKRAR kontrol eder
    // (defense-in-depth, finalizeUpload'un requestUpload sonrası tekrar
    // kontrolüyle AYNI desen) — burada erken 400 için.
    if (!isAcceptedUpload(mimeType, fileName)) {
      return {
        error: {
          status: 400,
          code: 'unsupported_file_type',
          message: `files[${i}] — desteklenmeyen dosya türü (${mimeType || fileName}).`,
        },
      };
    }

    const stripped = contentBase64.replace(/\s+/g, '');
    if (!BASE64_SHAPE_RX.test(stripped) || stripped.length % 4 !== 0) {
      return {
        error: { status: 400, code: 'invalid_base64', message: `files[${i}].contentBase64 geçerli bir base64 değil.` },
      };
    }
    const buffer = Buffer.from(stripped, 'base64');
    if (buffer.length === 0) {
      return {
        error: { status: 400, code: 'invalid_base64', message: `files[${i}].contentBase64 decode edilince boş çıktı.` },
      };
    }
    if (buffer.length > CONNECT_ATTACHMENT_MAX_FILE_BYTES) {
      return {
        error: {
          status: 413,
          code: 'file_too_large',
          message: `files[${i}] boyutu üst sınırı aşıyor (max ${Math.round(CONNECT_ATTACHMENT_MAX_FILE_BYTES / (1024 * 1024))}MB, gelen ~${Math.round(buffer.length / (1024 * 1024))}MB).`,
        },
      };
    }

    totalBytes += buffer.length;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      return {
        error: {
          status: 413,
          code: 'request_too_large',
          message: `İstek toplam dosya boyutu üst sınırı aşıyor (max ${Math.round(MAX_ATTACHMENT_TOTAL_BYTES / (1024 * 1024))}MB).`,
        },
      };
    }

    parsed.push({ fileName: fileName.trim(), mimeType: mimeType.trim(), buffer });
  }

  return { value: parsed };
}

router.post('/tickets/:id/attachments', connectGuard, attachmentBodyParser, async (req, res) => {
  const { scope, code, codes: codesParam } = req.query;
  const caseNumber = req.params.id;

  let authorizedCodes;
  try {
    authorizedCodes = await resolveScopeCodes({ scope, code, codesParam });
  } catch (err) {
    return handleConnectApiError(res, err, 'connect-api:attachments');
  }

  const parsed = parseAttachmentIngestBody(req.body);
  if (parsed.error) {
    return res.status(parsed.error.status).json({ error: parsed.error.code, message: parsed.error.message });
  }

  let resolvedCase;
  try {
    resolvedCase = await resolveAuthorizedCaseId(caseNumber, authorizedCodes);
  } catch (err) {
    return handleConnectApiError(res, err, 'connect-api:attachments');
  }
  if (!resolvedCase) {
    // Case yok VEYA çağıranın yetkili kod setinde değil — GET /tickets/:id
    // ile AYNI 404 (IDOR kapatma, varlık sızdırma yok).
    return res.status(404).json({ error: 'not_found' });
  }

  // QA concern fix — kısmi başarısızlık artık SESSİZCE kaybolmaz. Tüm tip/
  // boyut/sayı validasyonu zaten parseAttachmentIngestBody'de ÖN-yapıldığı
  // için buradaki bir hata SADECE altyapı kaynaklı olabilir (storage/DB) —
  // ama yine de olabilir (disk dolu, DB bağlantı sorunu, repo-katmanı
  // CASE_FILE_MAX_COUNT'un tam bu sırada dolması vb.). SIRAYLA (paralel
  // DEĞİL) işlenir — ingestExternalAttachment'ın kendi CASE_FILE_MAX_COUNT
  // kontrolü her çağrıda güncel sayıyı okur; paralel çağrılar eski sayıyı
  // görüp cap'i aşabilirdi. İlk hatada döngü DURUR; o ana kadar başarıyla
  // eklenmiş dosyalar `ingested[]`'te GERİ ALINMADAN response'a dahil edilir
  // — Connect hangi dosyanın gerçekten eklendiğini görür, kör-retry (ve
  // olası duplicate) yapmaz.
  const ingested = [];
  let failure = null;
  for (const f of parsed.value) {
    try {
      const file = await caseRepository.ingestExternalAttachment(resolvedCase.id, {
        fileName: f.fileName,
        mimeType: f.mimeType,
        buffer: f.buffer,
        uploadedByLabel: CONNECT_ACTOR_DISPLAY_NAME,
        authorizedCodes, // repo-katmanı defense-in-depth simetrisi (audit nit)
      });
      if (!file) {
        // Repo-katmanı IDOR re-check'i reddetti (normalde asla olmaz — route
        // zaten resolveAuthorizedCaseId'den geçti) — 404 ile aynı aileden.
        throw new CaseValidationError('Vaka artık erişilebilir değil.', { status: 404, code: 'not_found' });
      }
      ingested.push({
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        // GET detay ile AYNI HMAC download URL üreticisi (createDownloadUrl) —
        // içerik gömme YOK, yalnız kısa ömürlü capability URL.
        downloadUrl: createDownloadUrl(resolvedCase.id, file.id, file.fileUrl, file.fileName, undefined, file.mimeType),
      });
    } catch (err) {
      failure = { fileName: f.fileName, err };
      break;
    }
  }

  const auditBase = {
    scope,
    ...(scope === 'merkez' ? { code } : {}),
    ...(scope === 'codes' ? { codesCount: authorizedCodes.length } : {}),
    caseNumber,
    ingestedCount: ingested.length,
  };

  if (failure) {
    const isKnownValidationError = failure.err instanceof CaseValidationError;
    const status = isKnownValidationError ? (failure.err.status ?? 400) : 500;
    const errorCode = isKnownValidationError ? failure.err.code : 'internal';
    const errorMessage = isKnownValidationError ? failure.err.message : 'Sunucu hatası';
    if (!isKnownValidationError) {
      console.error('[connect-api:attachments]', failure.err);
    }
    console.log('[connect-api:attachments] audit (kısmi başarısızlık)', {
      ...auditBase,
      failedFileName: failure.fileName,
      failedError: errorCode,
    });
    return res.status(status).json({
      ingested,
      failed: { fileName: failure.fileName, error: errorCode, message: errorMessage },
    });
  }

  console.log('[connect-api:attachments] audit', auditBase);
  res.status(201).json({ ingested });
});

// MANUEL CANLI TEST (bu dosyanın smoke script'i PROD'a create/upload
// YAPMAZ — gerçek yüklemeyi kontrollü/tek-seferlik olarak elle çalıştırın):
//
//   # 1) küçük bir test dosyasını base64'e çevir:
//   base64 -i test.txt | tr -d '\n' > /tmp/test.b64
//   # 2) gönder (aynı OLD_/UNV_ caseNumber + doğru merkez/codes scope'u ile):
//   curl -s -X POST "http://localhost:3101/api/connect/tickets/OLD_123456/attachments?scope=merkez&code=198" \
//     -H "x-api-key: <gercek-key>" -H "Content-Type: application/json" \
//     -d "{\"files\":[{\"fileName\":\"[CONNECT-TEST]-deneme.txt\",\"mimeType\":\"text/plain\",\"contentBase64\":\"$(cat /tmp/test.b64)\"}]}" | jq .
//
//   Test SONRASI: dönen `items[].id` (CaseAttachment.id) ile eki Varuna
//   UI'ından (Case detay → Dosyalar) silin — CaseAttachment.delete zaten
//   storage'daki dosyayı da temizler (bkz. caseRepository.js dosya silme
//   akışı, removeObject).

export default router;
