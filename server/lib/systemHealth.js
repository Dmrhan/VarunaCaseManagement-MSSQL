/**
 * systemHealth.js — 2026-07-10 (Sistem Sağlığı Faz 1)
 *
 * /api/system/health'in veri toplayıcısı. YALNIZ SALT-OKUR gözlem:
 * hiçbir tabloyu yazmaz, mail gönderim/intake/bildirim akışına dokunmaz.
 * İki tüketicisi olacak:
 *   1) Zabbix HTTP-agent (60 sn'de bir çeker; eşik/ALARM Zabbix'te kurulur)
 *   2) Faz 2 Sistem Sağlığı panosu (aynı verinin insan-yüzü)
 *
 * İlkeler:
 *  - PII YOK: yalnız sayılar/yaşlar/boolean'lar. Vaka başlığı, ad, e-posta
 *    içeriği asla payload'a girmez ([[privacy]] — Zabbix'e veri sızmaz).
 *  - HIZLI ve UCUZ: tüm sorgular count/max tarzı; 20 sn in-memory cache —
 *    Zabbix + pano aynı anda sorsa da DB'ye dakikada ~3 hafif tur.
 *  - DAYANIKLI: her bölüm kendi try/catch'inde; bir bölüm hata verirse o
 *    bölüm {error} döner, kalanı sağlıklı raporlanır (kısmi görüş > körlük).
 *  - Eşik YOK: ham değer döner; kırmızı/yeşil kararı tüketicinin işi
 *    (Zabbix trigger'ları + pano). Tek istisna env bölümündeki boolean'lar.
 */
import fsp from 'node:fs/promises';
import { prisma } from '../db/client.js';
import { STORAGE_ROOT_DIR } from '../db/storage.js';
import { getCronRuns } from '../cronScheduler.js';
import { isConfigured as zabbixConfigured } from './zabbixClient.js';

const CACHE_TTL_MS = 20_000;
let cache = { at: 0, data: null };

const MIN = 60_000;

/** Bölüm sarmalayıcı — hata bölümü izole eder, payload'ı düşürmez. */
async function section(fn) {
  try {
    return await fn();
  } catch (err) {
    return { error: String(err?.message ?? err).slice(0, 160) };
  }
}

async function collectDispatch(now) {
  const [pending, oldest, failed24h] = await Promise.all([
    prisma.notificationDispatch.count({ where: { state: 'Pending' } }),
    prisma.notificationDispatch.findFirst({
      where: { state: 'Pending' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.notificationDispatch.count({
      where: { state: 'Failed', createdAt: { gte: new Date(now - 24 * 60 * MIN) } },
    }),
  ]);
  return {
    pendingCount: pending,
    oldestPendingAgeMin: oldest ? Math.round((now - oldest.createdAt.getTime()) / MIN) : 0,
    failed24h,
  };
}

async function collectMail(now) {
  const day = new Date(now - 24 * 60 * MIN);
  const [inbound24h, outbound24h, lastInbound, cases5m, activeInboxes] = await Promise.all([
    prisma.caseEmail.count({ where: { direction: 'Inbound', createdAt: { gte: day } } }),
    prisma.caseEmail.count({ where: { direction: 'Outbound', createdAt: { gte: day } } }),
    prisma.caseEmail.findFirst({
      where: { direction: 'Inbound' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    // Döngü dedektörü — 6 Temmuz olayının (auto-ack × kural → 447 vaka)
    // erken uyarı sinyali: son 5 dk'da açılan vaka sayısı. Zabbix trigger'ı
    // sürekli >15 (≈3/dk) görürse alarm çalar.
    prisma.case.count({ where: { createdAt: { gte: new Date(now - 5 * MIN) } } }),
    prisma.externalMailInbox.count({ where: { isActive: true } }),
  ]);
  return {
    inbound24h,
    outbound24h,
    // Not: "son gelen mail yaşı" mesai dışında doğal olarak büyür — Zabbix
    // eşiği bunu bilerek cömert tutulur (template'te belgelendi). Kutu-bazı
    // gerçek poll-tick izi ve dedupe sayacı Faz 2 (poller enstrümantasyonu
    // ayrı PR; CaseEmail'de deduped kolonu YOK — intake in-memory bilir).
    lastInboundAgeMin: lastInbound ? Math.round((now - lastInbound.createdAt.getTime()) / MIN) : null,
    casesCreatedLast5m: cases5m,
    activeInboxCount: activeInboxes,
    imapPollIntervalSec: Number.parseInt(process.env.MAIL_IMAP_POLL_INTERVAL_SEC ?? '0', 10) || 0,
  };
}

async function collectStorage() {
  const [emailAtt, caseAtt, stat] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*) n, ISNULL(SUM(CAST(fileSize AS BIGINT)),0) b FROM CaseEmailAttachment`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*) n, ISNULL(SUM(CAST(fileSize AS BIGINT)),0) b FROM CaseAttachment`,
    ),
    fsp.statfs(STORAGE_ROOT_DIR).catch(() => null),
  ]);
  const num = (v) => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));
  const out = {
    emailAttachmentCount: num(emailAtt?.[0]?.n),
    emailAttachmentBytes: num(emailAtt?.[0]?.b),
    caseAttachmentCount: num(caseAtt?.[0]?.n),
    caseAttachmentBytes: num(caseAtt?.[0]?.b),
  };
  if (stat) {
    // statfs: bsize × blocks/bavail. STORAGE_ROOT diskinin gerçek doluluğu —
    // Zabbix host item'ı da aynı diski ölçer; burada olması pano/alarmın
    // Zabbix'e ulaşamadığı anda bile disk görüşü kalmasını sağlar.
    out.diskTotalBytes = Number(stat.bsize) * Number(stat.blocks);
    out.diskFreeBytes = Number(stat.bsize) * Number(stat.bavail);
    out.diskFreePct = out.diskTotalBytes > 0
      ? Math.round((out.diskFreeBytes / out.diskTotalBytes) * 1000) / 10
      : null;
  } else {
    out.diskTotalBytes = null;
    out.diskFreeBytes = null;
    out.diskFreePct = null;
  }
  return out;
}

async function collectDb() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT type, CAST(SUM(size)*8.0/1024 AS DECIMAL(12,1)) mb FROM sys.database_files GROUP BY type`,
  );
  const byType = {};
  for (const r of rows ?? []) byType[Number(r.type)] = Number(r.mb);
  const [caseCount, emailCount] = await Promise.all([
    prisma.case.count(),
    prisma.caseEmail.count(),
  ]);
  return {
    dataFileMb: byType[0] ?? null,
    logFileMb: byType[1] ?? null,
    caseCount,
    caseEmailCount: emailCount,
  };
}

async function collectEnv() {
  let storageWritable = false;
  try {
    await fsp.access(STORAGE_ROOT_DIR, fsp.constants?.W_OK ?? 2);
    storageWritable = true;
  } catch { /* yazılamaz */ }
  return {
    appPublicBaseUrlSet: Boolean(process.env.APP_PUBLIC_BASE_URL),
    imapPollingEnabled: (Number.parseInt(process.env.MAIL_IMAP_POLL_INTERVAL_SEC ?? '0', 10) || 0) > 0,
    storageRootWritable: storageWritable,
    zabbixConfigured: zabbixConfigured(),
  };
}

function collectProcess(now) {
  const mem = process.memoryUsage();
  return {
    uptimeSec: Math.round(process.uptime()),
    memoryRssMb: Math.round(mem.rss / 1048576),
    nodeVersion: process.version,
    serverTimeUtc: new Date(now).toISOString(),
  };
}

/**
 * Sağlık payload'ı (20 sn cache). Şekil sözleşmesi Zabbix template'i ile
 * senkron — alan adı değişikliği template güncellemesi GEREKTİRİR
 * (docs/integrations/zabbix/README.md).
 */
export async function collectHealth() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_TTL_MS) return cache.data;

  // Bölümler BİLEREK sıralı: hepsi paralel koşunca ~14 eşzamanlı sorgu
  // bağlantı havuzunu (17) tek başına işgal ediyor — canlı trafikle
  // yarışır, VPN/uzak-DB'de pool timeout üretir (smoke'ta kanıtlandı).
  // Sıralıda en geniş an tek bölümün iç Promise.all'ı (≤5); toplam süre
  // yine <1 sn ve endpoint 20 sn cache'li.
  //
  // Havuz ısıtma: ilk bölümün paraleli soğuk bağlantı kurulumuna denk
  // gelirse (uzak DB/VPN) pool-timeout'a düşebiliyor — önce TEK hafif
  // sorguyla bağlantıyı kur, sonra bölümlere gir.
  await section(() => prisma.$queryRawUnsafe('SELECT 1 AS ok'));
  const dispatch = await section(() => collectDispatch(now));
  const mail = await section(() => collectMail(now));
  const storage = await section(() => collectStorage());
  const db = await section(() => collectDb());
  const env = await section(() => collectEnv());

  const data = {
    schemaVersion: 1,
    process: collectProcess(now),
    dispatch,
    mail,
    storage,
    db,
    crons: getCronRuns(),
    env,
  };
  cache = { at: now, data };
  return data;
}

/** Test yardımcı — smoke cache'i sıfırlayıp taze okuma alabilsin. */
export function _resetHealthCacheForTests() { cache = { at: 0, data: null }; }
