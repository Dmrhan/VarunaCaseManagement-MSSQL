import { Router } from 'express';
import { prisma } from '../db/client.js';
import { verifyJwt, requireRole } from '../db/auth.js';
import { PROJE_MAP } from './projeMap.js';
import { loadWorkCalendar, businessMinutesBetween, netDayMinutes } from '../lib/sla/businessTime.js';

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

// Proje varyant → canonical eşlemesi, SQL VALUES tablosu olarak (pivot join'i için).
// Anahtarlar tekil olduğundan bir view satırı en fazla 1 eşleşir → çift-sayım yok.
const PROJE_VALUES = Object.entries(PROJE_MAP).map(([raw, canon]) => `(${esc(raw)}, ${esc(canon)})`).join(', ');

// Sheet 1 blok3 = "açıklama İLE dönenler": kodlanmayan maddelerin belgelenmiş
// geri-dönüş nedenleri (9 BugGroup). Blok4 = bunun DIŞINDAKİ nedenler (Sürece Göre
// Uyarlama, Cevap Bekleniyor, Veritabanında Hatalı İşlem, Bilgi Eksikliği, Hatalı
// Tespit, Yetersiz Veri…). NOT: liste manuel S1 ile teyit edilecek (provizyonel).
const BLOK3_BUGGROUPS = [
  'Son Sette Koşul Oluşmadı', 'Koşul Oluşmadı', 'Dış Sistem Kaynaklı Hata',
  'Analiz Süreci İşletilmeli', 'Müşteri Hizmetleri Tarafından Çözüm Sağlanmıştır',
  'APK İhtiyacı', 'Bilgilendirme Eksikliği', 'Univera Framework Altyapısının Desteklememesi',
  'Sonraki Versiyonda İşlevsel Değişiklik ile Düzeltme Sağlanmıştır',
];
const BLOK3_IN = BLOK3_BUGGROUPS.map((g) => esc(g)).join(', ');

/** [{key,yil,ay,c}] satırlarını pivot yanıtına (periods × rows + totalRow) çevirir.
 *  'Diğer' HER ZAMAN en altta; diğerleri total'e göre azalan. */
function shapePivot(rows) {
  const periods = [...new Set(rows.map((r) => `${num(r.yil)}-${String(num(r.ay)).padStart(2, '0')}`))].sort();
  const pIdx = Object.fromEntries(periods.map((p, i) => [p, i]));
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.key)) map.set(r.key, { key: r.key, values: new Array(periods.length).fill(0), total: 0 });
    const row = map.get(r.key);
    const c = num(r.c);
    row.values[pIdx[`${num(r.yil)}-${String(num(r.ay)).padStart(2, '0')}`]] = c;
    row.total += c;
  }
  const out = [...map.values()].sort((a, b) => {
    if (a.key === 'Diğer') return 1;
    if (b.key === 'Diğer') return -1;
    return b.total - a.total;
  });
  const totalRow = {
    values: periods.map((_, i) => out.reduce((s, r) => s + r.values[i], 0)),
    total: out.reduce((s, r) => s + r.total, 0),
  };
  return { periods, rows: out, totalRow };
}

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
  if (qp.onlyKodlandi === '1') w.push(`Kodlandi = 1`);
  if (qp.onlyKodlanmadan === '1') w.push(`KodlanmadanDondu = 1`);
  // Sheet 1 blok3/4: kodlanmayan maddeleri geri-dönüş açıklaması listesine göre ayır.
  // 'var' = belgelenmiş 9 neden (blok3); 'yok' = liste dışı diğer nedenler (blok4).
  if (qp.bugGrubu === 'var') w.push(`BugGrubu COLLATE DATABASE_DEFAULT IN (${BLOK3_IN})`);
  else if (qp.bugGrubu === 'yok') w.push(`(BugGrubu IS NULL OR BugGrubu COLLATE DATABASE_DEFAULT NOT IN (${BLOK3_IN}))`);
  // Hedef ekip: Dev (Univera Defect) / BI (DinRap). Rapor blokları için.
  if (qp.hedef === 'dev') w.push(`YazilimaAcildi = 1 AND TfsTipi COLLATE DATABASE_DEFAULT = N'Univera Defect'`);
  else if (qp.hedef === 'bi') w.push(`YazilimaAcildi = 1 AND TfsTipi COLLATE DATABASE_DEFAULT LIKE N'%DinRap%'`);
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

/**
 * GET /api/monitoring/report/pivot?dimension=Proje&... — RAPORLAMA pivot bloğu.
 * Boyut (satır) × ay (sütun) sayı matrisi + Toplam satırı. Excel raporlarının
 * her bloğu bu endpoint'ten (blok'a özel filtrelerle) çekilir; %/oran/ortalama
 * frontend'de hesaplanır.
 */
router.get('/report/pivot', requireManager, async (req, res) => {
  try {
    const col = DIMENSIONS[req.query.dimension];
    if (!col) return res.status(400).json({ error: 'bad_dimension', message: 'Geçersiz boyut.' });
    // Proje boyutunda: ham proje-adı varyantlarını resmi/canonical ada indir
    // (PROJE_MAP: "Nestle"/"NESTLE ENROUTE"→"Nestle Retail", "REDBULL"/"RED BULL"
    // →"RedBull", "Doğuş Çay"/"DOGUSCAY"→"Doğuşçay" …). Haritada olmayan proje
    // kendi adıyla kalır (gerçek müşteri gizlenmez); 'Diğer' = junk/test/iç kayıt.
    // Eşleme VALUES tablosuyla LEFT JOIN — raw anahtar tekil → çift-sayım yok.
    // Diğer boyutlarda kolon doğrudan (boş → '(boş)').
    // Alt-sorgu GROUP BY'de olamaz → [key]'i iç SELECT'te hesapla, dışta grupla.
    const dim = req.query.dimension;
    let inner;
    if (dim === 'Proje') {
      inner = `SELECT ISNULL(m.canon, v.Proje) AS [key], v.Yil AS yil, v.Ay AS ay
           FROM ${VIEW} v
           LEFT JOIN (VALUES ${PROJE_VALUES}) m(raw, canon)
             ON m.raw COLLATE DATABASE_DEFAULT = v.Proje COLLATE DATABASE_DEFAULT
           ${buildWhere(req.query)}`;
    } else if (dim === 'KokNeden') {
      // Geçmiş Kök Neden'i sorgu anında DOĞRU alandan (Konunun_Kok_Nedeni) çöz —
      // fiziksel rpt.KokNeden snapshot'ta hâlâ kodlu Kategori_Adi ("5.1.2.2.1 Backoffice").
      // Kaynak guard: yalnız geçmiş satırlar join olur (canlı TicketNo çakışması olmasın).
      // CustomIssueId tekil → çift-sayım yok. Canlı satır cus'suz → v.KokNeden kalır.
      inner = `SELECT ISNULL(NULLIF(LTRIM(RTRIM(ISNULL(cus.Konunun_Kok_Nedeni, v.KokNeden))), N''), N'(boş)') COLLATE DATABASE_DEFAULT AS [key], v.Yil AS yil, v.Ay AS ay
           FROM ${VIEW} v
           LEFT JOIN (SELECT CustomIssueId, Konunun_Kok_Nedeni FROM [VeriOkumaDonusum].[dbo].TBLN4BISSUECUSTOM WITH(NOLOCK)) cus
             ON CAST(cus.CustomIssueId AS nvarchar(50)) COLLATE DATABASE_DEFAULT = v.TicketNo COLLATE DATABASE_DEFAULT
            AND v.Kaynak = N'Geçmiş (next4biz)'
           ${buildWhere(req.query)}`;
    } else {
      inner = `SELECT ISNULL(CAST(${col} AS nvarchar(400)), N'(boş)') AS [key], Yil AS yil, Ay AS ay
           FROM ${VIEW} ${buildWhere(req.query)}`;
    }
    const rows = await prisma.$queryRawUnsafe(
      `SELECT [key], yil, ay, COUNT(*) AS c FROM (${inner}) t GROUP BY [key], yil, ay`,
    );
    res.json(shapePivot(rows));
  } catch (err) {
    console.error('[monitoring:pivot]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * GET /api/monitoring/report/s1?from&to&blok — SHEET 1 (Kök Neden) MADDE-SEVİYESİ pivot.
 * Manuel "Destek Ekiplerinin Yazılıma İlettiği Maddeler" birebir:
 *   • DISTINCT TFS madde say (bildirim değil — bir madde çok bildirimi kapsayabilir),
 *   • ay bazı = TFS madde açılış tarihi ([System.CreatedDate]), Bildirim_Tarihi değil,
 *   • yalnız Dev — BI hariç ([System.WorkItemType] NOT LIKE '%DinRap%').
 * Kök Neden = Konunun_Kok_Nedeni (madde başına bildiriminden). Blok'lar madde'nin
 * RootCause/BugGroup'una göre: b1 tümü / b2 Kodlanan / b3 Kodlanmayan(9-açıklama) /
 * b4 Kodlanmayan(diğer). Yalnız GEÇMİŞ (next4biz) — TFS madde mantığı next4biz'e özgü.
 * Not: generic /report/pivot bildirim-seviyesidir; S1 madde-seviyesi olduğu için AYRI.
 */
router.get('/report/s1', requireManager, async (req, res) => {
  try {
    const { from, to, blok } = req.query;
    if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'bad_date', message: 'Tarih gerekli.' });
    let blokW = '';
    if (blok === 'b2') {
      blokW = `AND w.[Microsoft.VSTS.CMMI.RootCause] COLLATE DATABASE_DEFAULT = N'Kodlama Yapılan'`;
    } else if (blok === 'b3') {
      blokW = `AND w.[Microsoft.VSTS.CMMI.RootCause] COLLATE DATABASE_DEFAULT = N'Kodlama Yapılmayan' AND w.[Univera.BugGroup] COLLATE DATABASE_DEFAULT IN (${BLOK3_IN})`;
    } else if (blok === 'b4') {
      blokW = `AND w.[Microsoft.VSTS.CMMI.RootCause] COLLATE DATABASE_DEFAULT = N'Kodlama Yapılmayan' AND (w.[Univera.BugGroup] IS NULL OR w.[Univera.BugGroup] COLLATE DATABASE_DEFAULT NOT IN (${BLOK3_IN}))`;
    }
    // İç sorgu: madde başına TEK satır (distinct System.Id) — kök neden madde'nin
    // bildiriminden (birden çok bildirim varsa MAX ile tekil). Dış: kök neden × ay say.
    const rows = await prisma.$queryRawUnsafe(`
      WITH m AS (
        SELECT w.[System.Id] AS id,
               DATEPART(YEAR, w.[System.CreatedDate]) AS yil, DATEPART(MONTH, w.[System.CreatedDate]) AS ay,
               MAX(ISNULL(NULLIF(LTRIM(RTRIM(cus.Konunun_Kok_Nedeni)), N''), N'(boş)') COLLATE DATABASE_DEFAULT) AS [key]
        FROM ${VIEW} r
        JOIN [UNITFS].[Tfs_UniveraReports].[dbo].[WorkTumMaddeler] w ON w.[System.Id] = r.TfsNo
        LEFT JOIN (SELECT CustomIssueId, Konunun_Kok_Nedeni FROM [VeriOkumaDonusum].[dbo].TBLN4BISSUECUSTOM WITH(NOLOCK)) cus
          ON CAST(cus.CustomIssueId AS nvarchar(50)) COLLATE DATABASE_DEFAULT = r.TicketNo COLLATE DATABASE_DEFAULT
        WHERE r.Kaynak = N'Geçmiş (next4biz)' AND r.YazilimaAcildi = 1
          AND w.[System.WorkItemType] COLLATE DATABASE_DEFAULT NOT LIKE N'%DinRap%'
          AND w.[System.CreatedDate] >= ${esc(from)} AND w.[System.CreatedDate] < DATEADD(DAY, 1, ${esc(to)})
          ${blokW}
        GROUP BY w.[System.Id], DATEPART(YEAR, w.[System.CreatedDate]), DATEPART(MONTH, w.[System.CreatedDate])
      )
      SELECT [key], yil, ay, COUNT(*) AS c FROM m GROUP BY [key], yil, ay`);
    res.json(shapePivot(rows));
  } catch (err) {
    console.error('[monitoring:s1]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * GET /api/monitoring/report/s4?from&to&kaynak — SHEET 4 (Süre) MESAİ-DUYARLI.
 * Bildirim Açılış→Kapanış süresi, Tipi × ay. İKİ zaman tabanı:
 *   • wall  = ham takvim (CozumSuresiDk),
 *   • biz   = MESAİ saati (hafta sonu+tatil+mola hariç) — UNIVERA çalışma takvimi
 *             (businessTime motoru, satır-başına AcilisTarihi→CozumTarihi).
 * Her taban 3 blok: all(Tüm) / tfsVar(Yazılım-BI'a madde açılmış) / tfsYok(madde yok).
 * Hücre = {s: sayı, d: toplam dk}. Ort Saat = d/s/60, Ort Gün = d/s/netDayMin.
 * netDayMin = takvimin ort. günlük net mesai dk'sı (mola düşülmüş).
 */
router.get('/report/s4', requireManager, async (req, res) => {
  try {
    const qp = req.query;
    if (!isDate(qp.from) || !isDate(qp.to)) return res.status(400).json({ error: 'bad_date', message: 'Tarih gerekli.' });
    const cal = await loadWorkCalendar('COMP-UNIVERA'); // null → biz=wall'a düşer
    const netDay = netDayMinutes(cal);
    const where = buildWhere({ from: qp.from, to: qp.to, kaynak: qp.kaynak });
    const rows = await prisma.$queryRawUnsafe(
      `SELECT Tipi, Yil, Ay, AcilisTarihi, CozumTarihi, CozumSuresiDk, YazilimaAcildi
       FROM ${VIEW} ${where} AND CozumTarihi IS NOT NULL AND CozumSuresiDk >= 0`,
    );
    // block → base → Map(tipi → Map(period → {s,d}))
    const acc = { all: { wall: new Map(), biz: new Map() }, tfsVar: { wall: new Map(), biz: new Map() }, tfsYok: { wall: new Map(), biz: new Map() } };
    const periodSet = new Set();
    const addCell = (m, tipi, period, dk) => {
      if (!m.has(tipi)) m.set(tipi, new Map());
      const pm = m.get(tipi);
      const cur = pm.get(period) || { s: 0, d: 0 };
      cur.s += 1; cur.d += dk; pm.set(period, cur);
    };
    for (const r of rows) {
      const tipi = r.Tipi || '(boş)';
      const period = `${num(r.Yil)}-${String(num(r.Ay)).padStart(2, '0')}`;
      periodSet.add(period);
      const wall = num(r.CozumSuresiDk);
      let biz = wall;
      if (cal) {
        const b = businessMinutesBetween(new Date(r.AcilisTarihi).getTime(), new Date(r.CozumTarihi).getTime(), cal);
        if (b != null) biz = b;
      }
      const grp = num(r.YazilimaAcildi) === 1 ? 'tfsVar' : 'tfsYok';
      addCell(acc.all.wall, tipi, period, wall);
      addCell(acc.all.biz, tipi, period, biz);
      addCell(acc[grp].wall, tipi, period, wall);
      addCell(acc[grp].biz, tipi, period, biz);
    }
    const periods = [...periodSet].sort();
    const TIPI_ORDER = ['Hata', 'Talep', 'Soru', 'Öneri', 'Şikayet', 'Diğer', '(boş)'];
    const shape = (m) => {
      const keys = [...m.keys()].sort((a, b) => {
        const ia = TIPI_ORDER.indexOf(a); const ib = TIPI_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      return keys.map((tipi) => {
        const pm = m.get(tipi);
        const cells = periods.map((p) => pm.get(p) || { s: 0, d: 0 });
        const tot = cells.reduce((a, c) => ({ s: a.s + c.s, d: a.d + c.d }), { s: 0, d: 0 });
        return { tipi, cells, tot };
      });
    };
    res.json({
      netDayMin: netDay,
      periods,
      blocks: {
        all: { wall: shape(acc.all.wall), biz: shape(acc.all.biz) },
        tfsVar: { wall: shape(acc.tfsVar.wall), biz: shape(acc.tfsVar.biz) },
        tfsYok: { wall: shape(acc.tfsYok.wall), biz: shape(acc.tfsYok.biz) },
      },
    });
  } catch (err) {
    console.error('[monitoring:s4]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

export default router;
