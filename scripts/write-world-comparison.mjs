// Ayni ticket'in dunya devlerinin siniflandirma semalarinda nasil gorunecegi (TURKCE).
import ExcelJS from 'exceljs';
import path from 'node:path';
import os from 'node:os';

const DATA = [
  {
    no: 'VK-MQHXZUYH', sorun: 'Mobil uygulamaya giriş yapınca uygulama atıyor (önbellek/veri sorunu)',
    biz: 'Mobil > Kullanıcı/Yetki/Giriş > Giriş yapma | Cihaz/Mobil Ortam > Cihaz bağlantısı | Çözüm: Bilgilendirme',
    snow: 'Olay | Kategori: Son Kullanıcı > Mobil Uygulama > Giriş | Yapılandırma Öğesi: Panorama Mobil | Etki: Düşük × Aciliyet: Orta → Öncelik: P4 | Kapanış Kodu: Çözüldü (Kullanıcı Eğitimi)',
    zen: 'Tip: Olay | Öncelik: Normal | Grup: Mobil Destek | Etiketler: mobil, uygulama-çökmesi, giriş, önbellek | YZ Niyeti: "Girişte uygulama çöküyor"',
    sf: 'Vaka Tipi: Problem | Vaka Nedeni: Teknik Sorun | Öncelik: Orta | Konu: Mobil Uygulama / Giriş | Einstein: Mobil kuyruğa otomatik yönlendir',
    ft: 'Niyet: "Girişte mobil uygulama çökmesi" | Tahmini İş Akışı: Bilgi Bankası yönlendirme (önbellek temizleme adımları) | Otomatik çözüm adayı',
  },
  {
    no: 'VK-MQI1GF1W', sorun: 'Mobil iade girişinde "günlük iade net tutarı aşıldı" uyarısı (ST parametresi)',
    biz: 'Mobil > İade İşlemleri > Hata mesajı | Parametre/Konfigürasyon > ST parametresi eksik | Çözüm: Parametre düzeltme',
    snow: 'Olay → Problem (tekrar eden) | Kategori: Uygulama > Yapılandırma | Yapılandırma Öğesi: ST Parametreleri | Etki: Düşük × Aciliyet: Düşük → Öncelik: P4 | Kapanış: Yapılandırma Düzeltme | Bağlı Problem Kaydı (3 olay)',
    zen: 'Tip: Problem | Öncelik: Normal | Etiketler: mobil, iade, parametre, yapılandırma | YZ Niyeti: "İade net tutarı engelleniyor" | Bağlı kayıt: 3',
    sf: 'Vaka Tipi: Yapılandırma | Vaka Nedeni: Kurulum/Parametre | Öncelik: Orta | Konu: İadeler | Einstein: benzer vaka kümesi (3)',
    ft: 'Niyet: "İade girişi parametreyle engelleniyor" | İş Akışı: Yapılandırma düzeltme prosedürü | Tekrar tespiti → otomatik öneri',
  },
  {
    no: 'VK-MQI08PGI', sorun: 'E-fatura gönderiminde alıcı etiketi uyarısı — müşteri PK adresi boş (veri kalitesi)',
    biz: 'Backoffice > E-Belge > E-Belge gönderme | Ana Veri/Kart Tanımı > Müşteri kartı eksik | Çözüm: Veri/kart düzeltme',
    snow: 'Olay | Kategori: Ana Veri > Müşteri Kaydı | Yapılandırma Öğesi: Müşteri Ana Verisi | Etki: Düşük × Aciliyet: Orta → Öncelik: P3 | Kapanış: Veri Düzeltme | Bilinen Hata: veri kalitesi doğrulama eksiği',
    zen: 'Tip: Olay | Öncelik: Normal | Etiketler: e-fatura, ana-veri, müşteri, doğrulama | YZ Niyeti: "E-fatura alıcı adresi eksik"',
    sf: 'Vaka Tipi: Veri Kalitesi | Vaka Nedeni: Eksik Veri | Öncelik: Orta | Konu: E-Faturalama | Einstein: veri-bütünlüğü işareti',
    ft: 'Niyet: "E-fatura adres doğrulama hatası" | İş Akışı: veri düzeltme + devreye-alma kalite kontrol önerisi',
  },
  {
    no: 'VK-MQI0FMHK', sorun: 'SmartConnect "aktarılacak kayıt bulunamadı" — belge yazdırılmadı (ön koşul bilinmiyor)',
    biz: 'Backoffice > Smart Connect > Aktarım yapma | Kullanım/Eğitim > Bilgi/nasıl yapılır | Çözüm: Bilgilendirme',
    snow: 'Hizmet Talebi / Olay | Kategori: Entegrasyon > ERP Aktarım | Yapılandırma Öğesi: SmartConnect | Etki: Düşük × Aciliyet: Düşük → Öncelik: P4 | Kapanış: Kullanıcı Eğitimi | Bilgi Bankası bağlı',
    zen: 'Tip: Soru | Öncelik: Düşük | Etiketler: smartconnect, entegrasyon, nasıl-yapılır, ön-koşul | YZ Niyeti: "Aktarılacak kayıt yok"',
    sf: 'Vaka Tipi: Soru | Vaka Nedeni: Nasıl Yapılır | Öncelik: Düşük | Konu: Entegrasyon / SmartConnect | Einstein: Bilgi Bankası makalesi öner',
    ft: 'Niyet: "SmartConnect kayıt bulunamadı" | İş Akışı: anında Bilgi Bankası yönlendirme (ön koşul makalesi) | Yönlendirme adayı #1',
  },
  {
    no: 'VK-MQG8OIUQ', sorun: 'E-belge gönderiminde entegratör kullanıcı/şifre hatalı (3. parti)',
    biz: 'Backoffice > E-Belge > E-Belge gönderme | E-Belge/Entegratör (3. parti) > Entegratör servis/şifre | Çözüm: Entegratör/servis müdahalesi',
    snow: 'Olay | Kategori: 3. Parti Entegrasyon > E-Belge Sağlayıcı | Yapılandırma Öğesi: Entegratör Servisi | Etki: Orta × Aciliyet: Orta → Öncelik: P3 | Kapanış: Tedarikçi/Yapılandırma | Tedarikçi SLA etiketi',
    zen: 'Tip: Olay | Öncelik: Yüksek | Grup: Entegrasyonlar | Etiketler: e-belge, entegratör, kimlik-bilgisi, 3-parti | YZ Niyeti: "Entegratör kimlik doğrulama başarısız"',
    sf: 'Vaka Tipi: Entegrasyon | Vaka Nedeni: 3. Parti / Kimlik | Öncelik: Yüksek | Konu: E-Belge | Einstein: Entegrasyon ekibine yükselt',
    ft: 'Niyet: "E-belge entegratör şifre hatası" | İş Akışı: kimlik-güncelleme prosedürü + tedarikçi izleme',
  },
  {
    no: 'VK-MQHYJ3YI', sorun: 'Satış temsilcisi el cihazına Panorama kurulumu talep ediyor (kurulum)',
    biz: 'Mobil > Kullanıcı/Yetki/Giriş > Dosya İndirme | Kurulum > Kurulum | Çözüm: Eğitim',
    snow: 'Hizmet Talebi (Standart) | Kategori: Yazılım Dağıtım > Mobil Uygulama Kurulum | Yapılandırma Öğesi: Panorama Mobil | Karşılama: Kurulum prosedürü | Katalog Öğesi',
    zen: 'Tip: Görev | Öncelik: Normal | Grup: Devreye Alma | Etiketler: kurulum, mobil, dağıtım, apk | YZ Niyeti: "Mobil uygulama kurulum talebi"',
    sf: 'Vaka Tipi: Hizmet Talebi | Vaka Nedeni: Kurulum | Öncelik: Normal | Konu: Dağıtım | Einstein: Saha Destek\'e yönlendir',
    ft: 'Niyet: "Mobil uygulama kurulum talebi" | İş Akışı: rehberli kurulum Bilgi Bankası + tedarik otomasyonu',
  },
  {
    no: 'VK-MQHY7YRJ', sorun: 'Tahsilat girişi yanlış yapıldı, iptal talebi (merkez onayı gerekli)',
    biz: 'Backoffice > Finans Tahsilat > İptal etme | Kullanım/Eğitim > Operatörlük/merkez onayı | Çözüm: Bilgilendirme',
    snow: 'Hizmet Talebi (Onay-gerektiren) | Kategori: Finans > Tahsilat İptali | Yapılandırma Öğesi: Tahsilat Modülü | Onay iş akışı gerekli | Kapanış: Onayla Karşılandı',
    zen: 'Tip: Görev | Öncelik: Normal | Grup: Finans Operasyon | Etiketler: tahsilat, iptal, onay, finans | YZ Niyeti: "Yanlış tahsilat kaydını iptal et"',
    sf: 'Vaka Tipi: Hizmet Talebi | Vaka Nedeni: İptal/Geri Alma | Öncelik: Orta | Konu: Finans | Onay Süreci tetiklendi',
    ft: 'Niyet: "Onaylı tahsilat iptali" | İş Akışı: onay-gerektiren prosedür (manuel onay adımı)',
  },
  {
    no: 'VK-MQAWK8S4', sorun: 'Backoffice kullanıcı haklarının başka kullanıcıdan kopyalanması/kısıtlanması (yetki)',
    biz: 'Backoffice > Kullanıcı/Yetki/Giriş > Düzeltme | Yetki/Rol > Rol/kullanıcı tanımsız | Çözüm: Yetki düzenleme',
    snow: 'Hizmet Talebi | Kategori: Kimlik ve Erişim Yönetimi > Rol/Yetki | Yapılandırma Öğesi: Kullanıcı/Rol | Etki: Düşük × Aciliyet: Düşük → Öncelik: P4 | Erişim Talebi iş akışı | Kapanış: Erişim Verildi',
    zen: 'Tip: Görev | Öncelik: Normal | Grup: Kimlik/Güvenlik | Etiketler: erişim, yetki, rol, kullanıcı-yönetimi | YZ Niyeti: "Kullanıcı yetkilerini kopyala"',
    sf: 'Vaka Tipi: Hizmet Talebi | Vaka Nedeni: Erişim/Yetki | Öncelik: Düşük | Konu: Kullanıcı Yönetimi | Einstein: Güvenlik\'e yönlendir',
    ft: 'Niyet: "Kullanıcı yetki/rol değişimi" | İş Akışı: self-servis erişim talebi (öneri: portal)',
  },
  {
    no: 'VK-MQHZWL6C', sorun: 'SSL sertifikasının süresi 1 aydan az kaldı, yenileme talebi (altyapı)',
    biz: 'Backoffice > (iş süreci yok) > Bilgi talebi | Sunucu/Altyapı/Performans > — | Çözüm: Entegratör/servis müdahalesi',
    snow: 'Değişiklik Talebi (Standart/Ön onaylı) | Kategori: Altyapı > Sertifika Yönetimi | Yapılandırma Öğesi: SSL Sertifika / Alan Adı | Etki: Yüksek (potansiyel) × Aciliyet: Düşük → planlı | Değişiklik iş akışı',
    zen: 'Tip: Görev | Öncelik: Yüksek | Grup: Altyapı | Etiketler: ssl, sertifika, süre-dolumu, altyapı | YZ Niyeti: "SSL sertifika yenileme"',
    sf: 'Vaka Tipi: Altyapı | Vaka Nedeni: Bakım | Öncelik: Yüksek | Konu: Güvenlik/Sertifika | (genelde ITSM tarafına devredilir)',
    ft: 'Niyet: "SSL sertifika yenileme" | İş Akışı: proaktif izleme uyarısı (otomatik süre-dolumu uyarısı önerisi)',
  },
  {
    no: 'VK-MQI1L4L7', sorun: 'Mobil bilgi alımı yapılamıyor — cihaz tarihi/saati yanlış (SSL doğrulaması bozuluyor)',
    biz: 'Mobil > Satış Ekibi/Rut > Bilgi Alma | Cihaz/Mobil Ortam > Cihaz tarih/saat | Çözüm: Bilgilendirme',
    snow: 'Olay | Kategori: Mobil Cihaz > Tarih/Saat/Senkron | Yapılandırma Öğesi: Cihaz + Panorama Mobil | Etki: Düşük × Aciliyet: Orta → Öncelik: P3 | Kapanış: Kullanıcı Eğitimi | Bilgi Bankası bağlı',
    zen: 'Tip: Olay | Öncelik: Normal | Grup: Mobil Destek | Etiketler: mobil, senkron, tarih-saat, ssl | YZ Niyeti: "Veri senkronu başarısız - cihaz saati"',
    sf: 'Vaka Tipi: Problem | Vaka Nedeni: Teknik/Cihaz | Öncelik: Orta | Konu: Mobil Senkron | Einstein: Bilgi Bankası öner (tarih/saat düzeltme)',
    ft: 'Niyet: "Mobil senkron başarısız - cihaz saati" | İş Akışı: Bilgi Bankası yönlendirme (otomatik tarih-saat aç adımı)',
  },
];

const COLS = [
  ['no', 'Vaka No', 13], ['sorun', 'Sorun Özeti', 46],
  ['biz', 'BİZİM SİSTEM (Panorama)', 50],
  ['snow', 'ServiceNow (ITIL)', 52], ['zen', 'Zendesk AI', 42],
  ['sf', 'Salesforce Einstein', 42], ['ft', 'Forethought / Aisera', 42],
];

const wb = new ExcelJS.Workbook();
const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
const OURS = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CC' } };

const s1 = wb.addWorksheet('Sema Karsilastirma');
s1.addRow(COLS.map((c) => c[1]));
s1.getRow(1).eachCell((c) => { c.fill = HEAD; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { wrapText: true, vertical: 'middle' }; });
s1.getRow(1).height = 30;
for (const d of DATA) {
  const r = s1.addRow(COLS.map((c) => d[c[0]]));
  r.eachCell((cell) => { cell.alignment = { wrapText: true, vertical: 'top' }; });
  r.getCell(3).fill = OURS;
}
s1.columns.forEach((c, i) => { c.width = COLS[i][2]; });
s1.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

const s2 = wb.addWorksheet('Sema Felsefesi');
const PHIL = [
  ['Oyuncu', 'Sınıflandırma Felsefesi', 'Temel Alanlar', 'Güçlü Yön', 'Bizim Farkımız'],
  ['BİZİM SİSTEM (Panorama)', 'Domain-özel: açılış (belirti) + kapanış (kök neden) ayrı; 9 alan', 'Platform · İş Süreci · İşlem Tipi · Etkilenen Nesne · Etki · Kök Neden Grubu · Detay · Çözüm Tipi · Kalıcı Önlem', 'ERP/saha-satış diline tam oturur; hem belirti hem kök neden tek kayıtta', '—'],
  ['ServiceNow (ITIL)', 'Yapılandırma Öğesi (CI) merkezli, ITIL süreçleri (Olay/Talep/Problem/Değişiklik)', 'Kategori > Alt Kategori · Yapılandırma Öğesi · Etki × Aciliyet = Öncelik · Atama Grubu · Kapanış/Çözüm Kodu · Problem Kaydı (Kök Neden)', 'En olgun kök neden + tekrar yönetimi (Problem yönetimi); kurumsal BT standardı', 'Bize en yakın olan; biz "Yapılandırma Öğesi" yerine "Etkilenen Nesne/Ekran" kullanıyoruz, domain daha detaylı'],
  ['Zendesk AI', 'Esnek etiket + Yapay Zeka niyeti; müşteri-deneyimi odaklı', 'Bilet Tipi (Soru/Olay/Problem/Görev) · Öncelik · Etiketler · Grup · Yapay Zeka Niyeti', 'Hızlı, esnek, güçlü niyet tespiti; çok kanallı müşteri deneyimi', 'Etiket-tabanlı esnek ama yapılandırılmış kök-neden taksonomisi zayıf; bizimki daha derin'],
  ['Salesforce Einstein', 'CRM-entegre; Vaka Tipi + Vaka Nedeni seçim listesi + tahminli alanlar', 'Vaka Tipi · Vaka Nedeni · Öncelik · Durum · Konu/Ürün · Einstein tahminli alanlar', 'CRM / 360° müşteri bağlamı; satış-servis entegrasyonu', 'Müşteri-merkezli; teknik kök-neden derinliği bizde daha fazla'],
  ['Forethought / Aisera', 'Niyet-öncelikli + otomasyon; yönlendirme ve otomatik çözüm odaklı', 'Niyet (anlamsal) · İş Akışı/Yönlendirme · Çözüm Yolu · Yönlendirme skoru', 'En yüksek otomasyon/yönlendirme; self-servis yönlendirme', 'Onlar "çöz/yönlendir" odaklı; biz "sınıflandır + kök neden" odaklı — ikisi tamamlayıcı'],
];
PHIL.forEach((row, i) => {
  const r = s2.addRow(row);
  r.eachCell((c) => { c.alignment = { wrapText: true, vertical: 'top' }; });
  if (i === 0) r.eachCell((c) => { c.fill = HEAD; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });
  if (i === 1) r.eachCell((c) => { c.fill = OURS; c.font = { bold: true }; });
});
s2.columns = [{ width: 24 }, { width: 44 }, { width: 52 }, { width: 40 }, { width: 46 }];
s2.views = [{ state: 'frozen', ySplit: 1 }];

// ── Sheet 3: Bizim → ServiceNow Eşleştirme ──
const s3 = wb.addWorksheet('Bizim - ServiceNow');
const LITE2 = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
function section(title) {
  const r = s3.addRow([title]); s3.mergeCells(r.number, 1, r.number, 4);
  r.getCell(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }; r.getCell(1).fill = HEAD;
}
function thead() {
  const r = s3.addRow(['BİZİM (Panorama)', '→', 'ServiceNow Karşılığı', 'Açıklama']);
  r.eachCell((c) => { c.font = { bold: true }; c.fill = LITE2; });
}
function add(a, b, c) { const r = s3.addRow([a, '→', b, c]); r.eachCell((x) => { x.alignment = { wrapText: true, vertical: 'top' }; }); r.getCell(1).font = { bold: true }; }

section('1) ALAN (BOYUT) EŞLEŞTİRME — Taksonomi Yapısı'); thead();
[
  ['Platform', 'CI Sınıfı / Servis bağlamı', 'Backoffice/Mobil ortamı — ServiceNow\'da CI sınıfı veya servis olarak modellenir'],
  ['İş Süreci', 'Kategori (Category)', 'Ana kategori (ör. E-Belge, Mobil, Finans)'],
  ['İşlem Tipi', 'Alt Kategori (Subcategory)', 'Belirti/eylem alt kırılımı'],
  ['Etkilenen Nesne', 'Yapılandırma Öğesi (Configuration Item / CI)', 'Etkilenen bileşen/ekran'],
  ['Etki', 'Etki (Impact)', 'Etki düzeyi (Düşük/Orta/Yüksek)'],
  ['(BİZDE YOK)', 'Aciliyet (Urgency)', '⚠️ Eksik — öncelik hesabı için Aciliyet gerekir; eklenmeli'],
  ['Etki + Aciliyet', 'Öncelik (Priority) = Etki × Aciliyet', '⚠️ Otomatik öncelik matrisi — bizde yok, eklenebilir'],
  ['Kök Neden Grubu', 'Problem > Neden Kategorisi (Cause Category)', 'Kök neden kategorisi (Problem yönetimi)'],
  ['Kök Neden Detayı', 'Kök Neden / Bilinen Hata (Root Cause / Known Error)', 'Kök neden detayı'],
  ['Çözüm Tipi', 'Kapanış/Çözüm Kodu (Close / Resolution Code)', 'Çözüm/kapanış kodu'],
  ['Kalıcı Önlem', 'Problem Çözümü / Kalıcı Düzeltme (Permanent Fix)', 'Kalıcı çözüm (Problem kaydı)'],
].forEach(([a, b, c]) => add(a, b, c));
s3.addRow([]);

section('2) KÖK NEDEN GRUBU EŞLEŞTİRME — Değerler'); thead();
[
  ['Kullanım / Eğitim', 'Kullanıcı Hatası / Eğitim (User Error/Education)', 'Bilgi veya eğitim eksikliği'],
  ['Parametre / Konfigürasyon', 'Yapılandırma (Configuration / Setup)', 'Parametre/kurulum ayarı kaynaklı'],
  ['Cihaz / Mobil Ortam', 'Donanım / Uç Birim (Hardware/Endpoint)', 'Cihaz/mobil uç birim kaynaklı'],
  ['E-Belge / Entegratör (3. parti)', '3. Parti / Tedarikçi (Third-party/Vendor)', 'Entegratör/tedarikçi kaynaklı'],
  ['Ana Veri / Kart Tanımı', 'Ana Veri (Master Data)', 'Kart/ana veri eksikliği'],
  ['Yazılım Hatası', 'Yazılım Hatası → Bilinen Hata (Software Bug/Known Error)', 'Uygulama hatası / bilinen hata'],
  ['Entegrasyon / Aktarım', 'Entegrasyon / Arayüz (Integration/Interface)', 'Aktarım/arayüz sorunu'],
  ['Dizayn / Matbu / Baskı', 'Çıktı / Baskı / Şablon (Output/Print/Template)', 'Belge dizayn/baskı kaynaklı'],
  ['Hesaplama / İş Kuralı', 'İş Kuralı / Hesaplama (Business Logic)', 'İş kuralı/hesaplama kaynaklı'],
  ['Sunucu / Altyapı / Performans', 'Altyapı / Kapasite / Performans (Infrastructure)', 'Sunucu/altyapı/performans kaynaklı'],
  ['Veri Tutarsızlığı', 'Veri Bütünlüğü (Data Integrity)', 'Tutarsız/bozuk kayıt'],
  ['Veri / Veritabanı Hatası', 'Veritabanı (Database)', 'Veritabanı seviyesi hata'],
  ['Yetki / Rol', 'Erişim / Kimlik (Access/Identity – IAM)', 'Yetki/rol/erişim kaynaklı'],
  ['Kurulum', 'Yazılım Dağıtım / Kurulum (Software Deployment)', 'Uygulama kurulum/dağıtım'],
].forEach(([a, b, c]) => add(a, b, c));
s3.addRow([]);

section('3) ÇÖZÜM TİPİ EŞLEŞTİRME — Kapanış Kodları'); thead();
[
  ['Bilgilendirme', 'Uzaktan Çözüldü / Bilgi Verildi (Solved Remotely)', 'Müşteriye bilgi verilerek çözüldü'],
  ['Parametre düzeltme', 'Yapılandırma Değişikliği (Configuration Change)', 'Parametre/ayar değiştirildi'],
  ['Yetki düzenleme', 'Erişim Verildi / Değiştirildi (Access Modified)', 'Yetki/erişim düzenlendi'],
  ['Veri / kart düzeltme', 'Veri Düzeltme (Data Correction)', 'Kayıt/veri düzeltildi'],
  ['Script çalıştırma (DbUpdate)', 'Geçici Çözüm / Script (Workaround)', 'DB script ile düzeltildi'],
  ['Entegratör / servis müdahalesi', 'Tedarikçi Çözdü (Vendor Resolved)', 'Entegratör/servis tarafında çözüldü'],
  ['Dizayn düzeltme', 'Şablon / Çıktı Düzeltme (Template Fix)', 'Belge/şablon düzeltildi'],
  ['DLL Geçişi / Versiyon geçişi', 'Yama / Sürüm Yükseltme (Patch/Upgrade)', 'DLL/sürüm güncellendi'],
  ['Eğitim', 'Kullanıcı Eğitimi (User Education/Training)', 'Kullanıcıya eğitim verildi'],
  ['Doküman / SSS', 'Bilgi Bankası Makalesi (Knowledge Article)', 'Doküman/SSS yönlendirmesi'],
  ['Ürün geliştirme', 'Geliştirme / Değişiklik Talebi (Enhancement/Change)', 'Geliştirme talebine dönüştürüldü'],
].forEach(([a, b, c]) => add(a, b, c));

s3.addRow([]);
section('4) KÖK NEDEN DETAYI EŞLEŞTİRME — 61 Değer (grup bazında)'); thead();
function gsub(g) { const r = s3.addRow([g, '', '', '']); s3.mergeCells(r.number, 1, r.number, 4); r.getCell(1).font = { bold: true, italic: true }; r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; }
const DETAILMAP = {
  'Yetki / Rol': [['Menü yetkisi eksik', 'Erişim: Menü Yetkisi (Access)', 'Kullanıcının ilgili menüye erişim yetkisi yok'], ['İşlem yetkisi eksik', 'Erişim: İşlem Yetkisi (Access)', 'Belirli işlemi yapma yetkisi tanımlı değil'], ['Distribütör / şube yetkisi eksik', 'Erişim: Kapsam/Şube Yetkisi (Access Scope)', 'Görülebilir distribütör/şube kapsamı eksik'], ['Onay yetkisi yok', 'Erişim: Onay Yetkisi (Approval Authority)', 'Onaylama/yetkilendirme rolü yok'], ['Lisans limiti dolu', 'Lisans: Limit Doldu (Entitlement)', 'Lisans/kullanıcı sayısı sınırına ulaşıldı'], ['Rol / kullanıcı tanımsız', 'Kimlik: Rol/Kullanıcı Tanımsız (Identity)', 'Kullanıcı veya rol sistemde tanımlı değil']],
  'Parametre / Konfigürasyon': [['E-Belge ayarı / entegratör şifresi', 'Yapılandırma: Entegrasyon/Kimlik Ayarı (Config)', 'E-belge/entegratör bağlantı ayarı hatalı'], ['Aktarım (SmartConnect) parametresi', 'Yapılandırma: Entegrasyon Parametresi (Config)', 'SmartConnect aktarım parametresi hatalı'], ['Matbu / basım parametresi', 'Yapılandırma: Baskı/Belge Parametresi (Config)', 'Matbu/basım ayarı eksik veya yanlış'], ['ST parametresi eksik', 'Yapılandırma: Eksik Modül Parametresi (Config)', 'Saha/ST modülü parametresi tanımlı değil'], ['Yanlış parametre', 'Yapılandırma: Hatalı Parametre Değeri (Config)', 'Parametre yanlış değere ayarlı'], ['Eksik parametre', 'Yapılandırma: Eksik Parametre (Config)', 'Gerekli parametre boş/tanımsız']],
  'Ana Veri / Kart Tanımı': [['Müşteri kartı eksik / hatalı', 'Ana Veri: Müşteri Kaydı Eksik (Master Data)', 'Müşteri kartında eksik/hatalı bilgi'], ['Ürün / stok kartı eksik', 'Ana Veri: Ürün/Stok Kaydı Eksik (Master Data)', 'Ürün veya stok kartı tanımlı değil'], ['Fiyat / KDV tanımı hatalı', 'Ana Veri: Fiyat/KDV Tanımı (Master Data)', 'Fiyat veya KDV tanımı yanlış'], ['Satış temsilcisi tanımı hatalı', 'Ana Veri: ST Kaydı Hatalı (Master Data)', 'Satış temsilcisi tanımı eksik/yanlış'], ['Eksik kart ilişkisi (depo / sevk / seri)', 'Ana Veri: Eksik İlişki (Master Data)', 'Depo/sevk/seri kart ilişkisi kurulmamış']],
  'E-Belge / Entegratör (3. parti)': [['Entegratör servis / şifre / kontör', '3. Parti: Servis/Şifre/Kontör (3rd-Party)', 'Entegratör erişim/şifre/kontör sorunu'], ['Mükellefiyet / sertifika', '3. Parti: Mükellefiyet/Sertifika (Compliance)', 'GİB mükellefiyet veya mali mühür/sertifika'], ['XSLT şablon eksik', 'Çıktı: XSLT Şablon Eksik (Template)', 'E-belge XSLT dizayn şablonu yok'], ['GİB / Schematron hatası', '3. Parti: Mevzuat Doğrulama (Schematron)', 'GİB Schematron şema doğrulama hatası'], ['Entegratör kuyruk gecikmesi', '3. Parti: Kuyruk/İşlem Gecikmesi (Queue Delay)', 'Entegratör tarafında işlem kuyruğu gecikmesi'], ['Ödeme/Sanal POS Altyapısı', '3. Parti: Ödeme/POS Altyapısı (Payment)', 'Sanal POS/ödeme altyapısı sorunu'], ['ERP (Logo, SAP vb.)', '3. Parti: ERP Entegrasyonu (ERP)', 'Logo/SAP gibi ERP entegrasyon sorunu'], ['Unidox V1 / V2 geçişi', '3. Parti: Tedarikçi Sürüm Geçişi (Vendor Migration)', 'Unidox V1→V2 entegratör sürüm geçişi']],
  'Entegrasyon / Aktarım': [['Eşleştirme eksik', 'Entegrasyon: Eşleştirme Eksik (Mapping)', 'Aktarım eşleştirme tanımı yapılmamış'], ['Web servis / view hatası', 'Entegrasyon: Web Servis/View Hatası', 'Web servis veya veritabanı view hatası'], ['Servis timeout', 'Entegrasyon: Servis Zaman Aşımı (Timeout)', 'Servis yanıt vermedi/zaman aşımı'], ['Alan eşleşmesi hatalı', 'Entegrasyon: Alan Eşleşmesi Hatalı (Field Mapping)', 'Aktarımda alan eşleştirmesi yanlış']],
  'Cihaz / Mobil Ortam': [['APK versiyon uyumsuz', 'Uç Birim: Uygulama Sürüm Uyumsuz (App Version)', 'Mobil APK sürümü uyumsuz'], ['Cihaz bağlantısı / eşleştirme', 'Uç Birim: Cihaz Bağlantı/Eşleştirme (Connectivity)', 'Cihaz bağlantı/eşleştirme sorunu'], ['Dosya indirilemiyor', 'Uç Birim: Dosya İndirilemiyor (Download)', 'Mobilde dosya/güncelleme inmiyor'], ['Cihaz tarih / saat', 'Uç Birim: Cihaz Tarih/Saat (Date/Time)', 'Cihaz saati yanlış, SSL doğrulaması bozuluyor']],
  'Yazılım Hatası': [['Görev çalışmıyor (object reference)', 'Yazılım Hatası: Nesne Referansı (Null Reference)', 'Boş nesne referansı kaynaklı uygulama çökmesi'], ['Versiyon uyumsuzluğu (Fix-DLL)', 'Yazılım: Sürüm/DLL Uyumsuzluğu', 'DLL/sürüm uyumsuzluğu, fix gerekli'], ['Validasyon hatası', 'Yazılım Hatası: Doğrulama Kusuru (Validation)', 'Hatalı veya eksik validasyon kuralı'], ['Kod hatası', 'Yazılım Hatası: Kod Kusuru (Code Defect)', 'Uygulama kod hatası']],
  'Dizayn / Matbu / Baskı': [['Belge dizaynı eksik / hatalı', 'Çıktı: Belge Dizayn Hatası (Output)', 'Belge dizaynı eksik/yanlış'], ['Matbu no / sıra', 'Çıktı: Matbu No/Sıra (Form Number)', 'Matbu numara/sıralama sorunu'], ['Yazıcı / logo basım ayarı', 'Çıktı: Yazıcı/Logo Ayarı (Print Setting)', 'Yazıcı veya logo basım ayarı']],
  'Hesaplama / İş Kuralı': [['İskonto / promosyon', 'İş Kuralı: İskonto/Promosyon (Business Logic)', 'İskonto/promosyon hesabı veya kuralı'], ['Fiyat', 'İş Kuralı: Fiyatlandırma (Pricing)', 'Fiyat hesaplama/iş kuralı'], ['KDV / muafiyet', 'İş Kuralı: KDV/Muafiyet (Tax)', 'KDV veya muafiyet kuralı'], ['Gecikme / kredi limiti', 'İş Kuralı: Kredi/Gecikme Limiti (Credit)', 'Kredi limiti veya gecikme kuralı']],
  'Sunucu / Altyapı / Performans': [['Yavaşlık / timeout (internet)', 'Ağ: Gecikme/Zaman Aşımı (Network)', 'İnternet/ağ kaynaklı yavaşlık'], ['Disk / temp yetersizliği', 'Kapasite: Disk/Temp Alanı (Capacity)', 'Disk veya geçici alan yetersiz'], ['RAM / kaynak tüketimi', 'Kapasite: Bellek/Kaynak (Memory)', 'RAM/kaynak tüketimi yüksek'], ['Replikasyon durması', 'Altyapı: Replikasyon Hatası (Replication)', 'Veri replikasyonu durdu'], ['Giriş / sunucu hatası', 'Altyapı: Sunucu/Giriş Hatası (Server)', 'Sunucu veya giriş seviyesi hata'], ['Sql Server DB sorunu', 'Veritabanı: SQL Server Sorunu (Database)', 'SQL Server veritabanı kaynaklı sorun']],
  'Kullanım / Eğitim': [['Kullanıcı işlem adımı hatası', 'Kullanıcı Hatası: İşlem Adımı (Procedure)', 'Kullanıcı işlem adımını yanlış yaptı'], ['Yasal süreç (8 gün / ay kapanışı)', 'Bilgi: Yasal Süreç (Regulatory)', 'Yasal süre/ay kapanışı kuralı'], ['Operatörlük / merkez onayı gereken işlem', 'Süreç: Merkez Onayı Gerekli (Approval)', 'İşlem merkez/operatör onayı gerektiriyor'], ['Bilgi / nasıl yapılır', 'Bilgi Eksikliği: Nasıl Yapılır (How-To)', 'Kullanıcı işlemi bilmiyor, bilgilendirme gerekli']],
  'Veri Tutarsızlığı': [['Bozuk kayıt (stok tipi / belge detayı)', 'Veri Bütünlüğü: Bozuk Kayıt (Corrupt)', 'Stok tipi/belge detayı bozuk kayıt'], ['Mükerrer kayıt', 'Veri Bütünlüğü: Mükerrer Kayıt (Duplicate)', 'Çift/mükerrer kayıt'], ['Eksik ilişki', 'Veri Bütünlüğü: Eksik İlişki (Missing Relation)', 'Kayıtlar arası ilişki eksik'], ['Elle müdahale / geçmiş veri', 'Veri Bütünlüğü: Elle/Geçmiş Veri (Manual/Legacy)', 'Elle müdahale veya eski veri kaynaklı']],
  'Veri / Veritabanı Hatası': [['Update ve insert işlemi', 'Veritabanı: Update/Insert İşlemi (Database)', 'DB update/insert ile düzeltme gerekti'], ['Eksik/Hatalı Master Data (Ürün, Müşteri, Fiyat Listesi)', 'Veritabanı/Ana Veri: Eksik/Hatalı (Master Data)', 'Ürün/müşteri/fiyat ana verisi eksik veya hatalı']],
  'Kurulum': [['Kurulum', 'Yazılım Kurulum/Dağıtım (Installation)', 'Mobil/uygulama kurulum ve dağıtımı']],
};
for (const [g, list] of Object.entries(DETAILMAP)) { gsub(g); list.forEach(([d, s, a]) => add(d, s, a)); }

s3.getColumn(1).width = 38; s3.getColumn(2).width = 4; s3.getColumn(3).width = 50; s3.getColumn(4).width = 46;
s3.views = [{ state: 'frozen', ySplit: 0 }];

const desk = path.join(os.homedir(), 'Desktop');
let out = null;
for (const name of ['Ticket-Dunya-Semalari-Karsilastirma.xlsx', 'Ticket-Dunya-Semalari-TR.xlsx']) {
  try { await wb.xlsx.writeFile(path.join(desk, name)); out = path.join(desk, name); break; }
  catch (e) { if (e.code !== 'EBUSY') throw e; console.log('(kilitli: ' + name + ')'); }
}
console.log('10 vaka × 5 sema — Turkce. Excel: ' + out);
