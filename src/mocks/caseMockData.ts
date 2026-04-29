import type {
  Case,
  CaseCallLog,
  CaseCompany,
  CaseHistoryEntry,
  CaseNote,
  CaseOrigin,
  CasePriority,
  CaseRequestType,
  CaseStatus,
  CaseThirdParty,
  CaseType,
  CallDisposition,
  CallOutcome,
  ChurnResult,
  FinancialStatus,
  OfferedSolutionDef,
  OfferOutcome,
  ProductUsage,
  ResponseLevel,
  RetentionStatus,
  UsageChangeAlert,
} from '@/features/cases/types';

// =========================================================================
// LOOKUPS — şirketler, takımlar, kişiler, müşteriler, kategoriler
// =========================================================================

export const MOCK_COMPANIES: CaseCompany[] = [
  { id: 'COMP-PARAM',    name: 'PARAM' },
  { id: 'COMP-UNIVERA',  name: 'UNIVERA' },
  { id: 'COMP-FINROTA',  name: 'FINROTA' },
];

export const MOCK_THIRD_PARTIES: CaseThirdParty[] = [
  { id: 'TP-LEGAL',     name: 'Hukuk Departmanı',   description: 'Sözleşme/iptal incelemeleri',     isActive: true },
  { id: 'TP-JIRA',      name: 'Jira (Geliştirme)',  description: 'Yazılım geliştirme bağımlılığı',  isActive: true },
  { id: 'TP-OPS',       name: 'Operasyon',          description: 'Saha/kurulum operasyonu',          isActive: true },
  { id: 'TP-BKM',       name: 'BKM',                description: 'Banka Kartları Merkezi',           isActive: true },
  { id: 'TP-VENDOR',    name: 'Tedarikçi',          description: 'Donanım/yazılım tedariği',        isActive: true },
  { id: 'TP-INTEGRATR', name: 'Entegratör',         description: 'Müşteri tarafı entegrasyon ekibi', isActive: true },
];

// Spec 12 — admin tablosu
export const MOCK_OFFERED_SOLUTIONS: OfferedSolutionDef[] = [
  { id: 'OFFER-DISCOUNT-10',  name: '%10 İndirim',                description: '12 ay süreli abonelik üzerinde sabit indirim', isActive: true },
  { id: 'OFFER-DISCOUNT-25',  name: '%25 İndirim (kısa süreli)',  description: 'İlk 3 ay geçerli kademeli indirim',            isActive: true },
  { id: 'OFFER-FREE-MONTH',   name: '1 Ay Ücretsiz',              description: 'Mevcut paket korunarak 1 ay uzatma',           isActive: true },
  { id: 'OFFER-UPGRADE',      name: 'Ücretsiz Paket Yükseltme',   description: 'Premium pakete geçiş, fiyat aynı kalır',       isActive: true },
  { id: 'OFFER-EXTRA-USERS',  name: 'Ek Kullanıcı (5 kişi)',      description: 'Ücretsiz 5 ek kullanıcı tanımlama',            isActive: true },
  { id: 'OFFER-CUSTOM-DEV',   name: 'Talep Üzerine Geliştirme',   description: 'Müşteriye özel modül/rapor',                   isActive: true },
];

export const MOCK_TEAMS: { id: string; name: string }[] = [
  { id: 'TEAM-DESTEK',  name: 'Destek Takımı' },
  { id: 'TEAM-FINANS',  name: 'Finans Takımı' },
  { id: 'TEAM-CS',      name: 'Customer Success' },
  { id: 'TEAM-MOBIL',   name: 'Mobil Takımı' },
  { id: 'TEAM-EGITIM',  name: 'Eğitim Takımı' },
];

export const MOCK_PERSONS: { id: string; name: string; teamId: string }[] = [
  { id: 'USR-001', name: 'Burak Demir',     teamId: 'TEAM-DESTEK' },
  { id: 'USR-002', name: 'Mert Aydın',      teamId: 'TEAM-DESTEK' },
  { id: 'USR-003', name: 'Esra Yıldırım',   teamId: 'TEAM-FINANS' },
  { id: 'USR-004', name: 'Kerem Öz',        teamId: 'TEAM-FINANS' },
  { id: 'USR-005', name: 'Selin Gümüş',     teamId: 'TEAM-CS' },
  { id: 'USR-006', name: 'Deniz Kaya',      teamId: 'TEAM-CS' },
  { id: 'USR-007', name: 'Ahmet Sönmez',    teamId: 'TEAM-CS' },
  { id: 'USR-011', name: 'Cem Ergin',       teamId: 'TEAM-MOBIL' },
  { id: 'USR-012', name: 'Aslı Tan',        teamId: 'TEAM-MOBIL' },
  { id: 'USR-021', name: 'Pelin Yalçın',    teamId: 'TEAM-EGITIM' },
];

export interface CaseAccount {
  id: string;
  name: string;
  phone: string;
  email?: string;
  contactPerson?: string;
}

export const MOCK_ACCOUNTS: CaseAccount[] = [
  { id: 'ACC-1001', name: 'Yıldız Market A.Ş.',     phone: '+90 212 555 0001', email: 'iletisim@yildizmarket.com.tr',  contactPerson: 'Ali Demir' },
  { id: 'ACC-1042', name: 'Anadolu Holding',         phone: '+90 312 555 0042', email: 'finans@anadoluholding.com.tr',   contactPerson: 'Selma Kaya' },
  { id: 'ACC-1108', name: 'Demir Çelik San.',        phone: '+90 232 555 0108', email: 'destek@demircelik.com.tr',       contactPerson: 'Hakan Öz' },
  { id: 'ACC-1155', name: 'Mavi Tekstil Ltd.',       phone: '+90 224 555 0155', email: 'info@mavitekstil.com.tr',         contactPerson: 'Ebru Tan' },
  { id: 'ACC-1199', name: 'Akın Lojistik',           phone: '+90 322 555 0199', email: 'ops@akinlojistik.com.tr',         contactPerson: 'Mehmet Akın' },
  { id: 'ACC-1230', name: 'Ege Gıda Üretim',         phone: '+90 232 555 0230', email: 'satis@egegida.com.tr',            contactPerson: 'Pınar Yıldız' },
  { id: 'ACC-1301', name: 'Karadeniz İnşaat',        phone: '+90 462 555 0301', email: 'proje@karadenizinsaat.com.tr',    contactPerson: 'Cengiz Tekin' },
  { id: 'ACC-1402', name: 'Bursa Tekstil A.Ş.',      phone: '+90 224 555 0402', email: 'iletisim@bursatekstil.com.tr',    contactPerson: 'Aslı Kara' },
  { id: 'ACC-1503', name: 'Konya Otomotiv',          phone: '+90 332 555 0503', email: 'satis@konyaotomotiv.com.tr',      contactPerson: 'Burak Şen' },
  { id: 'ACC-1604', name: 'Antalya Turizm',          phone: '+90 242 555 0604', email: 'rezervasyon@antalyaturizm.com.tr',contactPerson: 'Deniz Polat' },
  { id: 'ACC-1705', name: 'İstanbul Plastik',        phone: '+90 216 555 0705', email: 'destek@istanbulplastik.com.tr',   contactPerson: 'Onur Avcı' },
  { id: 'ACC-1806', name: 'İzmir Kimya',             phone: '+90 232 555 0806', email: 'iletisim@izmirkimya.com.tr',      contactPerson: 'Ayşe Yalçın' },
  { id: 'ACC-1907', name: 'Adana Tarım Ürünleri',    phone: '+90 322 555 0907', email: 'satis@adanatarim.com.tr',         contactPerson: 'Murat Erdoğan' },
  { id: 'ACC-2008', name: 'Trabzon Balıkçılık',      phone: '+90 462 555 1008', email: 'siparis@trabzonbalik.com.tr',     contactPerson: 'Kerim Aksoy' },
];

export const MOCK_CATEGORIES: { category: string; subCategories: string[] }[] = [
  { category: 'Yazılım',           subCategories: ['Raporlama', 'Mobil', 'Entegrasyon', 'Performans'] },
  { category: 'Finans',            subCategories: ['Faturalama', 'Tahsilat', 'Vade'] },
  { category: 'Sözleşme',          subCategories: ['İptal Talebi', 'Yenileme', 'Revizyon'] },
  { category: 'Eğitim',            subCategories: ['Online Eğitim', 'Yerinde Eğitim'] },
  { category: 'Müşteri Sağlığı',   subCategories: ['Kullanım Düşüşü', 'Finansal Risk'] },
];

// =========================================================================
// MOCK CASES — 50 GeneralSupport + 50 ProactiveTracking + 50 Churn = 150
// =========================================================================

const now = new Date();
const iso = (offsetMinutes: number) => new Date(now.getTime() + offsetMinutes * 60 * 1000).toISOString();
const isoFrom = (baseMs: number, offsetMinutes: number) => new Date(baseMs + offsetMinutes * 60 * 1000).toISOString();

const TITLES_GS = [
  'Sistem yavaşlama bildirimi',
  'Rapor sayfası açılmıyor',
  'Veri içe aktarma hatası',
  'Özel rapor talebi',
  'Yeni alan ekleme talebi',
  'Kullanıcı yetkilendirme hatası',
  'Şifre sıfırlama sorunu',
  'Mobil uygulama crash',
  'Push bildirim gelmiyor',
  'Fatura tutarı eşleşmiyor',
  'Tahsilat raporu hatası',
  'KDV oranı yanlış uygulanıyor',
  'Mutabakat farkı tespit edildi',
  'Banka entegrasyon hatası',
  'Lisans yenileme sorgusu',
  'Eğitim içerik talebi',
  'Doküman güncelleme isteği',
  'API yanıt vermiyor',
  'E-fatura imza hatası',
  'Yedekleme zamanlama hatası',
];

const DESCS_GS = [
  'Müşteri sorun yaşıyor, log incelemesi başlatıldı.',
  'Talep iş analizine alındı, fizibilite görüşülüyor.',
  'Sistemde tekrarlayan hata, reproduce edildi.',
  'Detay alındı, ekipler arası koordinasyon sürüyor.',
  'Geçici çözüm uygulandı, kalıcı çözüm araştırılıyor.',
  'Test ortamında doğrulandı, fix hazırlanıyor.',
  'Müşteri memnuniyetsizliği bildirildi, çözüm aranıyor.',
  'Yeni özellik talebi ürün yöneticisine yönlendirildi.',
];

const TITLES_PT = [
  'Kullanım düşüşü — son 30 gün',
  'Kullanım düşüşü — son 60 gün',
  'Kullanım düşüşü — son 90 gün',
  'Aktif kullanıcı azalma uyarısı',
  'Health Score düştü — proaktif arama',
  'Finansal risk uyarısı — Findex',
  'BKM negatif kayıt tespit edildi',
  'Yenileme öncesi proaktif iletişim',
  'Sözleşme bitiş yaklaşıyor — onboarding',
  'Modül kullanımı sıfır — destek planı',
  'İlk 90 gün take-up uyarısı',
  'Lisans aşımı yaklaşıyor',
  'Düzenli kullanım kayboldu',
  'Premium modül adopsiyon düşüş',
  'Aktif kullanıcı oranı kritik altı',
];

const DESCS_PT = [
  'Health Score uyarısı tetiklendi, müşteri ile iletişim planlandı.',
  'Aktif kullanıcı sayısı %30+ düştü, sebep araştırılıyor.',
  'Finansal risk segmentine girdi, proaktif arama planı hazırlandı.',
  'Sözleşme yenileme öncesi memnuniyet ölçümü.',
  'Onboarding süreci yarım kaldı, yeniden devreye alma çalışması.',
  'Lisans paketi aşımı sinyali, ek paket teklifi planlanıyor.',
];

const TITLES_CH = [
  'Sözleşme iptal talebi — yıllık abonelik',
  'Müşteri ayrılma sinyali bildirildi',
  'Yenileme reddetme bildirimi alındı',
  'Aboneliği sonlandırma talebi',
  'Erken iptal talebi — 6 ay kalan',
  'Plan değiştirme — küçültme',
  'Rakibe geçiş sinyali',
  'Hizmet kalitesi şikayeti — iptal eşiği',
  'Premium paketten çıkış talebi',
  'Promosyon süresi sonu — iptal',
  'Bütçe kısıtı nedeniyle iptal talebi',
  'Hizmet kullanılmıyor — iptal isteği',
  'Yıllık değerlendirme sonrası iptal',
  'Birden fazla kullanıcı kaybı bildirimi',
  'Hesap birleştirme — abonelik küçültme',
];

const DESCS_CH = [
  'Müşteri yıllık aboneliğini sonlandırmak istiyor, alternatif teklif hazırlanıyor.',
  'Müşteri rakip sağlayıcıya geçiş niyetini bildirdi.',
  'Bütçe daralması nedeniyle iptal kararı, retention çalışması başladı.',
  'Hizmet kullanım oranı düşük, iptal talebi alındı.',
  'Sözleşme bitişine yakın yenileme reddi geldi.',
  'Müşteri hizmet kalitesinden memnun değil, iptal eşiğinde.',
];

const ASSIGNED_PRODUCT_GROUPS = [
  'ERP - Kasa', 'ERP - Finans', 'ERP - Stok', 'CRM Satış', 'CRM Premium',
  'POS Yazılım', 'Mobil App', 'Entegrasyon Hattı', 'Raporlama Modülü',
];

// PARAM (fintech / ödeme altyapısı) için gerçekçi vaka havuzları
const TITLES_GS_PARAM = [
  'Sanal POS 3D Secure timeout hatası',
  'POS işlemlerinde "Bilinmeyen Hata" kodu',
  'BIN/MCC kombinasyonu reddediliyor',
  'Pre-auth provizyon sonlandırma hatası',
  '3D Secure callback URL doğrulanmıyor',
  'BKM gün sonu raporunda eksik kayıt',
  'IBAN doğrulama servisi 504 dönüyor',
  'Chargeback ihtilaf akışında gecikme',
  'Findex pozitif kayıt güncellenmiyor',
  'PayByLink (e-Tahsilat) sms gönderim hatası',
  'Komisyon hesaplama tutarı farklı',
  'Taksit oranı tablosu güncellenmedi',
  'KKB sorgusu zaman aşımına uğruyor',
  'Hesap-POS eşleştirme uyumsuzluğu',
  'e-Fatura imza onayı reddedildi',
  'Sanal POS işlem limiti aşımı',
  'İade sonrası mahsup gecikmesi',
  'Fraud kuralı yanlış pozitif sonuç veriyor',
  'Webhook ödeme bildirimi tetiklenmiyor',
  'BKM Express authentication hatası',
];

const DESCS_GS_PARAM = [
  'Müşteri 3D Secure kanalında TIMEOUT hatası alıyor, ödeme akışı kesintiye uğradı.',
  'BKM gün sonu mutabakat raporunda işlemler eksik geliyor, finans ekibi BKM ile iletişimde.',
  'Pre-auth provizyonu kapanırken hata dönüyor, askıdaki işlemler için manuel kapama gerekiyor.',
  'IBAN doğrulama servisi 504 hatası veriyor, yedek doğrulama akışı devreye alındı.',
  'Chargeback akışında ihtilaf kayıtları 24 saat gecikiyor, BKM ile koordinasyon başlatıldı.',
  'Findex skor güncellemesi gecikmeli yansıyor, manuel pozitif kayıt isteği iletildi.',
  'PayByLink üzerinden gönderilen SMS müşteriye ulaşmıyor, operatör kapısı incelemede.',
  'Komisyon hesaplama tutarı sözleşmeli oranla eşleşmiyor, finans tarafı yeniden hesaplıyor.',
];

const TITLES_PT_PARAM = [
  'POS işlem hacmi düşüşü — son 30 gün',
  'Aylık tahsilat hacmi %40 azaldı',
  'Sanal POS aktif kullanımı sıfırlandı',
  'BKM negatif kayıt — risk uyarısı',
  'Findex skor düşüşü tespit edildi',
  'İade oranı kritik eşik üzerinde',
  'Onboarding tamamlanmadı — POS aktif değil',
  'Aylık MID bazında işlem yok',
  '3D Secure başarı oranı düşüş trendinde',
  'Taksit kullanım oranı hedefin altında',
  'Yenileme tarihine 60 gün — Health Score uyarısı',
  'Aktif terminal sayısı azalıyor',
  'Komisyon geliri düşüş trendi',
  'Çağrı merkezi şikayet artışı',
  'Premium tahsilat modülü adopsiyon düşük',
];

const DESCS_PT_PARAM = [
  'Aylık POS işlem hacmi %35 düştü, fraud şikayetleri sonrası müşteri yedek sağlayıcı ile çalışıyor olabilir.',
  'Sözleşme yenileme öncesi proaktif iletişim — son 90 günde tahsilat hacmi düşüşte.',
  'Findex skoru kritik eşiğe yaklaştı, finansal sağlık takibi devrede.',
  'İade oranı %5\'in üzerinde, fraud kontrol kuralları gözden geçirilmeli.',
  'Onboarding süreci yarım kaldı, terminal aktivasyonu yapılmadı.',
  'Aylık MID üzerinden işlem akmıyor, kullanım planı sorgulanıyor.',
];

const TITLES_CH_PARAM = [
  'POS hizmeti iptal talebi',
  'Sanal POS sözleşme sonlandırma',
  'Sözleşme yenileme reddedildi',
  'Tüm terminallerin iadesi talep edildi',
  'Daha düşük komisyonlu rakibe geçiş',
  'Erken sözleşme iptali — cezalı çıkış',
  'BKM üyelik iptal isteği',
  'Chargeback oranı yüksek — risk kaynaklı iptal',
  'Premium tahsilat paketinden çıkış talebi',
  'Sözleşme bitiş tarihinde iptal',
  'Hizmet kullanılmıyor — POS iadesi',
  'Ödeme akışı sorunları nedeniyle iptal',
  'Yeni iş modeli — POS gereksinimi kalktı',
  'Fraud şikayetleri sonrası iptal',
  'Müşteri kapanışı — hizmet sonlandırma',
];

const DESCS_CH_PARAM = [
  'Müşteri komisyon oranı daha düşük rakibe geçmek istiyor; özel fiyat teklifi hazırlanıyor.',
  'POS sözleşmesinin yıllık yenilemesi reddedildi, terminal iadesi planlanıyor.',
  'Erken iptal talebi — cezalı çıkış için sözleşme şartları hukuka iletildi.',
  'Chargeback oranı yüksek olduğundan risk ekibi sözleşme sonlandırma öneriyor.',
  'Müşteri kapanış sürecinde — terminal iadesi ve son mutabakat planlandı.',
];

const PRODUCT_GROUPS_PARAM = [
  'Sanal POS', 'Fiziki POS', 'PayByLink', 'BKM Üyelik', 'Tahsilat Yönetimi',
  'Komisyon Modülü', 'Fraud & Risk', '3D Secure Servisi', 'Findex Entegrasyonu',
];

const NOTE_TEXTS_INTERNAL = [
  'Müşteri ile telefon görüşmesi yapıldı, problem doğrulandı.',
  'Geliştirme ekibinden teyit alındı, fix sürüyor.',
  'Eskalasyon hazırlığı yapıldı, supervisor bilgilendirildi.',
  'Önceki vakalar incelendi, benzer pattern tespit edildi.',
  'Müşteri yetkilisi ile randevu alındı, gündem hazırlanıyor.',
];

const NOTE_TEXTS_CUSTOMER = [
  'Talebiniz alınmıştır, kısa sürede dönüş yapılacaktır.',
  'Çözüm üzerinde çalışılıyor, bilgi vereceğiz.',
  'İlgili ekibe iletildi, takipteyiz.',
  'Yapılan inceleme sonrası bilgi paylaşılacaktır.',
];

const STATUS_DIST_PER_TYPE: { status: CaseStatus; count: number }[] = [
  { status: 'Açık',              count: 8 },
  { status: 'İncelemede',        count: 10 },
  { status: '3rdPartyBekleniyor', count: 6 },
  { status: 'Eskalasyon',         count: 5 },
  { status: 'Çözüldü',            count: 9 },
  { status: 'YenidenAcildi',      count: 6 },
  { status: 'İptalEdildi',        count: 6 },
];

// SLA policy hours by priority (basit varsayım — Spec 6 detaylı policy FAZ 3'te)
const SLA_RESOLUTION_HOURS: Record<CasePriority, number> = {
  Low:      72,
  Medium:   48,
  High:     24,
  Critical: 6,
};

const ORIGINS: CaseOrigin[] = ['Telefon', 'E-posta', 'Web', 'Chatbot', 'Diğer'];
const REQUEST_TYPES: CaseRequestType[] = ['Bilgi', 'Öneri', 'Talep', 'Şikayet', 'Hata'];
const CALL_DISPOSITIONS: CallDisposition[] = ['Cevapladı', 'Cevaplamadı', 'NumaraHatalı', 'GörüşmekIstemedi', 'TekrarAranacak'];
const CALL_OUTCOMES: CallOutcome[] = ['Memnun', 'MemnunDeğil', 'Tarafsız', 'Ulaşılamadı'];

function priorityFor(typeIdx: number, slot: number): CasePriority {
  // 50 cases per type → Low: 8, Medium: 23, High: 14, Critical: 5
  const bag: CasePriority[] = [
    ...Array(8).fill('Low'),
    ...Array(23).fill('Medium'),
    ...Array(14).fill('High'),
    ...Array(5).fill('Critical'),
  ];
  // Shift by typeIdx so each type sees a different ordering
  const idx = (slot + typeIdx * 7) % bag.length;
  return bag[idx];
}

function companyFor(typeIdx: number, slot: number): CaseCompany {
  // Each type slot maps to a company; offset by typeIdx for balance
  const order: CaseCompany[][] = [
    [MOCK_COMPANIES[0], MOCK_COMPANIES[1], MOCK_COMPANIES[2]],
    [MOCK_COMPANIES[1], MOCK_COMPANIES[2], MOCK_COMPANIES[0]],
    [MOCK_COMPANIES[2], MOCK_COMPANIES[0], MOCK_COMPANIES[1]],
  ];
  const o = order[typeIdx];
  // Distribute 50 across [17, 17, 16]
  const buckets = [17, 17, 16];
  const cum = [0, buckets[0], buckets[0] + buckets[1], 50];
  for (let i = 0; i < 3; i++) {
    if (slot < cum[i + 1]) return o[i];
  }
  return o[0];
}

function originFor(slot: number): CaseOrigin {
  return ORIGINS[slot % ORIGINS.length];
}

function requestTypeFor(typeIdx: number, slot: number): CaseRequestType {
  return REQUEST_TYPES[(slot + typeIdx) % REQUEST_TYPES.length];
}

interface SlaProfile {
  ageMinutes: number;       // case yaşı
  dueOffset: number;        // şu andan kaç dakika sonra (negatif → ihlal)
  violation: boolean;
}

function slaProfileFor(slot: number, status: CaseStatus, hours: number): SlaProfile {
  // Open statuses karışık dağıtılır: ihlalli / %80 uyarı / normal
  const isOpen = ['Açık', 'İncelemede', '3rdPartyBekleniyor', 'Eskalasyon'].includes(status);
  if (!isOpen) {
    // Çözüldü / YenidenAcildi / İptalEdildi: yaşlı vakalar
    const ageMin = (hours * 60) - 60 * (slot % 6);
    return { ageMinutes: Math.max(60, ageMin), dueOffset: 0, violation: false };
  }
  const totalMin = hours * 60;
  const bucket = slot % 5;
  if (bucket === 0) {
    // İhlal — yaş > total
    return { ageMinutes: Math.round(totalMin * 1.4), dueOffset: -Math.round(totalMin * 0.4), violation: true };
  }
  if (bucket === 1 || bucket === 2) {
    // %80 uyarı bandı
    const ageMin = Math.round(totalMin * 0.85);
    return { ageMinutes: ageMin, dueOffset: totalMin - ageMin, violation: false };
  }
  // Normal — taze vaka
  const ageMin = Math.round(totalMin * 0.25);
  return { ageMinutes: ageMin, dueOffset: totalMin - ageMin, violation: false };
}

function buildHistory(
  caseId: string,
  status: CaseStatus,
  createdAtMs: number,
  ownerName: string,
): CaseHistoryEntry[] {
  const at = (offsetMin: number) => isoFrom(createdAtMs, offsetMin);
  const h: CaseHistoryEntry[] = [];
  let n = 1;
  const push = (e: Omit<CaseHistoryEntry, 'id' | 'caseId'>) => {
    h.push({ id: `${caseId}-H${n}`, caseId, ...e });
    n++;
  };

  push({ action: 'Vaka oluşturuldu', actor: 'Sistem', at: at(0) });
  push({ action: 'Atama yapıldı', toValue: ownerName, actor: 'Sistem', at: at(15) });
  push({ action: 'İlk değerlendirme', actor: ownerName, at: at(45) });
  push({ action: 'Müşteri kontağı kuruldu', actor: ownerName, at: at(90) });
  push({ action: 'Notlandı', actor: ownerName, at: at(120) });

  if (status === 'Açık') return h; // 5

  push({ action: 'Statü değişti', fromValue: 'Açık', toValue: 'İncelemede', actor: ownerName, at: at(150) });

  if (status === 'İncelemede') return h; // 6

  if (status === '3rdPartyBekleniyor') {
    push({ action: 'Statü değişti', fromValue: 'İncelemede', toValue: '3rdPartyBekleniyor', actor: ownerName, at: at(240) });
    push({ action: '3. parti talebi gönderildi', actor: ownerName, at: at(245) });
    return h; // 8
  }
  if (status === 'Eskalasyon') {
    push({ action: 'Statü değişti', fromValue: 'İncelemede', toValue: 'Eskalasyon', actor: ownerName, at: at(240) });
    push({ action: 'Eskalasyon: Takım Lideri', actor: 'Sistem', at: at(241) });
    return h; // 8
  }
  if (status === 'Çözüldü') {
    push({ action: 'Çözüm hazırlandı', actor: ownerName, at: at(240) });
    push({ action: 'Statü değişti', fromValue: 'İncelemede', toValue: 'Çözüldü', actor: ownerName, at: at(280) });
    return h; // 8
  }
  if (status === 'YenidenAcildi') {
    push({ action: 'Statü değişti', fromValue: 'İncelemede', toValue: 'Çözüldü', actor: ownerName, at: at(280) });
    push({ action: 'Statü değişti', fromValue: 'Çözüldü', toValue: 'YenidenAcildi', actor: 'Müşteri', at: at(381) });
    return h; // 8
  }
  if (status === 'İptalEdildi') {
    push({ action: 'İptal kararı verildi', actor: 'Supervisor', at: at(240) });
    push({ action: 'Statü değişti', fromValue: 'İncelemede', toValue: 'İptalEdildi', actor: 'Supervisor', at: at(241) });
    return h; // 8
  }
  return h;
}

function buildNotes(caseId: string, createdAtMs: number, ownerName: string, slot: number): CaseNote[] {
  const at = (off: number) => isoFrom(createdAtMs, off);
  const internal = NOTE_TEXTS_INTERNAL[slot % NOTE_TEXTS_INTERNAL.length];
  const customer = NOTE_TEXTS_CUSTOMER[slot % NOTE_TEXTS_CUSTOMER.length];
  // 1-3 notlar — slot tabanlı
  const count = (slot % 3) + 1;
  const out: CaseNote[] = [];
  if (count >= 1) {
    out.push({ id: `${caseId}-N1`, caseId, authorName: ownerName, content: internal, visibility: 'Internal', createdAt: at(50) });
  }
  if (count >= 2) {
    out.push({ id: `${caseId}-N2`, caseId, authorName: ownerName, content: customer, visibility: 'Customer', createdAt: at(95) });
  }
  if (count >= 3) {
    out.push({ id: `${caseId}-N3`, caseId, authorName: ownerName, content: NOTE_TEXTS_INTERNAL[(slot + 1) % NOTE_TEXTS_INTERNAL.length], visibility: 'Internal', createdAt: at(160) });
  }
  return out;
}

function buildCallLogs(
  caseId: string,
  createdAtMs: number,
  ownerId: string,
  ownerName: string,
  slot: number,
): CaseCallLog[] {
  const count = (slot % 4) + 1; // 1-4
  const at = (off: number) => isoFrom(createdAtMs, off);
  const out: CaseCallLog[] = [];
  for (let i = 0; i < count; i++) {
    const disposition = CALL_DISPOSITIONS[(slot + i) % CALL_DISPOSITIONS.length];
    const outcome = CALL_OUTCOMES[(slot + i + 1) % CALL_OUTCOMES.length];
    const offsetMin = 60 + i * 180; // her arama yaklaşık 3 saat aralıkla
    const callDate = at(offsetMin);
    out.push({
      id: `${caseId}-CL${i + 1}`,
      caseId,
      callDate,
      durationMin: 4 + ((slot + i * 3) % 14),
      callDisposition: disposition,
      callOutcome: outcome,
      description:
        disposition === 'Cevaplamadı'
          ? 'Yetkiliye ulaşılamadı, mesaj bırakıldı.'
          : disposition === 'NumaraHatalı'
          ? 'Numara hatalı, güncelleme istendi.'
          : 'Görüşme tamamlandı.',
      callerId: ownerId,
      callerName: ownerName,
      nextFollowupDate: disposition === 'Cevaplamadı' ? at(offsetMin + 24 * 60) : undefined,
      lastInteractionDate: disposition === 'Cevapladı' ? callDate : undefined,
    });
  }
  return out;
}

interface ChurnExtra {
  cancellationRequest: boolean;
  offeredSolutions: string[];
  offerExpiryDate?: string;
  offerOutcome: OfferOutcome;
  offerRejectionReason?: string;
  actionTaken: string;
  churnResult: ChurnResult;
  retentionStatus: RetentionStatus;
  followUpDate: string;
  cancellationReason?: string;
}

function buildChurnExtra(slot: number, status: CaseStatus, createdAtMs: number): ChurnExtra {
  const offerIds = MOCK_OFFERED_SOLUTIONS.map((o) => o.id);
  const solutions = [
    offerIds[slot % offerIds.length],
    offerIds[(slot + 2) % offerIds.length],
  ];
  // Distribution: 0-1-2 → KabulEdildi, Reddedildi, Beklemede (~33% each)
  const outcomeIdx = slot % 3;
  const outcome: OfferOutcome = outcomeIdx === 0 ? 'KabulEdildi' : outcomeIdx === 1 ? 'Reddedildi' : 'Beklemede';
  const churn: ChurnResult =
    outcome === 'KabulEdildi'
      ? 'TeklifKabulEdildi'
      : status === 'İptalEdildi'
      ? 'İptalEdildi'
      : 'DevamEdiyor';
  const retention: RetentionStatus =
    outcome === 'KabulEdildi'
      ? 'Başarılı'
      : status === 'İptalEdildi'
      ? 'Başarısız'
      : 'DevamEdiyor';
  return {
    cancellationRequest: true,
    offeredSolutions: solutions,
    offerExpiryDate: isoFrom(createdAtMs, 60 * 24 * 5),
    offerOutcome: outcome,
    offerRejectionReason: outcome === 'Reddedildi' ? 'Müşteri rakibe geçmeyi tercih etti.' : undefined,
    actionTaken: 'Müşteriye uyarlanmış teklif paketi sunuldu, takip görüşmesi planlandı.',
    churnResult: churn,
    retentionStatus: retention,
    followUpDate: isoFrom(createdAtMs, 60 * 24 * 7),
    cancellationReason: status === 'İptalEdildi' ? 'Müşteri talebini geri çekti, iptal onaylandı.' : undefined,
  };
}

function buildProactiveExtra(slot: number): {
  financialStatus: FinancialStatus;
  productUsage: ProductUsage;
  usageChangeAlert: UsageChangeAlert;
  responseLevel: ResponseLevel;
} {
  const fs: FinancialStatus[] = ['Düşük', 'Orta', 'Yüksek', 'Kritik'];
  const pu: ProductUsage[] = ['Yüksek', 'Orta', 'Düşük', 'Yok'];
  const uca: UsageChangeAlert[] = ['Artış', 'Azalma', 'Sabit'];
  const rl: ResponseLevel[] = ['Yüksek Öncelik', 'Orta Öncelik', 'Düşük Öncelik'];
  return {
    financialStatus: fs[slot % fs.length],
    productUsage: pu[(slot + 1) % pu.length],
    usageChangeAlert: uca[(slot + 2) % uca.length],
    responseLevel: rl[(slot + 1) % rl.length],
  };
}

function buildCase(typeIdx: number, slot: number): Case {
  const caseTypes: CaseType[] = ['GeneralSupport', 'ProactiveTracking', 'Churn'];
  const caseType = caseTypes[typeIdx];

  // Status — bucket'lara göre dağıtım
  let status: CaseStatus = 'Açık';
  let s = slot;
  for (const bucket of STATUS_DIST_PER_TYPE) {
    if (s < bucket.count) {
      status = bucket.status;
      break;
    }
    s -= bucket.count;
  }

  const company = companyFor(typeIdx, slot);
  const account = MOCK_ACCOUNTS[(slot + typeIdx * 5) % MOCK_ACCOUNTS.length];
  const priority = priorityFor(typeIdx, slot);
  const origin = originFor(slot + typeIdx);
  const requestType = requestTypeFor(typeIdx, slot);
  const cat = MOCK_CATEGORIES[slot % MOCK_CATEGORIES.length];
  const subCat = cat.subCategories[(slot * 3) % cat.subCategories.length];

  // Atama (≈%15 atanmamış kalır → status === 'Açık' içinden bir kısmı havuzda)
  const unassigned = status === 'Açık' && slot % 7 === 0;
  const person = MOCK_PERSONS[(slot + typeIdx * 3) % MOCK_PERSONS.length];
  const team = MOCK_TEAMS.find((t) => t.id === person.teamId)!;

  const slaHours = SLA_RESOLUTION_HOURS[priority];
  const sla = slaProfileFor(slot, status, slaHours);

  const createdAtMs = now.getTime() - sla.ageMinutes * 60 * 1000;
  const createdAt = new Date(createdAtMs).toISOString();
  const updatedAt = isoFrom(createdAtMs, sla.ageMinutes - 30);

  // 3rdPartyBekleniyor için slaPausedAt set edilir
  const slaPausedAt = status === '3rdPartyBekleniyor'
    ? isoFrom(createdAtMs, Math.max(60, sla.ageMinutes - 120))
    : undefined;
  const thirdPartyId = status === '3rdPartyBekleniyor'
    ? MOCK_THIRD_PARTIES[slot % MOCK_THIRD_PARTIES.length].id
    : undefined;
  const thirdPartyName = status === '3rdPartyBekleniyor'
    ? MOCK_THIRD_PARTIES[slot % MOCK_THIRD_PARTIES.length].name
    : undefined;

  // Eskalasyon seviyesi
  const escalationLevel = status === 'Eskalasyon'
    ? (slot % 4 === 0 ? 'Direktör' : slot % 4 === 1 ? 'ÜstYönetim' : 'TakımLideri')
    : 'Yok';

  // Çözüm / iptal notları
  const resolutionNote = status === 'Çözüldü' || status === 'YenidenAcildi'
    ? 'Sorun tespit edilip giderildi, kullanıcı doğrulaması alındı.'
    : undefined;
  const cancellationReason = status === 'İptalEdildi'
    ? 'Müşteri talebini geri çekti, kayıt iptal edildi.'
    : undefined;
  const resolvedAt = status === 'Çözüldü' ? updatedAt : undefined;

  const isParam = company.id === 'COMP-PARAM';
  const titlesGS = isParam ? TITLES_GS_PARAM : TITLES_GS;
  const titlesPT = isParam ? TITLES_PT_PARAM : TITLES_PT;
  const titlesCH = isParam ? TITLES_CH_PARAM : TITLES_CH;
  const descsGS  = isParam ? DESCS_GS_PARAM  : DESCS_GS;
  const descsPT  = isParam ? DESCS_PT_PARAM  : DESCS_PT;
  const descsCH  = isParam ? DESCS_CH_PARAM  : DESCS_CH;

  const titles = caseType === 'GeneralSupport' ? titlesGS : caseType === 'ProactiveTracking' ? titlesPT : titlesCH;
  const descs  = caseType === 'GeneralSupport' ? descsGS  : caseType === 'ProactiveTracking' ? descsPT  : descsCH;
  const title = titles[slot % titles.length];
  const description = descs[slot % descs.length];
  const productGroupPool = isParam ? PRODUCT_GROUPS_PARAM : ASSIGNED_PRODUCT_GROUPS;
  const productGroup = productGroupPool[slot % productGroupPool.length];

  const id = `CASE-${caseType.slice(0, 2).toUpperCase()}-${String(slot + 1).padStart(3, '0')}`;
  const seqNum = typeIdx * 50 + slot + 1;
  const caseNumber = `CASE-2026-${String(10000 + seqNum).padStart(5, '0')}`;

  // Origin description sadece "Diğer" ise
  const originDescription = origin === 'Diğer' ? 'Sistem otomatik tetik' : undefined;

  // History
  const history = buildHistory(id, status, createdAtMs, person.name);

  // Notes
  const notes = buildNotes(id, createdAtMs, person.name, slot);

  // Type-spesifik alanlar
  const callLogs: CaseCallLog[] = caseType === 'ProactiveTracking'
    ? buildCallLogs(id, createdAtMs, person.id, person.name, slot)
    : [];

  let proactive = caseType === 'ProactiveTracking' ? buildProactiveExtra(slot) : undefined;
  let churn = caseType === 'Churn' ? buildChurnExtra(slot, status, createdAtMs) : undefined;

  // SLA çözüm tarihi (resolution due) — sla.dueOffset şu andan sonra (negatif olabilir)
  const slaResolutionDueAt = iso(sla.dueOffset);
  const slaResponseDueAt = iso(Math.round(sla.dueOffset * 0.3));

  // AI: ~%25 vakada AI alanları dolu
  const aiOn = slot % 4 === 0;

  return {
    id,
    caseNumber,
    title,
    description,
    caseType,
    status,
    priority,
    origin,
    originDescription,
    companyId: company.id,
    companyName: company.name,
    accountId: account.id,
    accountName: account.name,
    category: cat.category,
    subCategory: subCat,
    requestType,
    productGroup,
    assignedTeamId: unassigned ? undefined : team.id,
    assignedTeamName: unassigned ? undefined : team.name,
    assignedPersonId: unassigned ? undefined : person.id,
    assignedPersonName: unassigned ? undefined : person.name,
    escalationLevel,
    thirdPartyId,
    thirdPartyName,
    financialStatus:    proactive?.financialStatus,
    productUsage:       proactive?.productUsage,
    usageChangeAlert:   proactive?.usageChangeAlert,
    responseLevel:      proactive?.responseLevel,
    cancellationRequest:    churn?.cancellationRequest,
    offeredSolutions:       churn?.offeredSolutions,
    offerExpiryDate:        churn?.offerExpiryDate,
    offerOutcome:           churn?.offerOutcome,
    offerRejectionReason:   churn?.offerRejectionReason,
    actionTaken:            churn?.actionTaken,
    churnResult:            churn?.churnResult,
    retentionStatus:        churn?.retentionStatus,
    followUpDate:           churn?.followUpDate,
    resolutionNote,
    cancellationReason: cancellationReason ?? churn?.cancellationReason,
    slaResponseDueAt,
    slaResolutionDueAt,
    slaViolation: sla.violation,
    slaPausedAt,
    slaPausedDurationMin: 0,
    slaThirdPartyWaitMin: 0,
    createdAt,
    updatedAt,
    resolvedAt,
    aiSummary:            aiOn ? `${title} için ön özet hazırlandı.` : undefined,
    aiCategoryPrediction: aiOn ? cat.category : undefined,
    aiPriorityPrediction: aiOn ? priority : undefined,
    aiDuplicateScore:     aiOn ? Number(((slot % 7) / 10 + 0.2).toFixed(2)) : undefined,
    aiConfidenceScore:    aiOn ? Number(((slot % 5) / 10 + 0.5).toFixed(2)) : undefined,
    aiGeneratedFlag:      aiOn,
    notes,
    files: [],
    history,
    callLogs,
  };
}

function generateAllCases(): Case[] {
  const all: Case[] = [];
  for (let typeIdx = 0; typeIdx < 3; typeIdx++) {
    for (let slot = 0; slot < 50; slot++) {
      all.push(buildCase(typeIdx, slot));
    }
  }
  return all;
}

export const MOCK_CASES: Case[] = generateAllCases();
