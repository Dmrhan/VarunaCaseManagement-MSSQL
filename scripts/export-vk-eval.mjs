// VK kapali (Cozuldu+IptalEdildi, closedAt>=10.06.2026) vakalari, sorun+cozum
// aciklamasi ve acilis/kapanis etiketleriyle ceker. Hem JSON (degerlendirme icin)
// hem Excel taslagi (bos yorum kolonlariyla) uretir. Salt-okunur.
import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const prisma = new PrismaClient();
const SINCE = new Date('2026-06-10T00:00:00');
const STATUS_TR = { Cozuldu: 'Çözüldü', IptalEdildi: 'İptal Edildi' };

const all = await prisma.case.findMany({
  where: { caseNumber: { startsWith: 'VK' }, status: { in: ['Cozuldu', 'IptalEdildi'] } },
  select: { caseNumber: true, status: true, companyName: true, description: true,
    resolutionNote: true, customFields: true, resolvedAt: true, updatedAt: true },
  orderBy: [{ resolvedAt: 'desc' }],
});
const cases = all.map((c) => ({ ...c, closedAt: c.resolvedAt ?? c.updatedAt }))
  .filter((c) => c.closedAt && new Date(c.closedAt) >= SINCE);

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const data = cases.map((c) => {
  let st = {}; try { const cf = c.customFields ? JSON.parse(c.customFields) : {}; st = cf?.smartTicket ?? {}; } catch {}
  const cl = st.closure ?? {};
  return {
    no: c.caseNumber,
    durum: STATUS_TR[c.status] ?? c.status,
    sirket: c.companyName,
    sorun: clean(c.description).slice(0, 1500),
    cozum: clean(c.resolutionNote).slice(0, 1500),
    acilis: {
      platform: st.platformLabel ?? '',
      isSureci: st.businessProcessLabel ?? '',
      islemTipi: st.operationTypeLabel ?? '',
      etkilenenNesne: st.affectedObjectLabel ?? '',
      etki: st.impactLabel ?? '',
    },
    kapanis: {
      kokNedenGrubu: cl.rootCauseGroupLabel ?? '',
      kokNedenDetayi: cl.rootCauseDetailLabel ?? '',
      cozumTipi: cl.resolutionTypeLabel ?? '',
      kaliciOnlem: cl.permanentPreventionLabel ?? '',
    },
  };
});

// JSON (degerlendirme icin — Claude okuyacak)
fs.writeFileSync(path.join(process.cwd(), 'scripts', 'vk-eval-data.json'), JSON.stringify(data, null, 2));

// Excel taslagi (yorum kolonlari bos)
const rows = data.map((d) => ({
  'Vaka No': d.no, 'Durum': d.durum, 'Şirket': d.sirket,
  'Sorun Açıklaması': d.sorun, 'Çözüm Açıklaması': d.cozum,
  'Açılış: Platform': d.acilis.platform, 'Açılış: İş Süreci': d.acilis.isSureci,
  'Açılış: İşlem Tipi': d.acilis.islemTipi, 'Açılış: Etkilenen Nesne': d.acilis.etkilenenNesne,
  'Açılış: Etki': d.acilis.etki,
  'Kapanış: Kök Neden Grubu': d.kapanis.kokNedenGrubu, 'Kapanış: Kök Neden Detayı': d.kapanis.kokNedenDetayi,
  'Kapanış: Çözüm Tipi': d.kapanis.cozumTipi, 'Kapanış: Kalıcı Önlem': d.kapanis.kaliciOnlem,
  'Açılış Değerlendirmesi': '', 'Kapanış Değerlendirmesi': '', 'Genel Not': '',
}));
const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = Object.keys(rows[0] ?? { x: 1 }).map((k) =>
  ({ wch: k.includes('Açıklama') ? 55 : k.includes('Değerlendirme') || k.includes('Genel') ? 50 : k.includes(':') ? 20 : 14 }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'VK Degerlendirme');
const out = path.join(os.homedir(), 'Desktop', 'VK-kapali-degerlendirme.xlsx');
XLSX.writeFile(wb, out);
await prisma.$disconnect();

const dolu = data.filter((d) => d.kapanis.kokNedenGrubu).length;
console.log(`VK kapali (10.06+): ${data.length}`);
console.log(`Kapanis etiketi dolu: ${dolu} | bos: ${data.length - dolu}`);
console.log(`Sirket dagilimi: ${[...new Set(data.map((d) => d.sirket))].map((s) => `${s}=${data.filter((d) => d.sirket === s).length}`).join(' ')}`);
console.log(`JSON: scripts/vk-eval-data.json`);
console.log(`Excel: ${out}`);
