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
  // Arşiv
  '.zip',
  '.rar',
  // SQLite
  '.s3db',
  // Video
  '.mov',
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

  // .s3db (SQLite) özel istisnası — backend ile birebir aynı (bkz.
  // server/lib/uploadWhitelist.js). application/octet-stream GENEL
  // olarak listeye eklenmez, sadece .s3db ile birlikte geldiğinde kabul.
  if (mime === 'application/octet-stream' && ext === '.s3db') {
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
