import { Router } from 'express';
import { prisma } from '../db/client.js';
import { verifyJwt, requireRole } from '../db/auth.js';

/**
 * /api/monitoring/* — İZOLE, SALT-OKUMA raporlama/monitoring API'si.
 *
 * Ticket yaşam döngüsü funnel'ı (açılan → L2'ye devir → yazılıma açılan →
 * kodlandı / kodlanmadan döndü) + drill-down (KeyAccount → Proje → Dist) +
 * zaman serisi. Kaynak: dbo.vw_TicketLifecycle_All (canlı Varuna + geçmiş
 * next4biz, tek şema). Prisma modellerine / caseRepository'ye DOKUNMAZ —
 * yalnızca view'e SELECT atar.
 *
 * Erişim: yönetici tier (Supervisor/Admin/SystemAdmin). Tümü verifyJwt arkasında.
 * Güvenlik: girdiler katı doğrulanır; serbest-metin filtreler tek-tırnak
 * escape'lenir (salt-okuma SELECT; injection'a kapalı).
 */
const router = Router();
router.use(verifyJwt);
const requireManager = requireRole('Supervisor', 'Admin', 'SystemAdmin');

// Materialize snapshot (perf) — canlı view her sorguda linked-server(TFS)+cross-DB(KA)
// join'i tekrarladığı için 30-40sn sürüyordu; bu fiziksel indeksli tablo milisaniye.
// Yenileme: dbo.usp_Refresh_rpt_TicketLifecycle (gecelik SQL Agent job).
const VIEW = 'dbo.rpt_TicketLifecycle';

// Funnel metrikleri — her endpoint aynı tanımı kullanır (bit → int cast, SUM için)
const METRICS = `
  COUNT(*) AS acilan,
  SUM(CAST(UlastiL2 AS int)) AS l2ye,
  SUM(CAST(YazilimaAcildi AS int)) AS yazilima,
  SUM(CAST(Kodlandi AS int)) AS kodlandi,
  SUM(CAST(KodlanmadanDondu AS int)) AS geriDondu,
  SUM(CASE WHEN Tipi = N'Hata' AND UlastiL2 = 1 THEN 1 ELSE 0 END) AS hataL2`;

const TIPI = new Set(['Hata', 'Talep', 'Bilgi', 'Soru', 'Öneri', 'Şikayet', 'Diğer']);
const KAYNAK = new Set(['Canlı (Varuna)', 'Geçmiş (next4biz)']);
// Güvenli grupla-boyutları: dışarıdan gelen değer YALNIZ bu haritadan kolon adına çevrilir
const DIMENSIONS = {
  Proje: 'Proje', Dist: 'Dist', KokNeden: 'KokNeden', Tipi: 'Tipi',
  KeyAccount: 'KeyAccount', Durum: 'Durum', Takim: 'Takim',
  Kaynak: 'Kaynak', KodlamaSonucu: 'KodlamaSonucu', DestekSeviyesi: 'DestekSeviyesi',
};
const GRAINS = {
  day:   { sel: `CONVERT(varchar(10), AcilisGun, 23)`,                                    grp: 'AcilisGun',  ord: 'AcilisGun' },
  week:  { sel: `CONCAT(Yil, '-H', RIGHT('0' + CAST(Hafta AS varchar(2)), 2))`,           grp: 'Yil, Hafta', ord: 'Yil, Hafta' },
  month: { sel: `CONCAT(Yil, '-', RIGHT('0' + CAST(Ay AS varchar(2)), 2))`,               grp: 'Yil, Ay',    ord: 'Yil, Ay' },
  year:  { sel: `CAST(Yil AS varchar(4))`,                                                grp: 'Yil',        ord: 'Yil' },
};

const esc = (s) => `N'${String(s).replace(/'/g, "''")}'`;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
const serialize = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, num(v)]));

/**
 * Filtre WHERE'i kurar. Tarih verilmezse — istenmeyen tam-tablo (500K+) taramasını
 * önlemek için — VARSAYILAN son 12 ay. `all=1` ile tüm geçmiş açılır.
 */
function buildWhere(qp) {
  const w = [`Sirket = N'UNIVERA'`];
  const hasFrom = isDate(qp.from);
  if (hasFrom) w.push(`AcilisTarihi >= ${esc(qp.from)}`);
  else if (qp.all !== '1') {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    w.push(`AcilisTarihi >= ${esc(d.toISOString().slice(0, 10))}`);
  }
  if (isDate(qp.to)) w.push(`AcilisTarihi < DATEADD(DAY, 1, ${esc(qp.to)})`);
  if (qp.keyAccount === '1' || qp.keyAccount === '0') w.push(`KeyAccount = ${qp.keyAccount}`);
  if (typeof qp.tipi === 'string' && TIPI.has(qp.tipi)) w.push(`Tipi = ${esc(qp.tipi)}`);
  if (typeof qp.kaynak === 'string' && KAYNAK.has(qp.kaynak)) w.push(`Kaynak = ${esc(qp.kaynak)}`);
  if (typeof qp.proje === 'string' && qp.proje) w.push(`Proje = ${esc(qp.proje)}`);
  if (typeof qp.dist === 'string' && qp.dist) w.push(`Dist = ${esc(qp.dist)}`);
  if (qp.onlyL2 === '1') w.push(`UlastiL2 = 1`);
  if (qp.onlyYazilim === '1') w.push(`YazilimaAcildi = 1`);
  return 'WHERE ' + w.join(' AND ');
}

/** GET /api/monitoring/summary — funnel + KPI tek satır */
router.get('/summary', requireManager, async (req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT ${METRICS},
         SUM(CASE WHEN KodlamaSonucu = N'Devam Ediyor'   THEN 1 ELSE 0 END) AS devamEden,
         SUM(CASE WHEN KodlamaSonucu = N'Diğer Kök-Neden' THEN 1 ELSE 0 END) AS digerKok,
         AVG(CAST(CozumSuresiDk AS float)) / 60.0 AS ortCozumSaat
       FROM ${VIEW} ${buildWhere(req.query)}`,
    );
    res.json(serialize(rows[0]));
  } catch (err) {
    console.error('[monitoring:summary]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/** GET /api/monitoring/timeseries?grain=day|week|month|year — dönem bazında funnel */
router.get('/timeseries', requireManager, async (req, res) => {
  try {
    const g = GRAINS[req.query.grain] || GRAINS.month;
    const rows = await prisma.$queryRawUnsafe(
      `SELECT ${g.sel} AS period, ${METRICS} FROM ${VIEW} ${buildWhere(req.query)} GROUP BY ${g.grp} ORDER BY ${g.ord}`,
    );
    res.json(rows.map(serialize));
  } catch (err) {
    console.error('[monitoring:timeseries]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/** GET /api/monitoring/breakdown?dimension=Proje|Dist|...&page=1&pageSize=20 — boyut kırılımı (SAYFALI) */
router.get('/breakdown', requireManager, async (req, res) => {
  try {
    const col = DIMENSIONS[req.query.dimension];
    if (!col) return res.status(400).json({ error: 'bad_dimension', message: 'Geçersiz boyut.' });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const where = buildWhere(req.query);
    const [rows, totalRow] = await Promise.all([
      // Sıralama tie-break'i (${col} ASC) → sayfalar arasında satır kaymasın
      prisma.$queryRawUnsafe(
        `SELECT ISNULL(CAST(${col} AS nvarchar(400)), N'(boş)') AS [key], ${METRICS}
         FROM ${VIEW} ${where} GROUP BY ${col}
         ORDER BY COUNT(*) DESC, ${col} ASC
         OFFSET ${(page - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY`,
      ),
      prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM (SELECT 1 AS x FROM ${VIEW} ${where} GROUP BY ${col}) t`),
    ]);
    res.json({ rows: rows.map(serialize), total: num(totalRow[0].total), page, pageSize });
  } catch (err) {
    console.error('[monitoring:breakdown]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/** GET /api/monitoring/filters — filtre seçenekleri (tarih sınırları, projeler, tipler) */
router.get('/filters', requireManager, async (req, res) => {
  try {
    const base = `FROM ${VIEW} WHERE Sirket = N'UNIVERA'`;
    const [bounds, projeler, tipler, meta] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT MIN(Yil) AS minYil, MAX(Yil) AS maxYil, CONVERT(varchar(10), MAX(AcilisTarihi), 23) AS sonTarih ${base}`),
      prisma.$queryRawUnsafe(`SELECT TOP 200 Proje AS [key], COUNT(*) AS c ${base} AND Proje <> N'(Atanmamış)' GROUP BY Proje ORDER BY COUNT(*) DESC`),
      prisma.$queryRawUnsafe(`SELECT Tipi AS [key], COUNT(*) AS c ${base} AND Tipi IS NOT NULL GROUP BY Tipi ORDER BY COUNT(*) DESC`),
      // Snapshot tazeliği (rpt tablosu yoksa boş döner — dashboard yine çalışır)
      prisma.$queryRawUnsafe(`SELECT TOP 1 CONVERT(varchar(19), refreshedAt, 120) AS refreshedAt, satirSayisi FROM dbo.rpt_TicketLifecycle_meta WHERE id = 1`).catch(() => []),
    ]);
    res.json({
      bounds: serialize(bounds[0]),
      projeler: projeler.map(serialize),
      tipler: tipler.map(serialize),
      meta: meta[0] ? serialize(meta[0]) : null,
    });
  } catch (err) {
    console.error('[monitoring:filters]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

export default router;
