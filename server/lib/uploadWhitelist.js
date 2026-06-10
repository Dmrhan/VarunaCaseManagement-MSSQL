/**
 * Upload MIME + extension whitelist (PR-7).
 *
 * Business review Madde 6 — Dosta XML upload kontrolü.
 *
 * Yaklaşım: deny-by-default. Kabul edilen MIME ve uzantı listesinde
 * en az biri eşleşmezse reddedilir. Çift kanal (MIME OR extension)
 * tarayıcı uyumsuzlukları için tolerant — örneğin Safari .xlsx için
 * bazen boş MIME döner, uzantıdan yakalanır.
 *
 * Kabul listesi:
 *   - Belge: PDF, Word, Excel, PowerPoint
 *   - Görsel: PNG, JPEG, GIF, WebP, SVG
 *   - Metin: TXT, CSV, JSON, XML
 *   - Arşiv: ZIP
 *
 * Yasaklı (deny-by-default zaten reddeder, explicit liste bilgi amaçlı):
 *   - Executable: .exe, .sh, .bat, .cmd, .ps1, .com, .scr, .msi, .dmg
 *   - Script: .js (raw upload), .php, .py, .rb, .pl, .vbs
 *   - Diğer: application/x-* (binary executables)
 *
 * **Önemli güvenlik notu:** Bu whitelist yalnız MIME/extension kontrolü
 * yapar; içerik (magic bytes) doğrulama YOK. Backend dosyaları PARSE
 * ETMEZ; XML için XXE/SSRF riski sıfır kalır. Bu kontrat değişirse
 * (örn. XML parse eden bir akış eklenirse) güvenlik incelemesi şart.
 *
 * Eski yüklenmiş dosyalar bu validasyondan etkilenmez (yalnız yeni
 * upload check). Mevcut limitler (CASE_FILE_MAX_COUNT=20,
 * CASE_FILE_MAX_SIZE=25MB) bu modüle dahil değil; caseRepository
 * tarafında ayrıca check edilir.
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
  'image/jpg', // bazı sistemler bunu döner (technically alias)
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
];

export const UPLOAD_ALLOWED_EXTENSIONS = [
  // Belge
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Görsel
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  // Metin
  '.txt', '.csv', '.json',
  // XML — Business review Madde 6 explicit kabul
  '.xml',
  // Arşiv
  '.zip',
];

/**
 * mimeType veya fileName (uzantı) listede varsa true.
 * mimeType boş/yoksa yalnız uzantı kontrolü; uzantı boş/yoksa yalnız
 * mimeType kontrolü. İkisi de boş ise reject (false).
 */
export function isAcceptedUpload(mimeType, fileName) {
  const mime = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  const name = typeof fileName === 'string' ? fileName.toLowerCase() : '';
  const dotIdx = name.lastIndexOf('.');
  const ext = dotIdx >= 0 ? name.slice(dotIdx) : '';

  const mimeOk = mime ? UPLOAD_ALLOWED_MIME_TYPES.includes(mime) : false;
  const extOk = ext ? UPLOAD_ALLOWED_EXTENSIONS.includes(ext) : false;

  // En az biri kabul listesinde ise OK (tarayıcı tutarsızlığına karşı).
  return mimeOk || extOk;
}
