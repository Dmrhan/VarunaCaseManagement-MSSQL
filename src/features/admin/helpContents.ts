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
      heading: 'Şirket bağlılığı',
      content:
        'Takımlar şirkete özeldir — her takım tek bir şirkete bağlıdır. Takım oluştururken şirket seçimi zorunludur. Bir kullanıcı yalnızca yetkili olduğu şirketlerin takımlarını görür ve yönetir.',
      warning:
        'Bir takımı başka bir şirkete taşımak şu anda desteklenmiyor. Yanlış şirkete oluşturulan takım pasifleştirilip yeni şirkette tekrar oluşturulmalı.',
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

export const COMPANIES_HELP: HelpContent = {
  title: 'Şirketler',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Holding altındaki şirketleri (PARAM / UNIVERA / FINROTA gibi) buradan yönetin. Her şirketin kendi takımları, kategorileri, SLA kuralları ve marka kimliği olur. Kullanıcılar birden fazla şirkete atanabilir; her şirkette farklı rol taşıyabilir.',
    },
    {
      heading: 'Yeni Şirket',
      content:
        'Sağ üstteki "Yeni Şirket" butonuyla holding altına yeni bir şirket eklersiniz. Şirket adı (zorunlu) tek tanımlayıcıdır; aynı isimde iki şirket oluşturulamaz. Yaratıldığı anda boş bir Şirket Ayarları kaydı da otomatik oluşturulur.',
      tip: 'Yeni şirket eklendiği an Kullanıcılar atama modal\'ında ve takım oluşturma dropdown\'larında görünür hale gelir.',
    },
    {
      heading: 'Düzenle',
      content:
        'Tablodaki "Düzenle" butonuyla şirketin tüm marka ayarları tek modal\'dan değiştirilir: ad, birincil renk (hex), uygulama adı, logo URL, destek e-postası. Birincil renk vaka detay ve atama rozetlerinde vurgulanır.',
      example: `Şirket Adı     : PARAM
Birincil Renk  : #7C3AED
Marka Adı      : PARAM Vaka
Destek E-posta : destek@param.com.tr`,
    },
    {
      heading: 'Pasif Yap',
      content:
        'Pasifleştirilmiş şirket yeni vaka/kullanıcı atamalarında dropdown\'larda görünmez. Mevcut vakalar etkilenmez (denormalize companyName alanı korunur). İşlem geri alınabilir — "Aktif Yap" ile tekrar açılır.',
      warning:
        'Şirketi tamamen silme (hard delete) yok. Çok sayıda FK referansı (Cases, Teams, SLA, ...) var — silmek yerine pasifleştirmek bilinçli bir mimari karar.',
    },
    {
      heading: 'SystemAdmin vs Admin',
      content:
        'SystemAdmin: tüm şirketleri görür, yeni şirket oluşturabilir, herhangi birini düzenler/pasifleştirir. Admin: yalnızca atandığı şirketleri görür ve düzenleyebilir; oluşturma ve pasifleştirme yetkisi yok (butonlar görünmez).',
    },
  ],
};

export const USERS_HELP: HelpContent = {
  title: 'Kullanıcılar',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Sistemdeki kullanıcıları ve her birinin hangi şirket(ler)e hangi rolde atandığını yönetir. Bir kullanıcı aynı anda birden fazla şirkete atanabilir ve her şirkette farklı rol taşıyabilir (örn. PARAM\'da Agent, UNIVERA\'da Supervisor).',
    },
    {
      heading: 'Yeni kullanıcı eklemek',
      content:
        'Şu an ekrandan doğrudan oluşturma yok. Yeni bir Supabase Auth kullanıcısı ilk girişinde sistem otomatik DB kaydı oluşturur (auto-provision). Sonra bu ekrandan "Düzenle" diyerek şirket atamalarını yaparsınız.',
      tip: 'Auto-provision sırasında e-postası Person tablosundaki bir kayıtla birebir eşleşirse personId otomatik bağlanır — vaka atama hedefi olarak kullanılabilir.',
    },
    {
      heading: 'Şirket Atama',
      content:
        '"Düzenle" modal\'ında tüm şirketler checkbox listesi olarak gösterilir. Seçilen her şirket için bir rol dropdown\'ı açılır. Pasif şirketler disabled görünür ama mevcut atama kalabilir.',
      warning:
        'En az bir şirket ataması zorunludur. Tüm atamaları kaldırırsanız Kaydet butonu disabled olur — son atama silinemez. Yetkisiz şirkete atama yapma denemeleri backend tarafında 403 ile reddedilir.',
    },
    {
      heading: 'Roller — Agent / Supervisor / Admin',
      content:
        'Per-company roller kullanıcının o şirket içindeki yetkisini belirler. Sistem-seviyesi rol (User.role) login akışı için kalır; per-company rol günlük operasyonu yönlendirir.',
      example: `Agent       — Vaka açar, kendi atandığı vakalara
              müdahale eder. Admin paneline giremez.

Supervisor  — Tüm vakaları görür, transfer/eskalasyon
              kararlarını verir. Admin paneline giremez.

Admin       — Şirket içi yapılandırma (takım, kategori,
              SLA, çek-list, kendi kullanıcılarını
              atama). Şirket yaratamaz/silemez.`,
    },
    {
      heading: 'SystemAdmin kullanıcıları',
      content:
        'Sistem rolü SystemAdmin olan kullanıcılar bu ekrandan yönetilemez (Düzenle butonu disabled). SystemAdmin verifyJwt sırasında runtime\'da tüm aktif şirketlere otomatik erişir — UserCompany kaydı bu rol için anlamsız.',
      warning:
        'Bir kullanıcıyı SystemAdmin yapmak için sistem rolünü değiştirmek gerekir; bu bilinçli olarak UI\'dan kapalı (yalnızca seedAuth.ts ya da DB\'den).',
    },
    {
      heading: 'Demo Personalar & Test Senaryoları',
      content:
        'Yalnız local/demo/sandbox kullanım için. `npm run db:seed:auth` 6 demo persona oluşturur (varsayılan şifre demo1234). `npm run db:seed:scenarios` Univera (FMCG), Finrota (SMB finans) ve PARAM (fintech) için zengin senaryo verisi ekler — watcher, linked cases, note reply/reaction, AI Status Report, Customer Pulse ve multi-tenant izolasyon testleri.',
      example: `agent@varuna.dev       — PARAM Agent (frontline)
supervisor@varuna.dev  — PARAM + UNIVERA Supervisor
csm@varuna.dev         — PARAM CSM (müşteri temaslı)
backoffice@varuna.dev  — PARAM Backoffice (çözüm)
admin@varuna.dev       — Tüm şirketler Admin
sysadmin@varuna.dev    — Platform SystemAdmin

Senaryo vakaları (örnek):
  DEMO-UNI-001  Enroute rota — Watcher
  DEMO-UNI-003  Quest — Note reply + Reaction
  DEMO-PAR-002  BKM — AI Status Report
  DEMO-FIN-002  Netekstre — Customer Pulse
  DEMO-MT-*     Multi-tenant izolasyon

Detaylı rehber: docs/TEST_SCENARIOS.md`,
      warning:
        'Scenario seed yalnız demo/sandbox DB içindir. Production\'da ASLA çalıştırılmaz — gerçek müşteri verisi etkilenir. `npm run db:seed:scenarios` çalıştırmadan önce DATABASE_URL\'in prod olmadığını doğrulayın.',
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

export const KNOWLEDGE_SOURCES_HELP: HelpContent = {
  title: 'Bilgi Kaynakları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'AI asistanın (RUNA AI) hangi veri kaynaklarından beslendiğini gösteren envanter ekranı. Buradaki kayıtlar AI\'ın referans aldığı kaynakları şeffaf hale getirir.',
    },
    {
      heading: 'Ne işe yarar?',
      content:
        'RUNA AI kategori önerisi, çözüm taslağı ve risk analizi yaparken geçmiş vakalar, SLA kuralları ve kategori tanımları gibi kaynaklara başvurur. Bu ekran hangi kaynakların aktif olduğunu ve içerik sayısını gösterir.',
    },
    {
      heading: 'Kaynak Türleri',
      content:
        'Her kaynak türü farklı bir AI yeteneğini besler. Aşağıdaki türler sistemde tanımlıdır.',
      example: `Geçmiş Vakalar    → Çözülmüş vakalardan öğrenilen örüntüler
SLA Kuralları     → Öncelik ve süre hesaplamalarında kullanılır
Kontrol Listeleri → Çözüm adımları önerilerinde kullanılır
Kategori Tanımları→ Otomatik sınıflandırmada kullanılır
Manuel Giriş      → Admin tarafından eklenen özel kaynaklar`,
    },
    {
      heading: 'Yeni Kaynak Nasıl Eklenir?',
      content:
        '"Yeni Kaynak" butonuna tıklayın, kaynak adı, türü ve içerik sayısını girin. Kaynak eklenmesi AI\'ın otomatik olarak o veriye erişeceği anlamına gelmez — bu sadece bir envanter kaydıdır.',
    },
    {
      heading: 'Kimler Görebilir?',
      content:
        'Admin ve SystemAdmin rolündeki kullanıcılar görüntüleyebilir ve düzenleyebilir.',
    },
  ],
};

export const RESOLUTION_APPROVAL_POLICIES_HELP: HelpContent = {
  title: 'Çözüm Onayı Politikaları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Bir çözüm onayı politikası, "bu vaka kapanmadan önce kim onaylasın" sorusunun kurallı cevabıdır. Bir politika eşleştiğinde, vakayı çözen kişi önce çözüm özetini onaya gönderir; ilgili kişi onaylayana kadar vaka Çözüldü\'ye geçemez. Politika yoksa veya pasifse mevcut kapatma akışı aynen sürer — Agent doğrudan kapatır, ek bir adım yoktur.',
      tip:
        'Yeni bir tenant\'ta varsayılan politika yoktur. Hiçbir vaka onay gerektirmez; admin kasıtlı olarak hangi durumlarda onay isteneceğini kurar.',
    },
    {
      heading: 'Eşleşme alanları — politika kime uygulanır',
      content:
        'Her politika tek bir şirkete (companyId) bağlıdır. Vaka için politikanın eşleşmesi için tüm dolu alanların vakanın alanlarıyla aynı olması gerekir. Boş bırakılan alan "tümü" sayılır.',
      example: `Eşleşme alanları:
  · Şirket           (companyId — zorunlu)
  · Kategori         (örn. "Yazılım")
  · Alt Kategori     (örn. "Raporlama")
  · Öncelik          (Critical / High / Medium / Low)
  · Destek Seviyesi  (Seviye1 / Seviye2 / Seviye3)
  · Takım (assignedTeamId)`,
      tip:
        'Filtre alanlarını boş bırakırsan o politika şirketteki TÜM vakalara uygulanır. Bu istemediğin bir broadcast yaratabilir; politikayı dar tutmak güvenli pratiktir.',
    },
    {
      heading: 'Sıra ve öncelik (sortOrder)',
      content:
        'Aynı vaka birden fazla politikaya uyabilir. Sistem öncelik sırasını şöyle çözer: önce sortOrder ASC (düşük sayı önce); aynı sortOrder içinde daha SPESİFİK politika kazanır (dolu alan sayısı çok olan); son eşitlikte oluşturma tarihi ASC. Bu sayede genel + özel politikalar birarada tutulabilir, özel olan önde çalışır.',
      example: `Örnek senaryo:
  Politika A: sortOrder=100, matchScope: { company: PARAM }
  Politika B: sortOrder=200, matchScope: { company: PARAM, priority: Critical }

PARAM + Critical bir vaka → A önce match (sortOrder 100), B ikinci sırada
Aynı sortOrder olsaydı B kazanırdı (daha spesifik = 2 alan dolu).`,
    },
    {
      heading: 'Onaylayıcı tipi (approverType)',
      content:
        'Politika eşleştiğinde sistem kimin onaylayacağını şu seçeneklerden birine göre çözer:',
      example: `· Takım Lideri / Atanan Takımın Lideri
    → Case.assignedTeamId üzerinden o takımın
      isTeamLead=true ve isActive=true Person'ı

· Süpervizör
    → Vakanın şirketinde aktif Supervisor
      rolündeki kullanıcılar

· Admin
    → Vakanın şirketinde aktif Admin
      rolündeki kullanıcılar

· Sistem Admin
    → Global SystemAdmin rolü (şirket scope'u
      uygulanmaz)

· Belirli Bir Kişi (SpecificPerson)
    → Politikada seçilen Person; takım ile
      tenant uyumu BE'de doğrulanır`,
      tip:
        'Yetkili kişi çözülemezse (örn. takım lideri pasif olmuşsa) onaya gönderim 400 ile reddedilir. Politika düşmüş olmuyor; sadece onaylayıcı yok demektir — politikayı düzenleyip aktif bir onaylayıcı belirleyin.',
    },
    {
      heading: 'Self-approval (kendi çözümünü onaylama)',
      content:
        'Varsayılan davranış: bir kişi kendi çözümünü onaylayamaz. Onayı gönderen ile çözülen onaylayıcı aynı kişiyse sistem 400 (self_approval_blocked) ile bloklar. Bu davranışı politikada açıkça "Kendi çözümünü onaylayabilir" kutusunu işaretleyerek devre dışı bırakabilirsiniz; o zaman tek-kişi ekiplerde onaylayıcı sıkışıklığı çözülür.',
      warning:
        'Self-approval kapalı bırakmak operasyonel disiplin için varsayılan pratiktir. Açtığınız politikalarda audit log\'da hangi kullanıcının kendini onayladığı her zaman görünür kalır.',
    },
    {
      heading: 'Red davranışı (rejectionBehavior)',
      content:
        'Onaylayıcı reddederse politikadaki ayara göre vaka şu eylemlerden birini alır:',
      example: `Atayana iade et (ReturnToAssignee — varsayılan)
   → Vaka aynı kişide kalır; sadece red gerekçesi
     CaseActivity'ye işlenir; agent revizyon yapıp
     yeniden gönderir

Takıma iade et (ReturnToTeam)
   → assignedPersonId/Name temizlenir; vaka
     takımına geri düşer, başka biri üstlenebilir

Eskalasyona al (Escalate)
   → Vaka durumu Eskalasyon'a geçer;
     escalationLevel="Seviye1" atanır; red gerekçesi
     CaseActivity'de gösterilir`,
      tip:
        'Reddedilen vakanın approvalState\'i "Rejected" olur ve operatör revize edip "Yeniden Onaya Gönder" diyebilir; yeni bir CaseResolutionApproval kaydı oluşur. Önceki red satırı immutable olarak kalır.',
    },
    {
      heading: 'Aktif / Pasif politika',
      content:
        'Bir politika silinmez; satırdaki güç düğmesiyle pasifleştirilir. Pasif politika eşleşmeye katılmaz — sanki orada değilmiş gibi davranır. Geçmiş onay satırları (CaseResolutionApproval) pasif politika için snapshot\'larıyla saklanır.',
      warning:
        'Bir politikayı pasifleştirmeden önce o politika tarafından korunan vakaların kapanmasını engellemeyeceğini doğrulayın. Pasifleştirilen politika anında devre dışı kalır; yeni onay gerektirmeyen vakalar bu noktadan itibaren doğrudan kapanır.',
    },
    {
      heading: 'Kapatma engeli (close guard)',
      content:
        'Vaka Çözüldü\'ye geçmek istediğinde sistem matchPolicyForCase çağırır. Bir politika eşleşiyor ve Case.approvalState ≠ Approved ise geçiş bloklanır (400 approval_required). Politika eşleşmiyor veya zaten Approved ise legacy kapatma davranışı sürer.',
      example: `Akış:
  Agent "Çözüldü" geçişi denedi
    → matchPolicyForCase varsa
        approvalState = null  → 400 approval_required (engelle)
        approvalState = Pending → 400 approval_required (engelle)
        approvalState = Approved → izin
    → Politika yoksa
        eski davranış (Agent kapatır)`,
    },
    {
      heading: 'Bu ekran müşteriye bildirim YOLLAMAZ',
      content:
        'Politika oluşturmak veya onay vermek hiçbir müşteriye otomatik mesaj göndermez. Onay verildiğinde gerçekleşen tek şey: Case.approvalState=Approved + CaseActivity log + (varsa) ilgili event\'i tetikleyen NotificationRule\'ların dispatch satırı yazması (yine de gönderim manuel).',
      warning:
        'Müşteri iletişimi tamamen ayrı bir akıştır: Bildirim Şablonları + Bildirim Kuralları ekranlarında yapılandırılır; operatör Vaka Detayı\'ndaki "İletişim Bildirimleri" kartında manuel olarak iletir. Bu ekran sadece onay zincirini tanımlar.',
    },
    {
      heading: 'Level A sınırı — şu an aktif gönderim YOK',
      content:
        'Varuna bugün hiçbir müşteri e-postası kendi başına göndermiyor. Onay verildikten sonra üretilen müşteri-facing dispatch satırları operatörün manuel olarak "Mesajı Kopyala / Mail Taslağı Aç / Manuel Olarak Hallettim" akışıyla kapatılır; Teslimat notu zorunludur, audit izi kalıcıdır.',
      tip:
        'Aktif e-posta sağlayıcısı entegrasyonu bir sonraki adımdır ve şu an scope dışıdır. Üretim sağlayıcı kararı (Resend / SMTP / vb.) verilene kadar mevcut hâl operasyonel olarak yeterlidir.',
    },
  ],
};

export const CASE_DETAIL_COMMUNICATION_HELP: HelpContent = {
  title: 'İletişim Bildirimleri — Operatör Rehberi',
  sections: [
    {
      heading: 'Bu kart ne gösterir?',
      content:
        'Vaka kapanışı veya çözüm onayı akışı için tanımlanmış kuralların tetiklediği bildirim satırlarını gösterir. Her satır kimin bilgilendirilmesi gerektiğini, hangi kanaldan ve mesajın tam içeriğini taşır.',
    },
    {
      heading: 'Otomatik gönderim YOKTUR',
      content:
        'Varuna şu an müşteriye veya iç ekibe kendiliğinden e-posta/SMS göndermez. Her mesaj operatör tarafından dış uygulamadan iletilir ve sonra Vaka Detayı\'nda kapatılır. Pano kopyalansa veya mail taslağı açılsa bile kayıt "Bekliyor" durumunda kalmaya devam eder — yalnız "Manuel Olarak Hallettim" eylemi durumu Sent yapar.',
      warning:
        'Sistem mesajı sessiz biçimde göndermez. Mesaj ulaşmadıysa müşteri haberdar değildir; mutlaka iletip onaylayın.',
    },
    {
      heading: 'Üç eylem: Kopyala / Mail Taslağı / Manuel Onay',
      content:
        'Her bekleyen satır için 3 eylem vardır:',
      example: `Mesajı Kopyala
   → Konu + Gövde panoya kopyalanır;
     kendi e-posta/SMS/CRM uygulamanıza
     yapıştırırsınız.

Mail Taslağı Aç
   → Hedef e-postaysa varsayılan
     mail uygulamasında alıcı/konu/gövde
     dolu taslak açılır. Gönderim sizden.

Manuel Olarak Hallettim
   → Mesajı ilettiğinizi onaylar.
     Açılan modalda Teslimat notu
     zorunludur.`,
    },
    {
      heading: 'Teslimat notu neden zorunlu?',
      content:
        'Manuel iletişim dış sistemde gerçekleşir; Varuna o anı doğrudan göremez. Teslimat notu denetim sırasında "ne yapıldı, ne zaman, hangi kanaldan" sorusunun yegane yanıtıdır. Onayla butonu not yazılmadan etkin olmaz.',
      example: `İyi örnekler:
✓ "14:32'de e-posta gönderildi, müşteri kabul etti."
✓ "Telefonla aradım, mesaj bıraktım; yarın tekrar arayacağım."
✓ "WhatsApp Business üzerinden 15:10'da iletildi."

Zayıf örnekler:
✗ "OK"
✗ "Hallettim"`,
      tip:
        'Teslimat notu Bildirim Kayıtları detayında ve vaka aktivite log\'unda görünür. Açıklayıcı yazmak, ileride senin lehine olur.',
    },
    {
      heading: 'Onay sonrası geri alma yok',
      content:
        'Bir bildirimi onayladığınızda kayıt değiştirilemez. Yanlış onay verildiyse vakaya açıklayıcı bir not ekleyin ve gerekirse durumu Süpervizörünüze iletin. "Geri al" tuşu yoktur — audit izi bilinçli olarak değişmez.',
      warning:
        'Bir alıcıya yanlışlıkla mesaj gönderildiyse bildirimi yine de Teslimat notu ile kapatıp ne yaşandığını yazın. Boş bırakmak veya silmek seçenek değildir.',
    },
    {
      heading: 'Geçmiş ve durum etiketleri',
      content:
        'Kartın altındaki "Geçmiş" akordeonu daha önce tamamlanmış bildirim satırlarını gösterir. Durumlar: Sent (gönderildi/onaylandı), Failed (ileride gerçek gönderim eklendiğinde gönderim hatası), Suppressed (çift tetik veya hız sınırı yüzünden bilinçli olarak bastırıldı; aksiyon gerekmez).',
    },
    {
      heading: 'Cevap Kanalı badge\'i',
      content:
        'Kartın üst kısmında "Cevap Kanalı: ..." şeklinde bir bilgi bandı görünür. Bu, sistemin bu vaka için müşteriye nasıl ulaşacağını gösterir: kanal (e-posta / telefon / manuel), varsa alıcı adresi ve kaynağı (vakaya özel override, şirket tercihi, kontak tercihi veya müşteri kaydı fallback). Bilgi sadece bilgilendiricidir; kanal seçimini değiştirmek için sağdaki "Override" butonunu kullanın.',
      tip:
        'Override sadece KANAL tipini değiştirir; alıcı adresi yine AccountCompany → AccountContact → Account fallback zincirinden gelir.',
    },
    {
      heading: 'Müşteri opt-out',
      content:
        'AccountCompany üzerinde "Otomatik bildirim almak istemiyor" işaretlendiyse, müşteri-facing dispatch\'ler "Suppressed/customer_opted_out" olarak yazılır ve kartta uyarı bandı görünür. Bu kayıtlar açıklayıcı audit içindir; manuel-confirm ile değiştirilemez.',
      warning:
        'Opt-out, müşterinin açık talebi üzerine işaretlenmelidir. İç bildirimler (atanan kişi / takım lideri / supervisor) bu kuralın dışındadır — yine gönderilir.',
    },
  ],
};

export const NOTIFICATION_TEMPLATES_HELP: HelpContent = {
  title: 'Bildirim Şablonları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Bildirim Şablonları, kurallar tetiklendiğinde yazılacak mesajın Konu ve Gövde içeriğini tanımlar. Bir şablon birden fazla kuralda kullanılabilir. Şablon güncellenirse versiyon numarası artar; ama daha önce üretilmiş Bildirim Kayıtları snapshot içeriklerini korur — geçmiş bozulmaz.',
    },
    {
      heading: 'Konu, Gövde ve değişkenler',
      content:
        'Sabit metin serbestçe yazılır. Vaka bilgisini eklemek için {{değişken.adı}} kullanın. Editörde izinli değişkenlerin tam listesi gösterilir — tıklayarak Konu veya Gövde alanına ekleyebilirsiniz.',
      example: `Konu: Vaka {{case.number}} — {{case.title}}

Gövde:
Merhaba {{assignee.name}},
{{case.number}} numaralı vakanız
{{case.status}} durumunda. Önceliği: {{case.priority}}.

Çözüm özeti: {{resolution.summary}}`,
    },
    {
      heading: 'Önizle ve eksik değişken doğrulaması',
      content:
        'Önizle butonu örnek vaka değerleriyle Konu + Gövde\'yi render eder. Şablonda kullanılan ama izinli listede olmayan veya boş gelen değişkenler "Eksik değişken" uyarısı olarak çıkar; mesaj operatörün önüne "[değişken eksik]" şeklinde görünür.',
      tip:
        'Önizleme örnek değerler kullanır. Gerçek bir vakayla render etmek için ileride şablon detayında "vaka ile önizle" seçeneğini kullanabilirsiniz.',
    },
    {
      heading: 'Anahtar (key) ve versiyon',
      content:
        'Anahtar, şablonu sistemde referanslamak için kullanılır; küçük harf, rakam ve alt çizgi içerebilir, harfle başlamalıdır (örn. approval_pending_lead). Bir kez oluşturulduktan sonra değiştirilemez. Versiyon her kayıtta otomatik artar.',
      warning:
        'Şablon silinmez; "Aktif" kutusunu kapatarak pasifleştirin. Pasif şablonu yeni kurallar kullanamaz, ama geçmiş Bildirim Kayıtları snapshot içerikleriyle gözükmeye devam eder.',
    },
    {
      heading: '"Müşteriye Gider" rozeti',
      content:
        'Bu kutuyu işaretlerseniz şablon listede "Müşteriye Gider" rozetiyle vurgulanır. Şu an Varuna otomatik müşteri e-postası göndermez; rozet, kuralda bu şablonu kullanırken Hedef Kitle seçimini iki kez düşünmeniz için bir hatırlatmadır.',
    },
    {
      heading: 'Başlangıç durumu',
      content:
        'Yeni bir şirkette Bildirim Şablonları listesi boş başlar. Tenant için varsayılan şablon yüklü değildir — Admin\'in ilk işi tenant\'a özel şablonları kurmaktır. Şablon yoksa bağlı kural da oluşturulamaz; bildirim üretilmez.',
    },
  ],
};

export const NOTIFICATION_RULES_HELP: HelpContent = {
  title: 'Bildirim Kuralları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Bir Bildirim Kuralı şunu söyler: "Bu olayda, bu kapsamdaki vakalarda, bu Hedef Kitleye, bu Şablonu, bu Kanaldan üret." Şablonsuz kural olmaz; önce şablonu oluşturun.',
    },
    {
      heading: 'Olay (event) seçenekleri',
      content:
        'Kural sadece seçilen olayda tetiklenir. Olaylar Çözüm Onayı akışından gelir.',
      example: `Çözüm onaya gönderildi
Çözüm onaylandı
Çözüm reddedildi
Vaka kapatıldı
Vaka yeniden açıldı`,
    },
    {
      heading: 'Filtre (kapsam)',
      content:
        'Kuralın hangi vakalarda eşleşeceğini daraltır. Boş bırakılan alanlar "tümü" sayılır. Filtre alanları: Kategori, Alt Kategori, Öncelik, Destek Seviyesi, Takım.',
    },
    {
      heading: '"Her vakaya uygula" güvenlik onayı',
      content:
        'Hiçbir filtre alanı doldurmadan kural kaydetmek isterseniz "Her vakaya uygula" onayı zorunludur. Tasarımla, yanlışlıkla broadcast eden kural kurulmasını engeller.',
      warning:
        'Onay verilmediğinde Kaydet butonu çalışmaz. Müşteri iletişimi içeren kurallarda bu onayı vermeden önce gerçekten her vakaya bildirim atmak istediğinizden emin olun.',
    },
    {
      heading: 'Hedef Kitle (audience)',
      content:
        'Bir kuralda birden fazla Hedef Kitle satırı tanımlayabilirsiniz; her satır ayrı bir bildirim üretir. Türler: Atanan kişi, Takım Lideri, Süpervizör (şirket içi Supervisor), Admin (şirket içi Admin), Müşteri (birincil kontak), Sabit e-posta. Hedef çözülemezse (örn. atanan kişi yok) bildirim "Suppressed" olarak yazılır.',
    },
    {
      heading: 'Kanal ve Mode',
      content:
        'Kanal: In-App, E-posta (manuel), Manuel Görev. Mode: LogOnly (sadece kayıt yazılır, operatör eylem beklenmez) veya Manual (operatör vaka detayında onaylar). "Aktif gönderim" modu şu an arayüzde yoktur — Varuna otomatik müşteri e-postası göndermez. Müşteri iletişimi operatör tarafından Vaka Detayı\'ndan manuel olarak kapatılır.',
    },
    {
      heading: 'Tekrar bastırma ve hız sınırı',
      content:
        'Tekrar bastırma (dakika): aynı vaka + aynı alıcı + aynı şablon kombinasyonu bu pencerede ikinci kez tetiklenirse ikinci kayıt "Suppressed" yazılır. Saatlik üst sınır: aynı kural saatte en fazla X kez fire eder. İki alan da boş bırakılırsa hiçbir bastırma uygulanmaz.',
      tip:
        'Müşteri-facing kurallarda küçük bir tekrar bastırma penceresi (örn. 10 dk) ayarlamak hatalı çift tetiklemelere karşı güvenli bir varsayılandır.',
    },
  ],
};

export const NOTIFICATION_DISPATCHES_HELP: HelpContent = {
  title: 'Bildirim Kayıtları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Bildirim Kayıtları, her tetiklenen kuralın çıktısını gösteren değiştirilemez denetim tablosudur. Her satır zaman, olay, kural, Hedef Kitle, kanal, mode ve durum bilgisini taşır. Konu + Gövde içeriği üretildiği anki versiyondan dondurulmuş (snapshot) kopyadır — şablon sonradan değiştirilse bile bu satır değişmez.',
    },
    {
      heading: 'Kim görür?',
      content:
        'Süpervizör, CSM, Admin ve SystemAdmin rollerine açıktır. Agent ve Backoffice bu ekrana giremez. Ancak kendi vakalarındaki bildirimleri Vaka Detayı\'nın altındaki "İletişim Bildirimleri" kartında görebilirler.',
    },
    {
      heading: 'PII maskeleme',
      content:
        'E-posta ve telefon gibi alıcı tanımlayıcıları listede maskelenmiş gösterilir (örn. ab***@firma.com). Snapshot Konu/Gövde detayını görmek için satırdaki "Görüntüle" butonunu kullanın.',
    },
    {
      heading: 'Durum (state) anlamları',
      content:
        'Pending: bildirim oluşturuldu, operatör eylem bekliyor (manuel mode) veya henüz işlenmedi. Sent: dış sistemde iletildi ve manuel onaylandı; ya da LogOnly + In-App için doğrudan yazıldı. Suppressed: tekrar bastırma penceresi içinde geldi, hızı aştı veya hedef çözülemedi. Failed: ileride aktif gönderim modu eklendiğinde gönderim hatasını işaretler.',
      example: `Suppressed sebepleri:
• duplicate_within_window
• rate_limited
• audience_unresolvable
• customer_opted_out`,
    },
    {
      heading: 'Operatörün manuel kapattığı kayıtlar',
      content:
        'Manuel iletişim akışında operatör Vaka Detayı\'ndan "Manuel Olarak Hallettim" diyerek kaydı kapattığında satır Sent durumuna geçer, mode "Manual" olur ve Teslimat notu görüntülenebilir. Bu zorunlu nottur — operatör neyi nasıl ulaştırdığını yazmadan onay veremez.',
      tip:
        'Audit izi sonradan geri alınamaz. Yanlış onay verildiyse yeni bir vaka notu ekleyin ve gerekirse kuralı yeniden tetikleyecek bir aksiyon alın.',
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


export const TAXONOMY_DEFS_HELP: HelpContent = {
  title: 'Akıllı Ticket Tanımları',
  sections: [
    {
      heading: 'Bu ekran ne işe yarar?',
      content:
        'Smart Ticket akışındaki dropdown\'lar için per-tenant taxonomy tanımlarını yönetir. 9 tip taxonomy desteklenir: Platform, İş Süreci, İşlem Tipi, Etkilenen Nesne, Etki, Kök Neden Grubu, Kök Neden Detayı, Çözüm Tipi, Kalıcı Önlem.',
    },
    {
      heading: 'Kök Neden hiyerarşisi',
      content:
        'Kök Neden Grubu ve Kök Neden Detayı 2 seviyeli hiyerarşi oluşturur. Detay satırı oluştururken üst grup seçimi zorunludur. Bir Grubu pasifleştirirseniz detayları DB\'de kalır ama dropdown\'larda gözükmez.',
    },
    {
      heading: 'Kod (code) alanı',
      content:
        'Kod, şirket + taxonomy tipi içinde benzersizdir. ASCII slug formatı önerilir (örn. bp.crm_islemleri). Aynı kod farklı şirketlerde veya farklı taxonomy tiplerinde tekrar kullanılabilir.',
    },
    {
      heading: 'Silme / pasifleştirme',
      content:
        'Sil yok — yalnız "Pasifleştir" (isActive=false) vardır. Pasif kayıt mevcut vakalardaki referansları etkilemez; sadece yeni intake dropdown\'larında saklanır.',
      warning:
        'Bu PR\'da Smart Ticket intake ekranı henüz yok. Tanımlar şu an Case akışına dahil edilmiyor — mevcut Kategori/Alt Kategori/İstek Tipi alanları aynen çalışmaya devam ediyor.',
    },
  ],
};
