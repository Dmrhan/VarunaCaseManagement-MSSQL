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
 *   - Belge: PDF, Word (.doc/.docx/.dot), Excel, PowerPoint
 *   - Görsel: PNG, JPEG, GIF, WebP, SVG
 *   - Metin: TXT, CSV, JSON, XML
 *   - Arşiv: ZIP, RAR
 *   - Video: .mov (video/quicktime)
 *   - SQLite: .s3db (UNV-1001065 — gerçek mail eki/manuel upload olarak
 *     gelirse kabul edilir; application/octet-stream GENEL olarak
 *     serbest bırakılmaz, sadece .s3db ile birlikte geldiğinde dar bir
 *     istisnayla kabul edilir — bkz. isAcceptedUpload())
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
  'application/vnd.rar',
  'application/x-rar-compressed', // eski/yaygın tarayıcı-OS eşlemesi
  // SQLite (.s3db) — UNV-1001065 karari. application/octet-stream
  // buraya BILEREK eklenmedi, detay yukaridaki docblock icinde.
  'application/vnd.sqlite3',
  'application/x-sqlite3',
  // Video
  'video/quicktime',
];

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
];

/**
 * Codex P2 (PR #468 review) — sıkı kural: MIME ve uzantı ikisi de
 * varsa İKİSİ DE kabul listesinde olmalı. Aksi halde forge edilebilir
 * pattern (örn. `malware.exe` + `application/pdf`) bypass yapardı.
 *
 *   - Sadece MIME var (uzantı yok) → MIME listede ise kabul
 *   - Sadece uzantı var (MIME yok/bilinmeyen) → uzantı listede ise kabul
 *     (tarayıcı tutarsızlığına tolerant; örn. Safari xlsx için boş MIME)
 *   - İkisi de var → ikisi de listede olmalı
 *   - İkisi de yok → reject
 */
export function isAcceptedUpload(mimeType, fileName) {
  const mime = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  const name = typeof fileName === 'string' ? fileName.toLowerCase() : '';
  const dotIdx = name.lastIndexOf('.');
  const ext = dotIdx >= 0 ? name.slice(dotIdx) : '';

  // .s3db (SQLite) özel istisnası — tarayıcı/mail istemcisi bilinmeyen
  // ikili dosyalar için çoğunlukla application/octet-stream döner.
  // application/octet-stream'i UPLOAD_ALLOWED_MIME_TYPES'a GENEL olarak
  // eklemek yerine, sadece uzantı KESİNLİKLE .s3db ise bu kombinasyonu
  // kabul ediyoruz — böylece octet-stream hiçbir zaman genel bir
  // "güvenli MIME" sayılmaz (forge guard'ı zayıflamaz).
  if (mime === 'application/octet-stream' && ext === '.s3db') {
    return true;
  }

  const hasMime = mime.length > 0;
  const hasExt = ext.length > 0;
  const mimeOk = hasMime && UPLOAD_ALLOWED_MIME_TYPES.includes(mime);
  const extOk = hasExt && UPLOAD_ALLOWED_EXTENSIONS.includes(ext);

  if (hasMime && hasExt) {
    // İkisi de sağlandıysa ikisi de listede olmalı (forge önleme).
    return mimeOk && extOk;
  }
  if (hasMime) return mimeOk;
  if (hasExt) return extOk;
  return false;
}
