import type { HelpContent } from '@/components/ui/HelpDrawer';

export const CATEGORIES_HELP: HelpContent = {
  title: 'Kategori & Alt Kategori',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Vaka açılırken seçilen Kategori ve Alt Kategori alanları buradan yönetilir. Doğru kategori yapısı SLA kurallarının ve kontrol listelerinin otomatik devreye girmesini sağlar.',
    },
    {
      heading: 'Nasıl yapılandırılır?',
      content:
        'Önce Ana Kategori oluşturun, sonra o kategorinin altına Alt Kategoriler ekleyin. Vaka formunda Kategori seçilince yalnızca o kategoriye bağlı alt kategoriler listelenir.',
      example: `Ana Kategori: Ödeme Sistemleri
  └── Alt Kategori: 3D Secure Hatası
  └── Alt Kategori: Provizyon Reddedildi
  └── Alt Kategori: İade Talebi`,
    },
    {
      heading: 'Pasifleştirme',
      content:
        'Bir kategoriyi silmek yerine pasifleştirin. Pasif kategoriler yeni vakalarda görünmez ama mevcut vakalar etkilenmez.',
      warning: 'Alt kategorisi olan bir kategoriyi silemezsiniz. Önce alt kategorileri pasifleştirin.',
    },
  ],
};

export const SLA_HELP: HelpContent = {
  title: 'SLA Kuralları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Her vaka açıldığında sistem, vakanın Şirket + Ürün Grubu + Kategori + Alt Kategori + Talep Türü kombinasyonuna bakarak bu tablodan SLA sürelerini otomatik hesaplar.',
    },
    {
      heading: '5\'li kombinasyon mantığı',
      content:
        'Bir kural beş boyutun kesişim noktasında çalışır. Aynı kombinasyon için iki kural tanımlanamaz.',
      example: `Şirket      : PARAM
Ürün Grubu  : Fiziki POS
Kategori    : Ödeme Sistemleri
Alt Kategori: 3D Secure Hatası
Talep Türü  : Şikayet
─────────────────────────────
Yanıt Süresi  : 4 saat
Çözüm Süresi  : 24 saat`,
    },
    {
      heading: 'SLA duraklatma',
      content:
        '3rd Party Bekleniyor statüsüne geçildiğinde SLA sayacı otomatik duraksatılır. Statüden çıkılınca kaldığı yerden devam eder ve duraklatılan süre çözüm tarihine eklenir.',
      tip:
        'Kurala uymayan kombinasyonlar için sistem Priority bazlı varsayılan SLA kullanır. Bu nedenle tüm önemli kombinasyonlar için kural tanımlamanız önerilir.',
    },
    {
      heading: 'Yanıt vs Çözüm süresi',
      content:
        'Yanıt Süresi: Vakanın ilk kez incelemeye alınması gereken süre. Çözüm Süresi: Vakanın tamamen çözülerek kapatılması gereken toplam süre. Çözüm süresi her zaman yanıt süresinden büyük olmalıdır.',
    },
  ],
};

export const THIRD_PARTY_HELP: HelpContent = {
  title: '3. Parti Tanımları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Bir vaka 3rdPartyBekleniyor statüsüne geçtiğinde hangi dış tarafın bekleniyor olduğu bu listeden seçilir. Örnek: Hukuk Departmanı, BKM, Teknik Ekip.',
    },
    {
      heading: 'Ne zaman kullanılır?',
      content:
        'Vaka çözümü için ekip dışında bir tarafın aksiyonu gerektiğinde 3rdPartyBekleniyor statüsüne geçilir ve buradan ilgili 3. parti seçilir. Bu süre boyunca SLA sayacı durur.',
      example: `Vaka: POS cihazı arızası
3. Parti: Teknik Servis Ekibi
→ SLA duraklatılır, servis ekibi
  müdahale edene kadar süre işlemez`,
    },
    {
      heading: 'Pasifleştirme',
      content:
        'Kullanımda olan bir 3. partiyi silmek yerine pasifleştirin. Mevcut vakalardaki referans korunur, sadece yeni geçişlerde görünmez.',
    },
  ],
};

export const DOCUMENT_HELP: HelpContent = {
  title: 'Belge Türü Tanımları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Vakalara dosya yüklenirken hangi belge türünün yüklendiği bu listeden seçilir. Dosya yükleme ekranında dropdown olarak görünür.',
    },
    {
      heading: 'Örnek tipler',
      content:
        'Aşağıdaki gibi yaygın doküman tipleri tanımlanabilir. Her tür vaka detayında dropdown olarak listelenir.',
      example: `✓ Kimlik Fotokopisi
✓ İmza Sirküleri
✓ Banka Ekstresi
✓ Sözleşme Kopyası
✓ Yazışma Kaydı`,
      tip: 'Tüm aktif belge türleri tüm vakalarda görünür. Şirket veya kategoriye göre filtreleme ileri faz kapsamındadır.',
    },
  ],
};

export const CHECKLIST_HELP: HelpContent = {
  title: 'Kontrol Listesi Tanımları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Bir vaka açıldığında Şirket + Ürün Grubu + Kategori kombinasyonuna göre eşleşen kontrol listesi otomatik vakaya yüklenir. Agent listedeki maddeleri takip ederek süreci yönetir.',
    },
    {
      heading: 'Eşleşme mantığı',
      content:
        'Her kombinasyon için yalnızca bir şablon tanımlanabilir. Eşleşme sırası: tam eşleşme önce, daha sonra genel (alt kategori belirtilmemiş) kurallar.',
      example: `Şablon: PARAM / Fiziki POS / Kurulum
Maddeler:
  □ Müşteri kimliği doğrulandı        [Zorunlu]
  □ Cihaz seri numarası alındı        [Zorunlu]
  □ Kurulum adresi teyit edildi       [Zorunlu]
  □ Teknik servis randevusu oluşturuldu
  □ Müşteri bilgilendirme yapıldı`,
    },
    {
      heading: 'Madde yönetimi',
      content:
        '↑↓ butonlarıyla madde sırasını değiştirebilirsiniz. Zorunlu olarak işaretlenen maddeler vaka kapatılmadan önce tamamlanmış olmalıdır (FAZ 3 ile aktif olacak).',
      warning:
        'Aynı kombinasyon için ikinci bir şablon tanımlayamazsınız. Mevcut şablonu düzenleyin veya pasifleştirip yeni bir tane oluşturun.',
    },
  ],
};

export const TEAMS_HELP: HelpContent = {
  title: 'Takım Tanımları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Vaka atama ekranında görünen takımlar ve takım üyeleri buradan yönetilir. Bir takım seçildiğinde Atanan Kişi listesi otomatik o takımın üyelerine filtrelenir.',
    },
    {
      heading: 'Üye yönetimi',
      content:
        'Bir kişi aynı anda yalnızca bir takımda yer alabilir. Başka takımdan transfer ederek üye ekleyebilirsiniz.',
      tip: 'Aktif vakası olan bir kişiyi pasifleştiremezsiniz. Önce vakalarını başka birine devredin.',
    },
    {
      heading: 'Takım yapısı önerisi',
      content:
        'Vaka tipine göre takım kurmak vaka akışını hızlandırır. Aşağıdaki yapı yaygın olarak kullanılır.',
      example: `Destek Takımı    → Genel Destek vakaları
Backoffice       → Eskalasyon vakaları
CS Ekibi         → Proaktif Takip + Churn
Teknik Ekip      → Hata kategorisi vakaları`,
    },
  ],
};

export const OFFERED_SOLUTIONS_HELP: HelpContent = {
  title: 'Teklif Tanımları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Churn vakalarında müşteriye sunulabilecek teklif seçenekleri buradan yönetilir. Agent vaka formunda bu listeden bir veya birden fazla teklif seçer.',
    },
    {
      heading: 'Örnek teklifler',
      content:
        'Aşağıdaki gibi retention teklifleri tanımlanabilir. Her teklif Churn vakalarında çoklu seçim listesinde görünür.',
      example: `✓ %10 Komisyon İndirimi (3 ay)
✓ %25 Komisyon İndirimi (1 ay)
✓ 1 Ay Ücretsiz Kullanım
✓ Ücretsiz Paket Yükseltme
✓ Ek Kullanıcı Hakkı (5 kişi)`,
      tip:
        'Kullanımda olan bir teklifi silmek yerine pasifleştirin. Pasif teklifler yeni vakalarda seçilemez ama geçmiş vakalarda kaydı korunur.',
      warning:
        'Teklif silinirse o teklifin ID\'sini kullanan eski vakalarda "Bilinmeyen teklif" görünebilir.',
    },
  ],
};

export const FIELDS_HELP: HelpContent = {
  title: 'Dinamik Alanlar',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Şirket bazında vakalara eklenecek özel alanları tanımla. Tanımlanan alanlar yeni vaka açma formunda ve vaka detayında otomatik olarak görünür ve düzenlenebilir.',
    },
    {
      heading: 'Alan tipi seçenekleri',
      content:
        'Doğru tip seçimi formdaki davranışı belirler. Yanlış tip seçilirse veri tutarsız olur.',
      example: `Metin (kısa)    → tek satır metin (örn. "Şube Kodu")
Metin (uzun)    → çok satır textarea
Sayı            → numerik değer (örn. "Tahmini Tutar")
Tarih           → takvim seçici (örn. "Sözleşme Bitiş")
Seçim listesi   → dropdown (örn. "Müşteri Segmenti")
Evet/Hayır      → checkbox`,
    },
    {
      heading: 'Field Key vs Etiket',
      content:
        'Etiket kullanıcının gördüğü ad. Field Key DB\'ye kaydedilen anahtar — değiştirilirse o anahtarla yazılmış mevcut veri görünmez olur. İlk tanımlamada doğru seçin.',
      example: `Etiket    : "Müşteri Segmenti"
Field Key : "customer_segment"`,
      warning:
        'Field Key oluşturduktan sonra değiştirmeyin. Değiştirirseniz eski vakalarda alan boş görünür (veri kaybolmuş gibi).',
    },
    {
      heading: 'Vaka tipi filtresi',
      content:
        'Bir alanı yalnızca belirli vaka tiplerinde (Genel Destek / Proaktif Takip / Churn) göstermek istersen bu filtreyi kullan. "Tüm vaka tipleri" seçilirse her formda görünür.',
    },
    {
      heading: 'Sıra ve zorunluluk',
      content:
        'Display Order küçükten büyüğe sıralar — formda yukarıdan aşağıya bu sıraya göre çıkar. Zorunlu işaretli alanlar boş bırakılırsa vaka kaydedilmez.',
      tip:
        'Aynı şirkette aynı Field Key ile iki tanım olamaz. Farklı şirketlerde aynı key kullanılabilir.',
    },
    {
      heading: 'Pasifleştirme / silme',
      content:
        'Sil butonu hard delete yapmaz — alanı pasifleştirir. Yeni vakalarda görünmez, ama mevcut vakalardaki değerler DB\'de korunur. Tamamen silinmesi istenirse Supabase Dashboard\'dan manuel.',
    },
  ],
};

export const COMPANY_SETTINGS_HELP: HelpContent = {
  title: 'Şirket Ayarları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Her şirket için marka kimliği ve operasyonel yapılandırma. Logo, accent renk ve uygulama adı şirket bazında özelleştirilir; çok kiracılı (multi-tenant) görsel ayrım sağlar.',
    },
    {
      heading: 'Birincil renk',
      content:
        'Buton, link, vurgu rengi olarak kullanılır. Hex formatında girin (#7C3AED, #14B8A6 vb.). Aktif şirket değişince UI accent rengi otomatik güncellenir.',
      example: `PARAM    → #1E40AF (mavi)
UNIVERA  → #D97706 (amber)
FINROTA  → #059669 (emerald)`,
    },
    {
      heading: 'Logo URL',
      content:
        'Şu an dış URL kabul ediyor (örn. CDN linki). İlerleyen sürümde Supabase Storage upload\'ı eklenecek — dosyayı doğrudan buradan yükleyebileceksin.',
      tip: 'PNG veya SVG, kare oran (örn. 64×64), şeffaf arka plan önerilir.',
    },
    {
      heading: 'Destek e-postası',
      content:
        'Müşteriye giden vaka bildirimi mail\'lerinde "From" adresi olarak görünecek. Bu e-postanın Resend\'da doğrulanmış olması gerekir (FAZ 2 — bildirim sistemi).',
    },
    {
      heading: 'Uygulama adı',
      content:
        'Aktif şirketin header\'ında "VARUNA" yerine bu ad görünür (örn. "PARAM Vaka Yönetim"). Boş bırakılırsa default "VARUNA" kullanılır.',
    },
  ],
};
