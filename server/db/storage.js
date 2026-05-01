import { createClient } from '@supabase/supabase-js';

/**
 * Supabase Storage helper — vaka eklerini bucket'a koyar.
 *
 * Mimari:
 *  - Frontend dosyayı doğrudan Supabase'e yükler (Vercel 4.5MB body limitini bypass)
 *  - BFF sadece signed upload URL üretir (kısa ömürlü, single-use)
 *  - Download da signed URL ile (private bucket — direkt link yok)
 *
 * MSSQL geçişinde bu modül opsiyonel: file storage için MinIO, S3, Azure Blob,
 * ya da disk veri tabanı sütunu seçilebilir. CaseAttachment.fileUrl alanı
 * zaten storage-agnostik string.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'case-attachments';

let _client = null;
let _bucketEnsured = false;

function getClient() {
  if (_client) return _client;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new StorageError(
      'Supabase Storage yapılandırılmamış (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY .env\'de yok).',
      503,
    );
  }
  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return _client;
}

/** Bucket var mı? Yoksa private olarak oluştur. Idempotent. */
async function ensureBucket() {
  if (_bucketEnsured) return;
  const sb = getClient();
  const { data: list, error: listErr } = await sb.storage.listBuckets();
  if (listErr) throw new StorageError(`Bucket listesi okunamadı: ${listErr.message}`);
  const exists = list?.some((b) => b.name === BUCKET);
  if (!exists) {
    const { error: createErr } = await sb.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 25 * 1024 * 1024, // 25 MB
    });
    if (createErr && !/already exists/i.test(createErr.message)) {
      throw new StorageError(`Bucket oluşturulamadı: ${createErr.message}`);
    }
    console.log(`[storage] '${BUCKET}' bucket'ı oluşturuldu (private, 25MB).`);
  }
  _bucketEnsured = true;
}

/** Vaka için path: cases/{caseId}/{attachmentId}-{safeName} */
function buildPath(caseId, attachmentId, fileName) {
  // Türkçe karakterler ve özel chars'lar dosya adında sorun yaratmasın diye sade.
  const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(0, 120);
  return `cases/${caseId}/${attachmentId}-${safe}`;
}

/** 60 saniye geçerli signed upload URL — frontend buna PUT eder. */
export async function createUploadUrl(caseId, attachmentId, fileName) {
  await ensureBucket();
  const sb = getClient();
  const path = buildPath(caseId, attachmentId, fileName);
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new StorageError(`Upload URL oluşturulamadı: ${error.message}`);
  return { signedUrl: data.signedUrl, path, token: data.token };
}

/** İndirme için 5 dakika geçerli signed URL. */
export async function createDownloadUrl(path, expiresInSec = 300) {
  await ensureBucket();
  const sb = getClient();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, expiresInSec);
  if (error) throw new StorageError(`İndirme URL'si oluşturulamadı: ${error.message}`);
  return data.signedUrl;
}

/** Dosya silindiğinde Storage'dan da temizle. */
export async function removeObject(path) {
  if (!path) return;
  await ensureBucket();
  const sb = getClient();
  const { error } = await sb.storage.from(BUCKET).remove([path]);
  if (error) {
    // Silinemezse log + devam — orphan dosya kalsa kabul edilebilir, vaka silinsin
    console.warn(`[storage] Dosya silinemedi (${path}):`, error.message);
  }
}

export class StorageError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

export const STORAGE_BUCKET = BUCKET;
