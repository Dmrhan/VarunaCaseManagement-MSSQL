/**
 * Upload MIME + extension whitelist — frontend mirror (PR-7).
 *
 * Business review Madde 6 — Dosta XML upload kontrolü.
 *
 * Backend `server/lib/uploadWhitelist.js` ile **birebir senkron**
 * tutulmalı; smoke `smoke-upload-whitelist-sync.js` iki listeyi
 * karşılaştırır. Frontend listesi yalnız pre-validation amaçlı (UX);
 * backend kararı kesin koruma sağlar (eski yüklenmiş dosyalar
 * etkilenmez, yalnız yeni upload check).
 */

export const UPLOAD_ALLOWED_MIME_TYPES = [
  // Belge
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Görsel
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Metin
  'text/plain',
  'text/csv',
  'application/csv',
  'application/json',
  // XML — Business review Madde 6 explicit kabul
  'application/xml',
  'text/xml',
  // XSLT (.xslt/.xsl) — 2026-07-09 iş talebi (mail eki + case dosyası).
  // Salt saklama/indirme; sunucu tarafında transform ÇALIŞTIRILMAZ.
  'application/xslt+xml',
  // E-posta (.eml) — 2026-07-09 iş talebi. RFC 822 mesaj dosyası; render
  // edilmez, ek olarak saklanır/indirilir.
  'message/rfc822',
  // SQL script (.sql) — 2026-07-09 iş talebi. Tarayıcılar çoğunlukla
  // text/plain veya boş MIME yollar (uzantı fallback yakalar).
  'application/sql',
  'text/x-sql',
  // Arşiv
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed', // eski/yaygın tarayıcı-OS eşlemesi
  // SQLite (.s3db) — UNV-1001065 karari. application/octet-stream
  // buraya BILEREK eklenmedi, backend dosyasindaki docblock ile ayni.
  'application/vnd.sqlite3',
  'application/x-sqlite3',
  // Video
  'video/quicktime',
  // 2026-07-17 iş talebi (UNV-1000994 sahadan gelen mp4 eki) — boyut
  // sınırı (25MB) BİLEREK yükseltilmedi; sadece tip kabulü genişletildi.
  'video/mp4',
] as const;

export const UPLOAD_ALLOWED_EXTENSIONS = [
  // Belge
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.dot', // eski Word sablonu, application/msword ile ayni MIME
  // Görsel
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  // Metin
  '.txt', '.csv', '.json',
  // XML — Business review Madde 6 explicit kabul
  '.xml',
  // XSLT — 2026-07-09 iş talebi (.xsl eski/eşdeğer uzantı, aynı içerik)
  '.xslt', '.xsl',
  // E-posta — 2026-07-09 iş talebi
  '.eml',
  // SQL script — 2026-07-09 iş talebi
  '.sql',
  // Arşiv
  '.zip',
  '.rar',
  // SQLite
  '.s3db',
  // Video
  '.mov',
  '.mp4',
] as const;

/**
 * Codex P2 (PR #468 review) — sıkı kural: MIME ve uzantı ikisi de
 * varsa İKİSİ DE kabul listesinde olmalı (forge önleme). Davranış
 * backend `server/lib/uploadWhitelist.js` ile birebir aynı.
 */
export function isAcceptedUpload(mimeType: string | undefined, fileName: string | undefined): boolean {
  const mime = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  const name = typeof fileName === 'string' ? fileName.toLowerCase() : '';
  const dotIdx = name.lastIndexOf('.');
  const ext = dotIdx >= 0 ? name.slice(dotIdx) : '';

  // application/octet-stream DAR istisna seti — backend ile birebir aynı
  // (bkz. server/lib/uploadWhitelist.js). Tarayıcı MIME eşlemesi olmayan
  // tiplerde File.type boş gelir; caseService bunu octet-stream'e çevirir
  // (Codex #506 P2) → uzantı fallback'i devreye giremezdi. octet-stream
  // GENEL olarak listeye eklenmez, yalnız bu uzantılarla kabul.
  const OCTET_STREAM_EXT_EXCEPTIONS = ['.s3db', '.sql', '.xslt', '.xsl', '.eml'];
  if (mime === 'application/octet-stream' && OCTET_STREAM_EXT_EXCEPTIONS.includes(ext)) {
    return true;
  }

  const hasMime = mime.length > 0;
  const hasExt = ext.length > 0;
  const mimeOk = hasMime && (UPLOAD_ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
  const extOk = hasExt && (UPLOAD_ALLOWED_EXTENSIONS as readonly string[]).includes(ext);

  if (hasMime && hasExt) return mimeOk && extOk;
  if (hasMime) return mimeOk;
  if (hasExt) return extOk;
  return false;
}
