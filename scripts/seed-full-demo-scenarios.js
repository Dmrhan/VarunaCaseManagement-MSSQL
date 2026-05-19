/**
 * Full Demo Scenarios Seed — May 2026 deterministic dataset.
 *
 * Companies: PARAM (fintech POS), UNIVERA (digital transformation), FINROTA (open banking).
 * Total: 165 cases (55 per company), May 1-18 2026 spread.
 *
 * Run order:
 *   1) npm run db:seed         (base lookups: companies, persons, teams, categories, SLA)
 *   2) npm run db:seed:auth    (Supabase Auth → User + UserCompany)
 *   3) node --env-file=.env scripts/seed-full-demo-scenarios.js
 *
 * Idempotent: stable IDs + caseNumbers. Safe to rerun. NOT a teardown — assumes
 * baseline lookups + auth users exist. Does NOT touch Supabase Auth.
 *
 * GÜVENLİK: yalnız dev/demo DB. Production DB'de ÇALIŞTIRMA — gerçek müşteri
 * verisini bozar. CompanySettings/UserCompany hariç mevcut kayıtların üzerine
 * yazar (upsert).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────

const COMPANIES = ['COMP-PARAM', 'COMP-UNIVERA', 'COMP-FINROTA'];

const TR_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3 Istanbul

const DAY_START = new Date('2026-05-01T05:00:00.000Z').getTime(); // 08:00 TR
const DAY_END   = new Date('2026-05-18T15:00:00.000Z').getTime(); // 18:00 TR

function rng(seed) {
  // Force non-negative seed; LCG mod 233280 with negative seed otherwise
  // yields negative floats and breaks array indexing.
  let s = Math.abs(seed | 0) % 233280;
  if (s === 0) s = 1;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    if (s < 0) s = -s;
    return s / 233280;
  };
}

function pick(arr, r) {
  return arr[Math.floor(r() * arr.length)];
}

function randDateInRange(r, from = DAY_START, to = DAY_END) {
  return new Date(from + Math.floor(r() * (to - from)));
}

function bizHourDate(r, dayIso) {
  // Force 08:00-18:00 Istanbul
  const base = new Date(`${dayIso}T05:00:00.000Z`);
  const hourOffset = Math.floor(r() * 10 * 60 * 60 * 1000);
  return new Date(base.getTime() + hourOffset);
}

function spreadDates(r, count) {
  // Generate `count` dates between DAY_START..DAY_END with biz-hour bias
  const dates = [];
  for (let i = 0; i < count; i++) {
    const dayIdx = Math.floor(r() * 18); // 0..17 = May 1..18
    const dayIso = `2026-05-${String(dayIdx + 1).padStart(2, '0')}`;
    const ts = bizHourDate(r, dayIso);
    dates.push(ts);
  }
  return dates;
}

const STATUSES = [
  { v: 'Acik', w: 30 },
  { v: 'Incelemede', w: 18 },
  { v: 'ThirdPartyWaiting', w: 10 },
  { v: 'Eskalasyon', w: 8 },
  { v: 'Cozuldu', w: 22 },
  { v: 'YenidenAcildi', w: 7 },
  { v: 'IptalEdildi', w: 5 },
];
const PRIORITIES = [
  { v: 'Low', w: 25 },
  { v: 'Medium', w: 48 },
  { v: 'High', w: 22 },
  { v: 'Critical', w: 5 },
];
const ORIGINS = ['Telefon', 'Eposta', 'Web', 'Chatbot', 'Diger'];
const REQ_TYPES = ['Bilgi', 'Oneri', 'Talep', 'Sikayet', 'Hata'];

function weightedPick(arr, r) {
  const total = arr.reduce((s, a) => s + a.w, 0);
  let x = r() * total;
  for (const a of arr) {
    x -= a.w;
    if (x <= 0) return a.v;
  }
  return arr[arr.length - 1].v;
}

// ─────────────────────────────────────────────────────────────────
// Business themes per company
// ─────────────────────────────────────────────────────────────────

const COMPANY_THEMES = {
  'COMP-PARAM': {
    name: 'PARAM',
    productNames: ['ParamPOS', 'Sanal POS', 'Fiziki POS', 'Cep POS', 'Pazaryeri Ödeme', 'Kolay Tahsilat', 'ParamKart'],
    contactTitles: ['Finans Yetkilisi', 'POS Operasyon Sorumlusu', 'Pazaryeri Operasyon'],
    accounts: [
      { code: 'PAR-1001', name: 'Akar Gıda Dağıtım A.Ş.', vkn: '1770123431', package: 'Premium', segment: 'Enterprise' },
      { code: 'PAR-1002', name: 'Mavi E-Ticaret Ltd.', vkn: '2880234542', package: 'Standard', segment: 'SMB' },
      { code: 'PAR-1003', name: 'Yeşil Pazaryeri Tic.', vkn: '3990345653', package: 'Premium', segment: 'Enterprise' },
      { code: 'PAR-1004', name: 'Karadeniz İnşaat', vkn: '4001456764', package: 'Standard', segment: 'SMB' },
      { code: 'PAR-1005', name: 'Mavi Bulut Yazılım', vkn: '5112567875', package: 'Premium', segment: 'Enterprise' },
      { code: 'PAR-1006', name: 'Demir Çelik San.', vkn: '6223678986', package: 'Standard', segment: 'Enterprise' },
      { code: 'PAR-1007', name: 'Akın Lojistik', vkn: '7334789097', package: 'Premium', segment: 'Enterprise' },
      { code: 'PAR-1008', name: 'Yıldız Market A.Ş.', vkn: '8445890108', package: 'Standard', segment: 'SMB' },
      { code: 'PAR-1009', name: 'Konya Otomotiv', vkn: '9556901219', package: 'Premium', segment: 'SMB' },
      { code: 'PAR-1010', name: 'Ege Tekstil İhr.', vkn: '1667012320', package: 'Standard', segment: 'SMB' },
      { code: 'PAR-1011', name: 'Adana Tarım Ürünleri', vkn: '2778123431', package: 'Premium', segment: 'Enterprise' },
      { code: 'PAR-1012', name: 'Trakya Gıda San.', vkn: '3889234542', package: 'Standard', segment: 'SMB' },
    ],
    titles: [
      'POS işlemi raporlarda görünmüyor', 'İade gecikmesi yaşandı', 'Pazaryeri split ödeme hatası',
      'Komisyon hesaplaması yanlış görünüyor', 'Sanal POS entegrasyon hatası', 'Kart/cashback sorunu',
      'Settlement raporu eksik', 'POS bağlantı kopuyor', 'ParamKart yükleme başarısız',
      'Komisyon iadesi yapılmadı', 'Fiziki POS yazıcı hatası', 'Cep POS kullanıcı yetki sorunu',
      '3D Secure başarısız işlem akışı', 'Taksitli ödeme reddedildi', 'Kolay Tahsilat linki açılmıyor',
      'Pazaryeri komisyon raporu indirilemiyor', 'Cashback kuralı uygulanmadı', 'Settlement dosya formatı hatalı',
      'IBAN doğrulama sürekli fail', 'ParamKart cüzdan bakiye sapması', 'POS terminali yazılım güncellemesi başarısız',
      'Mobil uygulama ödeme ekranı donuyor', 'ParamPOS API rate limit hatası', 'İade onayı 24 saattir bekliyor',
      'Multi-vendor split yanlış oran', 'Card-on-file kayıt başarısız', 'Webhook bildirimleri ulaşmıyor',
      'Refund-on-original-card çalışmıyor', 'Test ortamı POS simülasyonu fail', 'Komisyon faturası yanlış tarih',
    ],
    descriptions: [
      'Müşteri dün akşam yapılan POS işlemlerini raporda göremediğini iletti. İşlem ID mevcut ama settlement kuyruğunda kayıp.',
      'İade talebi 3 gün önce açıldı, müşteriye henüz para iadesi gözükmüyor. Banka tarafı tamam ama uygulamada pending kaldı.',
      'Pazaryeri ödemesinde satıcı + komisyon split %50 yerine %100 gönderdi. Acil düzeltme gerekiyor.',
      'Aylık komisyon kesintisi sözleşmede belirtilen orandan farklı. Müşteri sözleşme oranını doğrulamamızı istedi.',
      'Sanal POS entegrasyonunda 3D Secure adımında müşteri ekranı boş kalıyor. Birden fazla rapor geldi.',
      'ParamKart hesabına yapılan cashback yansımıyor. Müşteri 2 hafta önceki kampanyadan bahsediyor.',
      'Bayi 2 günlük settlement raporunu indirmek istediğinde "format error" hatası alıyor; PDF üretimi kırıldı.',
      'Taksitli ödeme talep edilen kart için "taksit desteği yok" cevabı dönüyor; oysa müşteri kartının taksit desteği var.',
      'Kolay Tahsilat linki müşteriye gönderildi ama açıldığında "ödeme sonlandırıldı" mesajı görüyor.',
      'Cashback kampanya kuralı 5000 TL üstü işlemler için 50 TL idi; uygulamada 0 TL yansıdı.',
      'IBAN doğrulama servisi banka cevabını parse edemiyor; 200 müşterinin ekleme işlemi pending.',
      'Webhook 24 saattir hedef sunucuya ulaşmıyor; muhtemel TLS sertifika rotasyonu kaynaklı.',
      'Refund-on-original-card işlemi VISA tarafından "transaction expired" reddiyle dönüyor; net 7 gün geçmiş.',
      'Bayi paneli bir kez girişte 2FA istiyor, ardından dashboard 401 hatası ile geri atıyor.',
      'Multi-vendor split aranan %70/%30 yerine %100/%0 gönderdi; finans ekibi acil talep ediyor.',
      'Test sandbox üzerinde POS simülatörü "ECR not responding" hatası veriyor; entegrasyon ekibi bloklu.',
      'Card-on-file kaydı kayıt sırasında 3DS challenge sonrası timeout veriyor; müşteri tamamlayamıyor.',
      'Pazaryeri satıcı 3 gün önceki komisyon faturasını sistemde tarih olarak 1 ay önceki tarih görüyor.',
    ],
    categories: [
      ['Yazılım', 'POS Entegrasyon'],
      ['Yazılım', 'Pazaryeri'],
      ['Finans', 'Komisyon'],
      ['Finans', 'İade'],
      ['Yazılım', 'Sanal POS'],
      ['Müşteri Sağlığı', 'Kullanım Sorunu'],
    ],
  },
  'COMP-UNIVERA': {
    name: 'UNIVERA',
    productNames: ['Panorama', 'Uni-Dox', 'e-Fatura', 'e-Arşiv', 'e-İrsaliye', 'Mobil Ekip', 'Rota Yönetimi', 'Depo/Stok', 'Saha Veri', 'Servis İş Emri'],
    contactTitles: ['Saha Operasyon Müdürü', 'Depo Sorumlusu', 'e-Dönüşüm Yetkilisi'],
    accounts: [
      { code: 'UNI-2001', name: 'Anadolu FMCG Dağıtım', vkn: '1110001112', package: 'Enterprise', segment: 'Enterprise' },
      { code: 'UNI-2002', name: 'Marmara Soğuk Zincir', vkn: '2220112223', package: 'Premium', segment: 'Enterprise' },
      { code: 'UNI-2003', name: 'Karadeniz Bal Üretim', vkn: '3330223334', package: 'Standard', segment: 'SMB' },
      { code: 'UNI-2004', name: 'Ege Zeytinyağı Koop.', vkn: '4440334445', package: 'Standard', segment: 'SMB' },
      { code: 'UNI-2005', name: 'İstanbul Et Entegre', vkn: '5550445556', package: 'Premium', segment: 'Enterprise' },
      { code: 'UNI-2006', name: 'Konya Tarım Mak. San.', vkn: '6660556667', package: 'Standard', segment: 'SMB' },
      { code: 'UNI-2007', name: 'Bursa Tekstil Ltd.', vkn: '7770667778', package: 'Premium', segment: 'Enterprise' },
      { code: 'UNI-2008', name: 'Çukurova Gıda San.', vkn: '8880778889', package: 'Enterprise', segment: 'Enterprise' },
      { code: 'UNI-2009', name: 'Akdeniz Meyve Suyu', vkn: '9990889990', package: 'Standard', segment: 'SMB' },
      { code: 'UNI-2010', name: 'Trabzon Su Ürünleri', vkn: '1010991001', package: 'Standard', segment: 'SMB' },
      { code: 'UNI-2011', name: 'Antep Baharat A.Ş.', vkn: '2121002112', package: 'Premium', segment: 'Enterprise' },
      { code: 'UNI-2012', name: 'Samsun Tütün Koop.', vkn: '3232113223', package: 'Premium', segment: 'SMB' },
    ],
    titles: [
      'Rota senkronizasyonu mobil app\'e yansımıyor', 'Saha ekibi sipariş senkronize edemiyor',
      'Depo stok hareketi hatası', 'e-Fatura entegrasyon kesintisi', 'e-İrsaliye onayı düşmüyor',
      'Servis iş emri atanmadı', 'Panorama raporu rakam tutmuyor', 'Uni-Dox yedekleme hatası',
      'Saha veri kaydı kayboldu', 'Mobil cihaz GPS sapması', 'Dağıtım planı oluşturulamıyor',
      'e-Arşiv fatura PDF\'i bozuk',
      'Panorama PDF export kırık', 'Rota optimizasyonu hatalı şehir sırası', 'Mobil ekip GPS koordinatı boş',
      'Depo barkod okuyucu eşleşmiyor', 'e-Fatura ETTN üretilmedi', 'e-Arşiv fatura mail gönderilmedi',
      'e-İrsaliye iptal işlemi kabul edilmiyor', 'Saha çalışanı fotoğraf yükleme başarısız',
      'Uni-Dox arama indeksi güncel değil', 'Stok sayım eksik kayıt', 'Servis iş emri imza alanı boş',
      'Mobil app rotada offline mode hatası', 'e-Fatura GİB sender alias eksik', 'Depo lokasyon kodu çakışması',
      'Mobil uygulama oturum açma zorluğu', 'Panorama dashboard yavaş yükleniyor', 'Rota planı silinince irsaliye kaldı',
      'e-İrsaliye RP kodu doğrulanmıyor',
    ],
    descriptions: [
      'Bayi dağıtım rotaları Panorama\'da güncellendi ama mobil ekibin tabletine yansımıyor. 12 saattir senkronize değil.',
      'Saha çalışanı 30 sipariş aldı, telefonda yeşil onay gördü ama merkez sistemde 18 tanesi kayıp.',
      'Depo girişi yapılan 3 palet ürün stok hareket logunda görünmüyor. Sayım farkı oluştu.',
      'GIB tarafına e-Fatura gönderiminde "geçersiz UUID" hatası alıyoruz. Son 4 saatte 17 fatura beklemede.',
      'Servis ekibi mobil cihazlarına iş emri atanmadı, müşteriye geç gidildi. Dispatcher görünüyor diyor ama gelmiyor.',
      'Panorama "Aylık Satış" raporunda toplam, bayi bazlı kalemlerin toplamından 8% sapıyor.',
      'Rota optimizasyonu Edirne→İstanbul→Bursa yerine İstanbul→Edirne→Bursa öneriyor; yakıt 60% fazla.',
      'Mobil cihazda GPS koordinatı boş geldiği için saha çalışanı ziyaret kayıt edemedi; 12 ziyaret kaybedildi.',
      'Depo barkod okuyucu yeni nesil Honeywell modelle eşleşmiyor; manual entry %60 yavaşlatıyor.',
      'e-Fatura ETTN GİB tarafından üretilmemiş geri dönüyor; tüm gönderimler bekleme.',
      'Stok sayım uygulaması kapanmadan önce kayıt eden son 7 lokasyon kayıp; tutarsızlık çıktı.',
      'Servis iş emrinde müşteri imza alanı boş kayıtlandı; offline modda devam etti ama imza sync olmadı.',
      'Uni-Dox arama indeksi 3 gündür güncellenmiyor; yeni yüklenen dokümanlar bulunamıyor.',
      'e-İrsaliye iptal işlemi "RP kodu doğrulanmadı" hatasıyla reddediliyor; muhasebe kapatamıyor.',
      'Mobil uygulama login sonrası "session expired" döngüsüne giriyor; 20+ saha çalışanı etkilendi.',
      'Panorama dashboard sayfası 12 saniye yüklenmeden cevap vermiyor; rapor ekibi şikayetçi.',
      'Saha çalışanı offline modda alınan siparişler online döndüğünde duplicate olarak kaydoluyor.',
      'e-Arşiv fatura HTML PDF dönüşümünde Türkçe karakterler bozuk çıkıyor; arşivlik PDF iade.',
    ],
    categories: [
      ['Yazılım', 'Mobil App'],
      ['Yazılım', 'e-Dönüşüm'],
      ['Yazılım', 'Senkronizasyon'],
      ['Müşteri Sağlığı', 'Raporlama'],
      ['Yazılım', 'Depo/Stok'],
      ['Eğitim', 'Saha Ekibi'],
    ],
  },
  'COMP-FINROTA': {
    name: 'FINROTA',
    productNames: ['Netahsilat', 'Netekstre', 'Posrapor', 'E-DBS', 'TÖS', 'POS Mutabakatı', 'Açık Bankacılık', 'Nakit Akışı'],
    contactTitles: ['Tahsilat Operasyon', 'Finans Müdürü', 'Mutabakat Sorumlusu'],
    accounts: [
      { code: 'FIN-3001', name: 'Ahmetler Holding', vkn: '4001100001', package: 'Enterprise', segment: 'Enterprise' },
      { code: 'FIN-3002', name: 'Bursa Tekstil Holding', vkn: '4002211002', package: 'Premium', segment: 'Enterprise' },
      { code: 'FIN-3003', name: 'Anadolu Sigorta Acente', vkn: '4003322003', package: 'Standard', segment: 'SMB' },
      { code: 'FIN-3004', name: 'Yeşil Enerji Yatırım', vkn: '4004433004', package: 'Premium', segment: 'Enterprise' },
      { code: 'FIN-3005', name: 'Doğu Bankacılık Hizm.', vkn: '4005544005', package: 'Enterprise', segment: 'Enterprise' },
      { code: 'FIN-3006', name: 'Kuzey Petrol Dağıtım', vkn: '4006655006', package: 'Premium', segment: 'Enterprise' },
      { code: 'FIN-3007', name: 'Marmara Otomotiv', vkn: '4007766007', package: 'Standard', segment: 'SMB' },
      { code: 'FIN-3008', name: 'Ege Mobilya San.', vkn: '4008877008', package: 'Standard', segment: 'SMB' },
      { code: 'FIN-3009', name: 'Akdeniz Turizm A.Ş.', vkn: '4009988009', package: 'Premium', segment: 'Enterprise' },
      { code: 'FIN-3010', name: 'Trakya Süt Üretim', vkn: '4010099010', package: 'Standard', segment: 'SMB' },
      { code: 'FIN-3011', name: 'Çukurova Lojistik', vkn: '4011110021', package: 'Premium', segment: 'Enterprise' },
      { code: 'FIN-3012', name: 'Karadeniz Demir Çelik', vkn: '4012221032', package: 'Enterprise', segment: 'Enterprise' },
    ],
    titles: [
      'Bayi tahsilatı görünmüyor', 'Banka hareketleri import edilemedi', 'POS mutabakat farkı',
      'Toplu ödeme dosyası reddedildi', 'Açık bankacılık bağlantısı süresi doldu', 'E-DBS limit aşımı',
      'Netekstre çıktı PDF\'i kırık', 'Posrapor günlük rapor gelmedi', 'TÖS dosya format hatası',
      'Nakit akışı tahminleri sapıyor', 'Banka API timeout', 'Tahsilat kuyruğunda takılan dosya',
      'Posrapor günlük özet hesap dışı', 'E-DBS limit artışı talebi reddedildi', 'Netahsilat dealer kanalı boş',
      'Banka ekstresi 2 satır eksik', 'TÖS dosya 1 IBAN reddedildi', 'Açık bankacılık scope eksik',
      'Netekstre Excel export kırık', 'POS terminal mutabakat 1 günlük gecikme', 'Bayi paneli giriş 401 hatası',
      'E-DBS borç dekontu indirilemiyor', 'TÖS otomatik ödeme planı bozuldu', 'Netahsilat IBAN format değişikliği',
      'Bayi hareketleri raporu boş', 'Posrapor hesap özeti yanlış toplam', 'Açık bankacılık webhook gecikmesi',
      'POS mutabakatı duplicate hareket', 'E-DBS bireysel limit aşımı uyarısı', 'Toplu ödeme dosyası encoding hatası',
    ],
    descriptions: [
      'Bayi 5 gün önce yaptığı tahsilatları Netahsilat panelinde göremiyor. Banka onay yapmış, sistemde "pending" kaldı.',
      'Sabah Netekstre import işi 4 banka için fail oldu. Müşteri ay sonu raporu için bekliyor.',
      'POS mutabakatında bugün 14.350 TL fark var. 3 işlem POS\'ta var, banka tarafında yok.',
      'TÖS toplu ödeme dosyası "geçersiz IBAN" hatasıyla reddedildi. 47 maaş ödemesi etkilendi.',
      'Açık bankacılık consent süresi 90 günü tamamladı, yenilemeden hareketler durmuş.',
      'E-DBS sistemi günlük limit aşıldı uyarısı veriyor ama müşteri limitin 30%\'sinde olduğunu söylüyor.',
      'Posrapor günlük rapor saat 09:00 yerine 14:30\'da geldi; finans ekibi raporlama döngüsünü kaçırdı.',
      'E-DBS limit artırma talebi sistemde "incomplete document" reddiyle dönüyor; eksik bilgi yok.',
      'Netahsilat dealer kanalında bugünkü 87 işlem görünmüyor; bayi paneli boş gösteriyor.',
      'Garanti BBVA ekstresinde 2 satır eksik; banka tarafı tamam doğruladı, import katmanında kayıp.',
      'TÖS dosyasındaki son IBAN 26-haneli; sistem "geçersiz uzunluk" reddediyor; gerçekte yeni IBAN formatı.',
      'Açık bankacılık consent\'inde "AISP_PAYMENTS" scope eksik; transaction list dönmüyor.',
      'Netekstre Excel export 65 saniye sonra timeout veriyor; 200K+ hareket olan müşterilerde tetikleniyor.',
      'POS terminal hareketleri dün gece geç işlendi; mutabakat 24 saat gerisinde.',
      'Bayi paneli login sonrası 401 alıyor; consent token süresi bittiği anda silinmemiş.',
      'E-DBS dekont indirme butonu "file not found" dönüyor; oysa dosya storage\'da mevcut.',
      'TÖS otomatik ödeme planı 1\'inde tetiklenmedi; cron loglarında "no execution" satırı yok bile.',
      'Posrapor günlük özet rakamı 24.430 TL eksik; ay başında benzer fark vardı, tekrar oluyor.',
    ],
    categories: [
      ['Finans', 'Tahsilat'],
      ['Finans', 'Mutabakat'],
      ['Yazılım', 'Banka Entegrasyon'],
      ['Yazılım', 'Açık Bankacılık'],
      ['Finans', 'Toplu Ödeme'],
      ['Müşteri Sağlığı', 'Limit/Kullanım'],
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// Main seed flow
// ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Full Demo Scenarios Seed — May 2026');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Sanity: companies + users must exist (from base seed + seedAuth)
  const companies = await prisma.company.findMany({ where: { id: { in: COMPANIES } } });
  if (companies.length !== 3) throw new Error('Base companies missing. Run db:seed first.');

  const users = await prisma.user.findMany({
    where: { email: { in: ['agent@varuna.dev','backoffice@varuna.dev','supervisor@varuna.dev','csm@varuna.dev','admin@varuna.dev','sysadmin@varuna.dev'] } },
    select: { id: true, email: true, role: true, personId: true, fullName: true },
  });
  if (users.length < 6) throw new Error(`Demo users missing (${users.length}/6). Run db:seed:auth first.`);
  const userByEmail = Object.fromEntries(users.map((u) => [u.email, u]));
  const userByRole = Object.fromEntries(users.map((u) => [u.role, u]));

  const persons = await prisma.person.findMany({ select: { id: true, name: true, teamId: true } });
  const teams = await prisma.team.findMany({ where: { isActive: true }, select: { id: true, name: true, companyId: true } });

  console.log(`Companies: ${companies.length} | Users: ${users.length} | Persons: ${persons.length} | Teams: ${teams.length}\n`);

  // ── 1) Accounts + AccountCompany ──
  console.log('1) Seeding accounts + company relations...');
  const allAccountIds = {};
  for (const companyId of COMPANIES) {
    const theme = COMPANY_THEMES[companyId];
    allAccountIds[companyId] = [];
    for (const def of theme.accounts) {
      // WR-A1 — Müşteri tipi deterministic dağılım (~80% Corporate / 15% Individual / 3% Gov / 2% NonProfit).
      // hash(def.code) bin alır; aynı code her run'da aynı tip üretir.
      const typeBucket = Math.abs(hash(def.code + 'type')) % 100;
      const customerType =
        typeBucket < 80
          ? 'Corporate'
          : typeBucket < 95
            ? 'Individual'
            : typeBucket < 98
              ? 'Government'
              : 'NonProfit';
      // Bireysel için VKN tutmuyoruz (gerçekçi); diğerlerinde mevcut def.vkn korunur.
      // TCKN bu fazda EKLENMEZ — A2 privacy design sonrası.
      const accVkn = customerType === 'Individual' ? null : def.vkn;
      const accLegalName =
        customerType === 'Individual' ? null : `${def.name} ${customerType === 'Government' ? 'Genel Müdürlüğü' : customerType === 'NonProfit' ? 'Vakfı' : 'A.Ş.'}`;
      const accRegistrationNo =
        customerType === 'Individual'
          ? null
          : String(100000 + (Math.abs(hash(def.code + 'reg')) % 900000));

      const acc = await prisma.account.upsert({
        where: { id: `ACC-${def.code}` },
        update: {
          name: def.name,
          vkn: accVkn,
          isActive: true,
          customerType,
          legalName: accLegalName,
          registrationNo: accRegistrationNo,
        },
        create: {
          id: `ACC-${def.code}`,
          name: def.name,
          vkn: accVkn,
          phone: `+90 ${500 + Math.abs(hash(def.code) % 99)} ${String(Math.abs(hash(def.code + 'p') % 10000000)).padStart(7, '0')}`,
          email: `${def.code.toLowerCase()}@${theme.name.toLowerCase()}-demo.com`,
          companyId: null,
          isActive: true,
          customerType,
          legalName: accLegalName,
          registrationNo: accRegistrationNo,
        },
      });
      const ac = await prisma.accountCompany.upsert({
        where: { accountId_companyId: { accountId: acc.id, companyId } },
        update: { externalCustomerCode: def.code, packageName: def.package, segment: def.segment, status: 'active' },
        create: {
          accountId: acc.id,
          companyId,
          externalCustomerCode: def.code,
          packageName: def.package,
          segment: def.segment,
          status: 'active',
        },
      });
      allAccountIds[companyId].push({ acc, ac, def });
    }
  }

  // ── 2) AccountContact (2-3 per major account) ──
  console.log('2) Seeding account contacts...');
  for (const companyId of COMPANIES) {
    const theme = COMPANY_THEMES[companyId];
    for (const { acc, def } of allAccountIds[companyId]) {
      const titles = theme.contactTitles;
      for (let i = 0; i < Math.min(3, titles.length); i++) {
        const slug = `${def.code}-C${i + 1}`;
        const contactId = `CONT-${slug}`;
        await prisma.accountContact.upsert({
          where: { id: contactId },
          update: { isActive: true, isPrimary: i === 0 },
          create: {
            id: contactId,
            accountId: acc.id,
            fullName: turkishName(slug, i),
            title: titles[i],
            email: `${slug.toLowerCase()}@${def.code.toLowerCase()}-demo.com`,
            phone: `+90 ${532 + i} ${String(Math.abs(hash(slug) % 10000000)).padStart(7, '0')}`,
            isPrimary: i === 0,
            isActive: true,
            preferredChannel: i === 0 ? 'phone' : 'email',
          },
        });
      }
    }
  }

  // ── 3) AccountProduct (1-3 per major account, business-relevant names) ──
  console.log('3) Seeding account products...');
  for (const companyId of COMPANIES) {
    const theme = COMPANY_THEMES[companyId];
    for (const { ac, def } of allAccountIds[companyId]) {
      const count = 1 + Math.floor(Math.abs(hash(def.code + 'prod') % 3));
      for (let i = 0; i < count; i++) {
        const productName = theme.productNames[i % theme.productNames.length];
        const productCode = `${def.code}-${productName.slice(0, 4).toUpperCase()}`;
        await prisma.accountProduct.upsert({
          where: { accountCompanyId_productCode: { accountCompanyId: ac.id, productCode } },
          update: { isActive: true, productName },
          create: {
            accountCompanyId: ac.id,
            productName,
            productCode,
            isActive: true,
            startedAt: new Date('2025-09-01T00:00:00Z'),
          },
        });
      }
    }
  }

  // ── 4) Cases — 55 per company ──
  console.log('4) Seeding 165 cases (55 per company)...');
  const allCaseIds = {};
  for (const companyId of COMPANIES) {
    const theme = COMPANY_THEMES[companyId];
    const r = rng(hash(companyId));
    allCaseIds[companyId] = [];
    const accountList = allAccountIds[companyId];
    const companyTeams = teams.filter((t) => t.companyId === companyId);

    for (let i = 1; i <= 55; i++) {
      const caseNumber = `DEMO-${theme.name}-${String(i).padStart(3, '0')}`;
      const status = weightedPick(STATUSES, r);
      const priority = weightedPick(PRIORITIES, r);
      const origin = pick(ORIGINS, r);
      const requestType = pick(REQ_TYPES, r);
      const [cat, sub] = pick(theme.categories, r);
      const title = pick(theme.titles, r);
      const description = pick(theme.descriptions, r);
      const titleIdx = i % accountList.length;
      const acc = accountList[titleIdx].acc;
      const accDef = accountList[titleIdx].def;
      const createdAt = randDateInRange(r);
      // Some demo companies (UNIVERA/FINROTA) may not have own teams in base
      // seed. Fall back to any active team so the case is still assigned.
      const teamPool = companyTeams.length > 0 ? companyTeams : teams;
      const team = pick(teamPool, r);
      const personPool = team ? persons.filter((p) => p.teamId === team.id) : [];
      const person = personPool.length ? pick(personPool, r) : persons[0];

      // SLA
      const slaResponseDueAt = new Date(createdAt.getTime() + (priority === 'Critical' ? 1 : priority === 'High' ? 4 : priority === 'Medium' ? 8 : 12) * 60 * 60 * 1000);
      const slaResolutionDueAt = new Date(createdAt.getTime() + (priority === 'Critical' ? 6 : priority === 'High' ? 24 : priority === 'Medium' ? 48 : 72) * 60 * 60 * 1000);

      // Status-derived fields
      let resolvedAt = null;
      const isClosed = status === 'Cozuldu' || status === 'IptalEdildi';
      const isResolved = status === 'Cozuldu';
      const isOpen = !isClosed;
      const firstResponseAt = status !== 'Acik' ? new Date(createdAt.getTime() + Math.floor(r() * 3 * 60 * 60 * 1000)) : null;

      if (isClosed) {
        resolvedAt = new Date(createdAt.getTime() + (1 + Math.floor(r() * 5)) * 24 * 60 * 60 * 1000);
        if (resolvedAt > new Date(DAY_END)) resolvedAt = new Date(DAY_END);
      }

      const slaViolation = isOpen && r() < 0.18 ? true : (resolvedAt && resolvedAt > slaResolutionDueAt ? true : false);

      // Snooze (defer): ~12% of open cases get snoozeUntil in next 1-7 days.
      // ThirdPartyWaiting status doğal olarak snooze hak ediyor — agent
      // 3. parti cevabını bekliyor, vakayı tarihe defer ediyor.
      let snoozeUntil = null;
      let snoozeReason = null;
      let snoozePreviousStatus = null;
      if (isOpen && (status === 'ThirdPartyWaiting' ? r() < 0.6 : r() < 0.12)) {
        const baseSnoozeMs = Date.now() + (1 + Math.floor(r() * 7)) * 24 * 60 * 60 * 1000;
        snoozeUntil = new Date(baseSnoozeMs);
        snoozeReason = pick(['CustomerWillCall', 'WaitingThirdParty', 'Reminder'], r);
        snoozePreviousStatus = status;
      }

      const data = {
        caseNumber,
        title: `${title}`,
        description: `${description}\n\nMüşteri: ${acc.name} | Kod: ${accDef.code}`,
        caseType: 'GeneralSupport',
        status,
        priority,
        origin,
        companyId,
        companyName: companies.find((c) => c.id === companyId).name,
        accountId: acc.id,
        accountName: acc.name,
        customerMatchPending: false,
        category: cat,
        subCategory: sub,
        requestType,
        productGroup: theme.productNames[i % theme.productNames.length],
        assignedTeamId: team.id,
        assignedTeamName: team.name,
        assignedPersonId: person.id,
        assignedPersonName: person.name,
        slaResponseDueAt,
        slaResolutionDueAt,
        slaViolation,
        resolvedAt,
        snoozeUntil,
        snoozeReason,
        snoozePreviousStatus,
        createdAt,
        updatedAt: resolvedAt ?? createdAt,
      };

      // Resolved cases get a resolutionNote so qaScoreBatch has material
      if (isResolved) {
        data.resolutionNote = `${pick(['Müşteriye telefonla geri dönüş yapıldı, sorun çözüldü.','Ekip içinde tartışıldı, hata düzeltildi ve müşteri bilgilendirildi.','Geçici çözüm uygulandı, kalıcı düzeltme önümüzdeki sprintte.','Müşteri ile uzlaşı sağlandı, uygulamada düzeltme yayında.'], r)} ${title.toLowerCase()} için aksiyon kapatıldı.`;
      }

      const created = await prisma.case.upsert({
        where: { caseNumber },
        update: data,
        create: data,
      });
      allCaseIds[companyId].push(created);

      // CaseActivity: creation
      await prisma.caseActivity.upsert({
        where: { id: `ACT-${caseNumber}-CREATE` },
        update: { at: createdAt },
        create: {
          id: `ACT-${caseNumber}-CREATE`,
          caseId: created.id,
          companyId,
          action: 'Vaka oluşturuldu',
          actionType: 'CaseCreated',
          actor: 'Demo Seed',
          at: createdAt,
        },
      });
      if (firstResponseAt) {
        await prisma.caseActivity.upsert({
          where: { id: `ACT-${caseNumber}-FIRST` },
          update: { at: firstResponseAt },
          create: {
            id: `ACT-${caseNumber}-FIRST`,
            caseId: created.id,
            companyId,
            action: 'İlk yanıt verildi',
            actionType: 'StatusChange',
            actor: person.name,
            at: firstResponseAt,
          },
        });
      }
      if (resolvedAt && isResolved) {
        await prisma.caseActivity.upsert({
          where: { id: `ACT-${caseNumber}-RESOLVED` },
          update: { at: resolvedAt },
          create: {
            id: `ACT-${caseNumber}-RESOLVED`,
            caseId: created.id,
            companyId,
            action: 'Vaka çözüldü',
            actionType: 'StatusChange',
            actor: person.name,
            at: resolvedAt,
          },
        });
      }
    }
    console.log(`   ${theme.name}: ${allCaseIds[companyId].length} cases`);
  }

  // ── 5) Notes (some with @mentions) ──
  console.log('5) Seeding notes + mentions + notifications...');
  let noteCount = 0, mentionCount = 0, notifCount = 0;
  for (const companyId of COMPANIES) {
    const r = rng(hash(companyId + 'note'));
    const cases = allCaseIds[companyId];
    for (const c of cases) {
      const notes = Math.floor(r() * 4) + 1; // 1-4 notes per case
      let previousNoteId = null;
      for (let i = 0; i < notes; i++) {
        const authorEmail = pick(['agent@varuna.dev','backoffice@varuna.dev','supervisor@varuna.dev','csm@varuna.dev'], r);
        const author = userByEmail[authorEmail];
        const noteAt = new Date(c.createdAt.getTime() + (i + 1) * Math.floor(r() * 6 * 60 * 60 * 1000));
        const willMention = r() < 0.25 && i > 0;
        let content = pick([
          'Müşteri ile telefonda görüşüldü, sorun anlaşıldı.',
          'Geçici çözüm uygulandı, kalıcı düzeltme planlandı.',
          'Üçüncü parti ile temas kuruldu, dönüş bekleniyor.',
          'Müşteri ek bilgi sağladı, log dosyaları incelendi.',
          'Ekip toplantısında değerlendirildi, sprint planına alındı.',
        ], r);
        let mentionedUser = null;
        if (willMention) {
          const target = pick(['supervisor@varuna.dev', 'csm@varuna.dev', 'admin@varuna.dev'], r);
          mentionedUser = userByEmail[target];
          content = `@${mentionedUser.fullName} ${content}`;
        }
        const noteId = `NOTE-${c.caseNumber}-${i + 1}`;
        await prisma.caseNote.upsert({
          where: { id: noteId },
          update: { content, createdAt: noteAt },
          create: {
            id: noteId,
            caseId: c.id,
            companyId,
            authorName: author.fullName,
            authorId: author.id,
            content,
            visibility: 'Internal',
            parentNoteId: previousNoteId && r() < 0.2 ? previousNoteId : null,
            createdAt: noteAt,
          },
        });
        noteCount++;
        previousNoteId = noteId;
        if (mentionedUser) {
          const mentionId = `MENT-${c.caseNumber}-${i + 1}`;
          await prisma.caseMention.upsert({
            where: { id: mentionId },
            update: { seenAt: r() < 0.3 ? noteAt : null },
            create: {
              id: mentionId,
              caseId: c.id,
              noteId,
              companyId,
              mentionedUserId: mentionedUser.id,
              mentionedBy: author.id,
              seenAt: r() < 0.3 ? noteAt : null,
              createdAt: noteAt,
            },
          });
          mentionCount++;
          // CaseNotification for the mention
          const notifId = `NOTIF-${c.caseNumber}-MENT-${i + 1}`;
          await prisma.caseNotification.upsert({
            where: { id: notifId },
            update: {},
            create: {
              id: notifId,
              caseId: c.id,
              companyId,
              eventType: 'mention',
              channel: 'InApp',
              recipient: mentionedUser.id,
              payload: { noteId, mentionedBy: author.fullName, snippet: content.slice(0, 100) },
              sentAt: noteAt,
            },
          });
          notifCount++;
        }
      }
    }
  }
  console.log(`   ${noteCount} notes, ${mentionCount} mentions, ${notifCount} notifications`);

  // ── 6) Call logs (some with nextFollowupDate) ──
  console.log('6) Seeding call logs...');
  let callLogCount = 0;
  for (const companyId of COMPANIES) {
    const r = rng(hash(companyId + 'call'));
    for (const c of allCaseIds[companyId]) {
      if (r() < 0.4) continue;
      const callDate = new Date(c.createdAt.getTime() + Math.floor(r() * 24 * 60 * 60 * 1000));
      const hasFollowup = r() < 0.35;
      const followupBase = new Date('2026-05-19T05:00:00.000Z').getTime();
      const nextFollowup = hasFollowup
        ? new Date(followupBase + Math.floor(r() * 6 * 24 * 60 * 60 * 1000))
        : null;
      const author = userByEmail['agent@varuna.dev'];
      const logId = `CALL-${c.caseNumber}-1`;
      await prisma.caseCallLog.upsert({
        where: { id: logId },
        update: {},
        create: {
          id: logId,
          caseId: c.id,
          companyId,
          callerId: author.id,
          callerName: author.fullName,
          callDate,
          durationMin: 3 + Math.floor(r() * 15),
          callDisposition: pick(['Cevapladi', 'Cevaplamadi', 'TekrarAranacak'], r),
          callOutcome: pick(['Memnun', 'MemnunDegil', 'Tarafsiz', 'Ulasilamadi'], r),
          description: pick([
            'Müşteri ile detay konuşuldu, ek log istendi.',
            'Müşteri ulaşılamadı, sonra tekrar denenecek.',
            'Telefonda hızlı bir bilgilendirme yapıldı.',
          ], r),
          nextFollowupDate: nextFollowup,
        },
      });
      callLogCount++;
    }
  }
  console.log(`   ${callLogCount} call logs`);

  // ── 7) Customerless cases (~10, with requester context + suggestions material) ──
  console.log('7) Seeding customerless cases (Phase D Step 2)...');
  const customerlessSpecs = [
    // companyId, phone-match target acc, requester fields
    { companyId: 'COMP-PARAM', kind: 'phone', accDef: COMPANY_THEMES['COMP-PARAM'].accounts[0], pending: true },
    { companyId: 'COMP-PARAM', kind: 'email', accDef: COMPANY_THEMES['COMP-PARAM'].accounts[1], pending: true },
    { companyId: 'COMP-PARAM', kind: 'externalCode', accDef: COMPANY_THEMES['COMP-PARAM'].accounts[2], pending: true },
    { companyId: 'COMP-UNIVERA', kind: 'phone', accDef: COMPANY_THEMES['COMP-UNIVERA'].accounts[0], pending: true },
    { companyId: 'COMP-UNIVERA', kind: 'companyName', accDef: COMPANY_THEMES['COMP-UNIVERA'].accounts[1], pending: true },
    { companyId: 'COMP-FINROTA', kind: 'phone', accDef: COMPANY_THEMES['COMP-FINROTA'].accounts[0], pending: true },
    { companyId: 'COMP-FINROTA', kind: 'email', accDef: COMPANY_THEMES['COMP-FINROTA'].accounts[1], pending: true },
    { companyId: 'COMP-FINROTA', kind: 'noMatch', accDef: null, pending: true },
    // Already-matched customerless cases (with eşleştirildi activity log)
    { companyId: 'COMP-PARAM', kind: 'matched', accDef: COMPANY_THEMES['COMP-PARAM'].accounts[3], pending: false },
    { companyId: 'COMP-UNIVERA', kind: 'matched', accDef: COMPANY_THEMES['COMP-UNIVERA'].accounts[2], pending: false },
  ];
  let customerlessCount = 0;
  for (let i = 0; i < customerlessSpecs.length; i++) {
    const spec = customerlessSpecs[i];
    const theme = COMPANY_THEMES[spec.companyId];
    const r = rng(hash('cless' + i));
    const caseNumber = `DEMO-CLESS-${String(i + 1).padStart(2, '0')}`;
    const targetAcc = spec.accDef ? allAccountIds[spec.companyId].find((x) => x.def.code === spec.accDef.code) : null;
    const createdAt = randDateInRange(r);

    const requesterFields = {};
    if (spec.kind === 'phone' && targetAcc) {
      // Use account phone (will phone-match in suggestions)
      const account = await prisma.account.findUnique({ where: { id: targetAcc.acc.id }, select: { phone: true } });
      requesterFields.customerContactPhone = account?.phone ?? '+90 532 5550000';
      requesterFields.customerContactName = 'Ali Yılmaz';
    } else if (spec.kind === 'email' && targetAcc) {
      const account = await prisma.account.findUnique({ where: { id: targetAcc.acc.id }, select: { email: true } });
      requesterFields.customerContactEmail = account?.email ?? 'test@demo.com';
      requesterFields.customerContactName = 'Ayşe Demir';
    } else if (spec.kind === 'externalCode' && targetAcc) {
      requesterFields.customerContactName = 'Mehmet Kaya';
      requesterFields.customerCompanyName = targetAcc.def.name;
      // External code surfaces via description regex (5-digit code)
    } else if (spec.kind === 'companyName' && targetAcc) {
      requesterFields.customerCompanyName = targetAcc.def.name;
      requesterFields.customerContactName = 'Fatma Sönmez';
    } else if (spec.kind === 'noMatch') {
      requesterFields.customerContactName = 'Bilinmeyen Kişi';
      requesterFields.customerCompanyName = 'Hayalet Firma Ltd.';
    } else if (spec.kind === 'matched' && targetAcc) {
      requesterFields.customerContactName = 'Geçmiş Talep Sahibi';
    }

    const isMatched = !spec.pending;

    const data = {
      caseNumber,
      title: pick(theme.titles, r),
      description: `${pick(theme.descriptions, r)}\n\n[Müşteri Kaydı YOK — Agent intake'i: ${requesterFields.customerContactName ?? '-'}]${spec.kind === 'externalCode' && targetAcc ? `\nMüşteri kodu: ${targetAcc.def.code.split('-')[1]}` : ''}`,
      caseType: 'GeneralSupport',
      status: 'Acik',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: spec.companyId,
      companyName: theme.name,
      accountId: isMatched ? targetAcc?.acc.id : null,
      accountName: isMatched ? targetAcc?.acc.name : null,
      customerMatchPending: !isMatched,
      ...requesterFields,
      category: theme.categories[0][0],
      subCategory: theme.categories[0][1],
      requestType: 'Talep',
      createdAt,
      updatedAt: createdAt,
    };
    const created = await prisma.case.upsert({
      where: { caseNumber },
      update: data,
      create: data,
    });
    customerlessCount++;
    if (isMatched && targetAcc) {
      const linkActId = `ACT-${caseNumber}-LINK`;
      const linkAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);
      await prisma.caseActivity.upsert({
        where: { id: linkActId },
        update: {},
        create: {
          id: linkActId,
          caseId: created.id,
          companyId: spec.companyId,
          action: `Müşteri eşleştirildi: ${targetAcc.acc.name}`,
          actionType: 'FieldUpdate',
          fieldName: 'accountId',
          fromValue: null,
          toValue: targetAcc.acc.id,
          actor: 'Demo Supervisor',
          at: linkAt,
        },
      });
    }
  }
  console.log(`   ${customerlessCount} customerless cases (${customerlessSpecs.filter((s) => s.pending).length} pending, ${customerlessSpecs.filter((s) => !s.pending).length} matched)`);

  // ── 8) Watchers (2-5 per demo persona) ──
  console.log('8) Seeding watchers...');
  let watcherCount = 0;
  for (const role of ['Agent', 'Supervisor', 'CSM', 'Admin']) {
    const u = userByRole[role];
    if (!u) continue;
    const r = rng(hash('watcher' + role));
    // Pick 3-5 random cases across companies the user has access to
    const accessibleCompanies = role === 'SystemAdmin' || role === 'Admin' ? COMPANIES : COMPANIES.slice(0, 2);
    const pool = accessibleCompanies.flatMap((cid) => allCaseIds[cid].slice(0, 30));
    const picks = new Set();
    while (picks.size < 4 && picks.size < pool.length) picks.add(Math.floor(r() * pool.length));
    for (const idx of picks) {
      const c = pool[idx];
      try {
        await prisma.caseWatcher.upsert({
          where: { caseId_userId: { caseId: c.id, userId: u.id } },
          update: {},
          create: {
            caseId: c.id,
            userId: u.id,
            companyId: c.companyId,
            addedBy: userByEmail['admin@varuna.dev'].id,
            addedAt: new Date(c.createdAt.getTime() + 24 * 60 * 60 * 1000),
          },
        });
        watcherCount++;
      } catch {}
    }
  }
  console.log(`   ${watcherCount} watchers`);

  // ── 9) Reminders (3-5 per demo persona, remindAt May 18-25) ──
  console.log('9) Seeding reminders...');
  let reminderCount = 0;
  const remindBase = new Date('2026-05-18T06:00:00.000Z').getTime();
  for (const role of ['Agent', 'Supervisor', 'CSM', 'Admin']) {
    const u = userByRole[role];
    if (!u) continue;
    const r = rng(hash('rem' + role));
    const reminderCases = COMPANIES.flatMap((cid) => allCaseIds[cid].slice(0, 20));
    for (let i = 0; i < 4; i++) {
      const c = pick(reminderCases, r);
      const remindAt = new Date(remindBase + Math.floor(r() * 7 * 24 * 60 * 60 * 1000));
      const id = `REM-${role}-${i + 1}`;
      try {
        await prisma.caseReminder.upsert({
          where: { id },
          update: { remindAt, message: `${c.caseNumber} için takip` },
          create: {
            id,
            caseId: c.id,
            userId: u.id,
            companyId: c.companyId,
            remindAt,
            message: `${c.caseNumber} — ${pick(['Müşteriyi arayıp güncel durumu sor','Çözüm sürecini hatırlat','Eskalasyon kararı için kontrol et','Müşteriye geri dönüş yapılacak'], r)}`,
          },
        });
        reminderCount++;
      } catch {}
    }
  }
  console.log(`   ${reminderCount} reminders`);

  // ── 10) Transfers (some cases) ──
  console.log('10) Seeding transfers + links...');
  let transferCount = 0;
  for (const companyId of COMPANIES) {
    const r = rng(hash('xfer' + companyId));
    const cases = allCaseIds[companyId].filter((c) => c.status !== 'Acik');
    const companyTeams = teams.filter((t) => t.companyId === companyId);
    for (let i = 0; i < 5 && i < cases.length; i++) {
      const c = cases[Math.floor(r() * cases.length)];
      const fromTeam = pick(companyTeams, r);
      const toTeam = pick(companyTeams.filter((t) => t.id !== fromTeam.id), r) || fromTeam;
      const xferId = `XFER-${c.caseNumber}-${i + 1}`;
      try {
        await prisma.caseTransfer.upsert({
          where: { id: xferId },
          update: {},
          create: {
            id: xferId,
            caseId: c.id,
            companyId,
            fromTeamId: fromTeam.id,
            toTeamId: toTeam.id,
            reason: pick(['Konu uzmanlık dışı', 'Müşteri talebi', 'Eskalasyon kararı'], r),
            transferredBy: userByEmail['supervisor@varuna.dev'].id,
            transferredAt: new Date(c.createdAt.getTime() + 2 * 60 * 60 * 1000),
          },
        });
        transferCount++;
        // Transfer notification → new team's people
        const notifId = `NOTIF-${c.caseNumber}-XFER-${i + 1}`;
        await prisma.caseNotification.upsert({
          where: { id: notifId },
          update: {},
          create: {
            id: notifId,
            caseId: c.id,
            companyId,
            eventType: 'transfer',
            channel: 'InApp',
            recipient: userByEmail['supervisor@varuna.dev'].id,
            payload: { fromTeam: fromTeam.name, toTeam: toTeam.name, caseNumber: c.caseNumber },
            sentAt: new Date(c.createdAt.getTime() + 2 * 60 * 60 * 1000),
          },
        });
      } catch {}
    }
  }
  console.log(`   ${transferCount} transfers (+ transfer notifications)`);

  // ── 10b) CaseLink seed: Related / Duplicate / Parent ──
  console.log('10b) Seeding case links (Related/Duplicate/Parent)...');
  let linkCount = 0;
  for (const companyId of COMPANIES) {
    const cases = allCaseIds[companyId];
    // 2 Related pairs, 1 Duplicate pair (symmetric — 2 rows), 1 Parent (parent-child)
    const linkPairs = [
      { from: 5, to: 12, type: 'Related' },
      { from: 18, to: 22, type: 'Related' },
      { from: 30, to: 31, type: 'Duplicate' }, // symmetric — yazılır 2 yön
      { from: 40, to: 41, type: 'Parent' },    // 40 child, 41 parent
    ];
    for (let idx = 0; idx < linkPairs.length; idx++) {
      const lp = linkPairs[idx];
      const src = cases[lp.from];
      const dst = cases[lp.to];
      if (!src || !dst) continue;
      const linkId = `LINK-${src.caseNumber}-${dst.caseNumber}-${lp.type}`;
      try {
        await prisma.caseLink.upsert({
          where: { id: linkId },
          update: {},
          create: {
            id: linkId,
            caseId: src.id,
            linkedCaseId: dst.id,
            linkType: lp.type,
            companyId,
            createdBy: userByEmail['supervisor@varuna.dev'].id,
            createdAt: new Date(src.createdAt.getTime() + 60 * 60 * 1000),
          },
        });
        linkCount++;
        // Duplicate is symmetric — write reverse direction
        if (lp.type === 'Duplicate') {
          const revId = `LINK-${dst.caseNumber}-${src.caseNumber}-${lp.type}`;
          await prisma.caseLink.upsert({
            where: { id: revId },
            update: {},
            create: {
              id: revId,
              caseId: dst.id,
              linkedCaseId: src.id,
              linkType: 'Duplicate',
              companyId,
              createdBy: userByEmail['supervisor@varuna.dev'].id,
              createdAt: new Date(src.createdAt.getTime() + 60 * 60 * 1000),
            },
          });
          linkCount++;
        }
      } catch {}
    }
  }
  console.log(`   ${linkCount} case links`);

  // ── 10c) Watcher_update notifications + note reactions ──
  console.log('10c) Seeding watcher_update notifications + note reactions...');
  let watcherNotifCount = 0;
  let reactionCount = 0;
  let reactionNotifCount = 0;
  // For every watcher, generate 1 watcher_update notif for a status-change event
  // on the watched case. Picking the most recent activity as the trigger.
  const allWatchers = await prisma.caseWatcher.findMany({
    select: { id: true, caseId: true, userId: true, companyId: true, addedAt: true },
  });
  for (const w of allWatchers) {
    const notifId = `NOTIF-W-${w.id}`;
    try {
      await prisma.caseNotification.upsert({
        where: { id: notifId },
        update: {},
        create: {
          id: notifId,
          caseId: w.caseId,
          companyId: w.companyId,
          eventType: 'watcher_update',
          channel: 'InApp',
          recipient: w.userId,
          payload: { reason: 'status_change', addedAt: w.addedAt },
          sentAt: new Date(w.addedAt.getTime() + 12 * 60 * 60 * 1000),
        },
      });
      watcherNotifCount++;
    } catch {}
  }
  // Note reactions: add 2-3 reactions per company to existing notes
  const reactionEmojis = ['thumbs_up', 'eyes', 'check', 'important', 'thanks'];
  for (const companyId of COMPANIES) {
    const r = rng(hash('react' + companyId));
    const notes = await prisma.caseNote.findMany({
      where: { companyId, authorId: { not: null } },
      select: { id: true, caseId: true, authorId: true },
      take: 30,
    });
    for (let i = 0; i < Math.min(8, notes.length); i++) {
      const note = notes[i];
      if (!note.authorId) continue;
      const reactorEmail = pick(['agent@varuna.dev', 'supervisor@varuna.dev', 'csm@varuna.dev'], r);
      const reactor = userByEmail[reactorEmail];
      if (reactor.id === note.authorId) continue; // don't react to your own
      const emoji = pick(reactionEmojis, r);
      try {
        await prisma.caseNoteReaction.upsert({
          where: { noteId_userId_emoji: { noteId: note.id, userId: reactor.id, emoji } },
          update: {},
          create: { noteId: note.id, userId: reactor.id, companyId, emoji },
        });
        reactionCount++;
        // Notify the note author of the reaction
        const notifId = `NOTIF-REACT-${note.id}-${reactor.id}`;
        await prisma.caseNotification.upsert({
          where: { id: notifId },
          update: {},
          create: {
            id: notifId,
            caseId: note.caseId,
            companyId,
            eventType: 'note_reaction',
            channel: 'InApp',
            recipient: note.authorId,
            payload: { noteId: note.id, reactorId: reactor.id, emoji },
          },
        });
        reactionNotifCount++;
      } catch {}
    }
  }
  console.log(`   ${watcherNotifCount} watcher_update + ${reactionCount} reactions + ${reactionNotifCount} reaction notifications`);

  // ── 11) Synthetic pattern burst (5 cases createdAt=now, same company+category) ──
  console.log('11) Seeding synthetic burst for PatternAlert...');
  const burstCompany = 'COMP-PARAM';
  const burstCategory = 'TEST-PATTERN';
  const now = new Date();
  for (let i = 0; i < 5; i++) {
    const caseNumber = `DEMO-BURST-${String(i + 1).padStart(2, '0')}`;
    const ts = new Date(now.getTime() - i * 60 * 1000);
    await prisma.case.upsert({
      where: { caseNumber },
      update: { createdAt: ts, updatedAt: ts, customerMatchPending: true },
      create: {
        caseNumber,
        title: `Burst test #${i + 1}`,
        description: 'Synthetic burst for PatternAlert demo. Safe to delete.',
        caseType: 'GeneralSupport',
        status: 'Acik',
        priority: 'Low',
        origin: 'Web',
        companyId: burstCompany,
        companyName: 'PARAM',
        // accountId null → customerMatchPending must be true (Phase D invariant)
        customerMatchPending: true,
        category: burstCategory,
        subCategory: 'demo',
        requestType: 'Bilgi',
        createdAt: ts,
        updatedAt: ts,
      },
    });
  }
  console.log('   5 burst cases created');

  console.log('\n✅ Full demo seed complete.');
  await prisma.$disconnect();
}

// ─────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

function turkishName(seed, idx) {
  const first = ['Ali', 'Ayşe', 'Mehmet', 'Fatma', 'Mustafa', 'Zeynep', 'Hasan', 'Elif', 'İbrahim', 'Hatice', 'Yusuf', 'Emine'];
  const last = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir', 'Arslan'];
  const h = Math.abs(hash(seed + idx));
  return `${first[h % first.length]} ${last[(h >> 4) % last.length]}`;
}

main().catch((e) => {
  console.error('❌ Seed failed:', e);
  prisma.$disconnect();
  process.exit(1);
});
