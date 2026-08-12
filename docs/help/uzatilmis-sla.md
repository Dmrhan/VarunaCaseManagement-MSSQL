# Uzatılmış SLA (Yazılım Geliştirme Devri) — Yardım Dokümanı

*Hedef kitle: Sistem Yöneticisi (kurulum) + ajanlar/süpervizörler (günlük kullanım). Son güncelleme: 14.07.2026*

## Bu özellik ne işe yarar?

Müşteri SLA taahhüdümüzde iki rejim vardır: standart çözüm süresi ve vakanın **yazılım geliştirme/bakım tarafına devredilmesi** hâlinde geçerli olan **uzatılmış toplam süre**. Bugüne kadar bu ayrım raporlarda elle düzeltiliyordu; artık sistem kendisi uygular:

| Öncelik | Standart çözüm | Uzatılmış toplam (devirde) |
|---|---|---|
| Kritik | 360 dk | 1.830 dk (~3,6 iş günü) |
| Yüksek | 960 dk | 3.480 dk (~6,8 iş günü) |
| Orta / Düşük | 1.440 dk | 12.480 dk (~24,5 iş günü) |

*Tüm süreler mesai dakikasıdır ve **vaka açılışından itibaren toplam** süredir (standartın üstüne ek değildir).*

## Ne zaman devreye girer? (iki koşul)

Bir vakanın hedefi uzatılmış süreye çıkar **ancak ve ancak**:

1. Vaka, **"uzatılmış çözüm süresi uygular"** anahtarı açık bir 3. parti tanımına devredilirse (bizde: *Yazılım Bakım Ekibinde*), **ve**
2. O tanımda "Ek şart: DevOps kaydı bulunmalı" açıksa (bizde açık) vakada **DevOps iş kaydı bağlıysa**.

İki koşuldan biri eksikse hiçbir şey değişmez. Koşul sonradan tamamlanırsa (örn. vaka baкımdayken DevOps kaydı bağlanırsa) uzatma o an devreye girer.

## Ajan için: günlük akış

1. Sorunun yazılım hatası olduğuna karar verdin → **DevOps iş kaydını vakaya bağla** (vaka detayı › DevOps bölümü).
2. Vakayı **"3. Parti Bekleniyor › Yazılım Bakım Ekibinde"** durumuna al.
3. Sistem o an: çözüm hedefini uzatılmış toplam süreye günceller, vaka kırmızıdaysa ve yeni hedefe göre gecikmemişse **ihlal bayrağını geri çeker**, vaka geçmişine iz düşer.
4. Vaka detayındaki SLA panelinde mor rozeti görürsün: **"⏱ Uzatılmış SLA — Yazılım Geliştirme devri · hedef 1.830 dk"**.

> **DevOps kaydı bağlamayı unutursan** hedef uzamaz ve vaka standart süreye göre kırmızıya düşer. Sıra önemli değil (önce devir sonra kayıt da olur) ama **ikisi de şart**.

## Bilinmesi gereken kurallar

- **Tek yön:** hedef bir kez uzatıldıktan sonra geri daralmaz — vaka geliştirmeden geri dönse veya DevOps kaydı silinse bile uzatılmış hedef korunur. Neden: sözleşmedeki süre, devrin gerçekleşmiş olmasına bağlanmıştır; iz vaka geçmişindedir.
- **İzlenebilirlik:** her uzatma vaka geçmişine "SLA hedefi uzatıldı: 360 dk → 1.830 dk (…tanım adı + DevOps no…)" olarak, kim/ne zaman bilgisiyle yazılır.
- **Duraklamalarla ilişki:** 3. parti veya müşteri-bekleme duraklamalarında biriken süreler uzatılmış hedefin üstüne ayrıca eklenir — çifte sayım olmaz.
- **Müdahale (ilk yanıt) SLA'sı etkilenmez** — uzatma yalnız çözüm hedefine uygulanır.

## Sistem Yöneticisi için: kurulum (iki ekran)

1. **Ayarlar › Tanımlar › SLA Kuralları:** ilgili kural satırında **"Uzatılmış Çözüm (dk)"** alanını doldurun (alan altında iş-günü karşılığı otomatik görünür). **Boş bırakılan satırda uzatma yoktur** — tanım tetiklense bile davranış değişmez.
2. **Ayarlar › Tanımlar › 3. Parti Tanımları:** ilgili tanımda **"Uzatılmış çözüm süresi uygular"** anahtarını açın; gerekiyorsa **"Ek şart: vakada DevOps kaydı bulunmalı"** seçeneğini ayarlayın.

> Kural, tanımın **adına değil kaydına** bağlıdır: tanımın adını değiştirmek davranışı bozmaz. İleride başka bir tanım için (örn. DevOps şartsız) uzatma açmak kod değişikliği gerektirmez — iki anahtar yeterlidir.

## Sık sorulanlar

**Bakımdaki vaka panoda nasıl görünür?** Bekleyen Bölüm = "Yazılım Bakım Ekibinde"; Hedef kolonu uzatılmış süreyi gösterir; ihlal kıyası uzatılmış hedefe göredir.

**Vaka bakımda ama hedefi uzamamış — neden?** İki olağan sebep: DevOps kaydı bağlı değil (en sık) veya o vakanın SLA kural satırında uzatılmış süre boş. Vaka geçmişinde uzatma kaydı yoksa tetik hiç oluşmamıştır.

**Önceliği sonradan değişen vakada uzatılmış hedef değişir mi?** Hayır — mevcut sistem kuralıyla tutarlı olarak hedefler öncelik değişiminde yeniden hesaplanmaz. Uzatma, devir anındaki kural satırından okunur.

**Bu özellik ne zaman devrede?** Kurulum (süre matrisi + tanım anahtarları) yönetim onayıyla, Çalışma Takvimi geçişinden **sonra** yapılır — süreler mesai dakikası olduğundan önce takvimin devrede olması gerekir. Devreye alınırken bakımda bekleyen mevcut vakalar da toplu güncellenir ve duyurulur.
