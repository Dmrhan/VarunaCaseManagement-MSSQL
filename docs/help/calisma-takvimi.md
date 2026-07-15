# Çalışma Takvimi — Yardım Dokümanı

*Hedef kitle: Sistem Yöneticisi (ekran yönetimi) + tüm kullanıcılar (ekranlarda ne değişir). Son güncelleme: 14.07.2026*

## Bu özellik ne işe yarar?

SLA süreleri artık **mesai saatine göre** hesaplanabilir. Müşteri sözleşmelerimiz "tüm süreler mesai saatidir" der; bu ekran o taahhüdün sistemdeki karşılığıdır. Takvim tanımlanıp devreye alındığında:

- Cuma 17:00'de açılan 6 saatlik kritik vaka, hafta sonunu "yemez" — hedefi Pazartesi mesaisine taşar.
- Geceler, hafta sonları ve resmî tatiller SLA sayacına **dahil edilmez**.
- Öğle molası (12:00–13:00) da sayılmaz — günlük net mesai 8,5 saattir.

> **Önemli:** Takvimi tanımlamak tek başına hiçbir hesabı değiştirmez. Değişim, **kesim tarihi** girildiği an başlar (aşağıda).

## Ekran: Ayarlar › Tanımlar › Çalışma Takvimi

*Yalnız Sistem Yöneticisi görür. Takvim **şirket bazındadır** — Univera, Param ve Finrota'nın takvimleri ayrı ayrı tanımlanır.*

### 1. Şirket seçin
Üstteki şirket seçiciden takvimini düzenleyeceğiniz şirketi seçin. Her şirketin kaydı bağımsızdır.

### 2. Mesai günleri ve saatleri
Haftanın her günü için aç/kapa anahtarı + başlangıç/bitiş saati (24 saat biçiminde, 15 dakika adımlı). Tipik kurulum: Pazartesi–Cuma 08:30–18:00.

### 3. Öğle molası
Tek mola tanımı tüm çalışma günlerine uygulanır (örn. 12:00–13:00). Ekran, haftalık **net** mesaiyi (mola düşülmüş) canlı gösterir.

### 4. Resmî tatiller
- **🇹🇷 TR tatillerini ekle:** seçilen yılın resmî tatillerini (dinî bayramlar dahil) tek tıkla işler. Arifeler otomatik **yarım gün** gelir (mesai 13:00'te biter). Dinî bayram tarihleri resmî ilana dayalıdır — içe aktardıktan sonra listeyi gözden geçirin.
- **Elle ekleme:** ay ızgarasında güne tıklayın (tarih kutusuna işlenir), ad verin, gerekirse "yarım gün" işaretleyin, ekleyin.
- **Başka şirketten kopyala:** tatil listesini diğer şirketin takviminden aynen alır.
- Her tatil listeden tek tek silinebilir/düzeltilebilir.

### 5. SLA duraklatma kuralları
- **Müşteri yanıtı beklenirken sayaç dursun:** açılırsa, ajan müşteriye yanıt verdiğinde çözüm sayacı durur; müşteri dönünce hedef, beklenen süre kadar ileri kayarak devam eder. **Varsayılan kapalıdır.** (3. parti beklemelerindeki duraklatma bundan bağımsızdır ve tanım bazında yönetilir.)

### 6. Örnek hesap
Ekranın altındaki örnek hesap kutusu, taslak takviminizle "şu an açılan X saatlik vaka ne zaman dolar?" sorusunu **sunucudan** hesaplayıp gösterir — kaydetmeden deneyebilirsiniz.

### 7. Kesim tarihi — geçiş düğmesi
Takvim ancak **kesim tarihi** girildiğinde hesaplara girer:
- Kesim tarihi **boşsa**: hiçbir hesap değişmez, sistem eski (takvimsiz) düzende çalışır.
- Kesim tarihi girildiğinde: o tarihten sonra açılan vakalar mesai saatiyle hesaplanır. Kesimden **önce** açılmış vakalar eski düzeninde kalır (geçmiş kayıtların anlamı değişmez) — yönetim isterse ayrıca toplu güncelleme yapılır ve duyurulur.

## Ekranlarda ne değişir?

- Vaka listesi ve detayındaki kalan süre etiketleri mesai temelli olur: **"3 iş-sa kaldı"**, **"2 iş günü kaldı"** ("iş" ibaresi, duvar-saatiyle karışmaması içindir).
- SLA İzleme panosundaki Hedef / Geçen / Kalan kolonları iş-saati sayar; "gün" birimi **net iş günü**dür (8,5 saat).
- İhlal (kırmızı) mantığı aynıdır — yalnızca hedef tarihler artık mesai gerçeğine göre atılır.

## Sık sorulanlar

**Takvimi pasife alırsam ne olur?** Şirket, takvimsiz (eski) düzene döner; duraklatma kuralları da devre dışı kalır. Güvenli kapatma anahtarıdır.

**Sözleşmede "26 iş günü" 8 saatlik güne göre; bizim günümüz 8,5 saat — çelişki mi?** Hayır. Sistemin tek doğruluk kaynağı **dakikadır**; "gün" yalnız gösterim birimidir. Sözleşme değerleri dakika olarak girilir, karşılaştırma her zaman dakikayla yapılır.

**Yeni yılın dinî bayramları içe aktarımda görünmüyor.** Tablo yıllık güncellenir; resmî ilan yayımlanınca sisteme eklenir. O yılın tatillerini elle de girebilirsiniz.
