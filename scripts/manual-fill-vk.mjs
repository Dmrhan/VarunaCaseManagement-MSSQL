// Bos kalan alanlari MANUEL (icerige bakarak secilmis) degerlerle doldurur.
// KB cagrisi YOK. Her degerin code'unu TaxonomyDef'ten resolve eder ve
// cache'e manual:true ile ekler. Sonra render-vk-excel.mjs Excel'i yeniler.
import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import fs from 'node:fs';

const prisma = new PrismaClient();
const OPEN_FIELDS = ['platform', 'businessProcess', 'operationType', 'affectedObject', 'impact'];

const MANUAL = {
  'VK-MQFAJRJR': { businessProcess: 'Satış Ekibi / Rut ve Ziyaret işlemleri' },
  'VK-MQASMV6T': { businessProcess: 'Satış Ekibi / Rut ve Ziyaret işlemleri' },
  'VK-MQ9LN2YY': { businessProcess: 'Satış Ekibi / Rut ve Ziyaret işlemleri' },
  'VK-MQ7UGZ8D': { businessProcess: 'Satış Ekibi / Rut ve Ziyaret işlemleri', impact: 'Tek kullanıcı etkileniyor' },
  'VK-MQ9M88HI': { platform: 'Backoffice' },
  'VK-MQ7UVV0W': {
    businessProcess: 'Satış Ekibi / Rut ve Ziyaret işlemleri', impact: 'Tek kullanıcı etkileniyor',
    rootCauseGroup: 'Yazılım Hatası', rootCauseDetail: 'Görev çalışmıyor (object reference)',
    resolutionType: 'Ürün geliştirme', permanentPrevention: 'Hata mesajı iyileştirilecek',
  },
  'VK-MQ7XDHAQ': {
    rootCauseGroup: 'Ana Veri / Kart Tanımı', rootCauseDetail: 'Satış temsilcisi tanımı hatalı',
    resolutionType: 'Veri / kart düzeltme', permanentPrevention: 'Kontrol / validasyon eklenecek',
  },
  // Mevcut Kök Neden Grubu 'Cihaz / Mobil Ortam' yanlis (sifre/bilgi sorunu);
  // grup duzeltilip uygun detay/onlem secildi.
  'VK-MQG9DBAC': {
    rootCauseGroup: 'Kullanım / Eğitim', rootCauseDetail: 'Bilgi / nasıl yapılır',
    permanentPrevention: 'Bilgi bankası yazısı hazırlanacak',
  },
};

const tax = await prisma.taxonomyDef.findMany({ where: { companyId: 'COMP-UNIVERA', isActive: true },
  select: { taxonomyType: true, code: true, label: true } });
function resolveCode(type, label) {
  const hit = tax.find((t) => t.taxonomyType === type && t.label === label);
  if (!hit) throw new Error(`Taksonomi bulunamadi: ${type} = "${label}"`);
  return hit.code;
}

const cachePath = path.join(process.cwd(), 'scripts', 'vk-kb-fill-results.json');
const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const byNo = new Map(cache.map((r) => [r.caseNumber, r]));

let added = 0;
for (const [no, fields] of Object.entries(MANUAL)) {
  let rec = byNo.get(no);
  if (!rec) {
    // Batch sonrasi eklenen vaka — DB'den caseId/companyId cekip yeni kayit ac.
    const c = await prisma.case.findUnique({ where: { caseNumber: no }, select: { id: true, companyId: true } });
    if (!c) { console.log(`UYARI: ${no} DB'de yok, atlandi`); continue; }
    rec = { caseId: c.id, caseNumber: no, companyId: c.companyId, open: {}, close: {}, notes: [] };
    cache.push(rec); byNo.set(no, rec);
    console.log(`(yeni kayit olusturuldu: ${no})`);
  }
  rec.open ??= {}; rec.close ??= {};
  for (const [field, label] of Object.entries(fields)) {
    const code = resolveCode(field, label);
    const target = OPEN_FIELDS.includes(field) ? rec.open : rec.close;
    target[field] = { code, label, manual: true };
    added++;
    console.log(`${no}  ${field} = ${label}  (${code})`);
  }
}
await prisma.$disconnect();
fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
console.log(`\nToplam ${added} manuel deger cache'e eklendi: ${cachePath}`);
