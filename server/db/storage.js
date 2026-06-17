import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Local disk storage helper (Faz 4) — Supabase Storage'ın yerini aldı.
 *
 * Mimari (eski signed-URL akışının disk karşılığı):
 *  - requestUpload yine bir "signed URL" döner; artık bu, kısa ömürlü HMAC
 *    token'lı bir BFF endpoint'idir: PUT /api/cases/:id/files/upload?token=...
 *    Token path+caseId+exp taşır — client path'i KURCALAYAMAZ (traversal yok).
 *  - Download da aynı desenle: GET .../raw?token=... (tarayıcı <a> tıklaması
 *    Authorization header taşıyamadığı için token query'dedir).
 *  - Dosyalar STORAGE_ROOT altında `cases/{caseId}/{attachmentId}-{safeName}`
 *    yapısında saklanır. CaseAttachment.fileUrl bu göreli path'i tutar
 *    (storage-agnostik string — eski tasarım korunur).
 *
 * Env:
 *  - STORAGE_ROOT: mutlak ya da repo-göreli dizin (default: ./data/attachments)
 *  - Token imzası JWT_SECRET ile atılır (ayrı secret gerekmez).
 */

const STORAGE_ROOT = path.resolve(
  process.env.STORAGE_ROOT || path.join(process.cwd(), 'data', 'attachments'),
);

const UPLOAD_TOKEN_TTL_SEC = 15 * 60; // büyük dosya + yavaş ağ payı
const DOWNLOAD_TOKEN_TTL_SEC = 300;   // eski Supabase signed URL ile aynı (5 dk)

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new StorageError('JWT_SECRET tanımlı değil — storage token imzalanamıyor.', 503);
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payloadStr) {
  return crypto.createHmac('sha256', secret()).update(payloadStr).digest('base64url');
}

/** { ...payload, exp } → "base64url(json).sig" */
export function signStorageToken(payload, ttlSec) {
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  return `${body}.${sign(body)}`;
}

/** Geçerliyse payload, değilse null (süre/imza/format hatası). */
export function verifyStorageToken(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Vaka için path: cases/{caseId}/{attachmentId}-{safeName} */
function buildPath(caseId, attachmentId, fileName) {
  // Türkçe karakterler ve özel chars'lar dosya adında sorun yaratmasın diye sade.
  const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(0, 120);
  return `cases/${caseId}/${attachmentId}-${safe}`;
}

/** Göreli storage path'ini STORAGE_ROOT altına çözer; dışarı kaçışı reddeder. */
function resolveSafe(relPath) {
  const abs = path.resolve(STORAGE_ROOT, relPath);
  if (abs !== STORAGE_ROOT && !abs.startsWith(STORAGE_ROOT + path.sep)) {
    throw new StorageError('Geçersiz dosya yolu.', 400);
  }
  return abs;
}

/**
 * Upload "signed URL" üret — frontend buna PUT eder (raw body).
 * Dönen shape eski Supabase sürümüyle aynı: { signedUrl, path, token }.
 *
 * PR-4 — Upload two-step user binding: token payload'ına userId gömülür.
 * PUT endpoint'i ve finalize endpoint'i bu userId'nin req.user.id ile
 * match'ini doğrular. User A request → User B PUT/finalize attack engellenir.
 */
export async function createUploadUrl(caseId, attachmentId, fileName, userId) {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new StorageError('createUploadUrl: userId required for token binding', 500);
  }
  const relPath = buildPath(caseId, attachmentId, fileName);
  const token = signStorageToken(
    { typ: 'upload', caseId, path: relPath, userId },
    UPLOAD_TOKEN_TTL_SEC,
  );
  return {
    signedUrl: `/api/cases/${encodeURIComponent(caseId)}/files/upload?token=${encodeURIComponent(token)}`,
    path: relPath,
    token,
  };
}

/** İndirme için kısa ömürlü token'lı URL. */
export function createDownloadUrl(caseId, fileId, relPath, fileName, expiresInSec = DOWNLOAD_TOKEN_TTL_SEC) {
  const token = signStorageToken(
    { typ: 'download', caseId, fileId, path: relPath, fileName },
    expiresInSec,
  );
  return `/api/cases/${encodeURIComponent(caseId)}/files/${encodeURIComponent(fileId)}/raw?token=${encodeURIComponent(token)}`;
}

/** Upload token'ı doğrulanmış raw body'yi diske yaz. */
export async function saveObject(relPath, buffer) {
  const abs = resolveSafe(relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buffer);
}

/** Var mı + boyut (download endpoint'i Content-Length için). */
export async function statObject(relPath) {
  try {
    const abs = resolveSafe(relPath);
    const st = await fsp.stat(abs);
    return st.isFile() ? { size: st.size } : null;
  } catch {
    return null;
  }
}

/** Streaming okuma — download endpoint'i pipe eder. */
export function createObjectStream(relPath) {
  return fs.createReadStream(resolveSafe(relPath));
}

/** Dosya silindiğinde diskten de temizle. */
export async function removeObject(relPath) {
  if (!relPath) return;
  try {
    await fsp.unlink(resolveSafe(relPath));
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      // Silinemezse log + devam — orphan dosya kalsa kabul edilebilir, vaka silinsin
      console.warn(`[storage] Dosya silinemedi (${relPath}):`, err?.message ?? err);
    }
  }
}

export class StorageError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

export const STORAGE_ROOT_DIR = STORAGE_ROOT;
