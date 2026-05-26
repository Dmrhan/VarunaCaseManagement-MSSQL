/**
 * Varuna in-product help registry.
 *
 * Source of truth for both rendered help drawers and the freshness smoke
 * at `scripts/smoke-help-content.js`. See `docs/IN_PRODUCT_HELP_STANDARD.md`
 * for the rules a topic must satisfy and the migration policy
 * (incremental — not every screen at once).
 *
 * When you add/edit a topic:
 *  - Keep `topic` stable (used as an id in URLs/analytics).
 *  - Bump `updatedAt` on substantive copy/structure changes.
 *  - If a banned phrase belongs in a particular topic for a legitimate
 *    reason, add an `// allowed: <reason>` comment on the same line as
 *    the term — no silent allowlist.
 */

export type HelpAudience = 'operator' | 'admin' | 'technical-admin';
export type HelpTone = 'info' | 'warning' | 'success';

export interface HelpSection {
  title: string;
  /** Either a paragraph or a list of bullet lines. */
  body: string | string[];
  tone?: HelpTone;
}

export interface HelpTopic {
  topic: string;
  audience: HelpAudience;
  title: string;
  summary: string;
  sections: HelpSection[];
  /** Smoke fails if any keyword is missing from title+summary+sections. */
  requiredKeywords?: string[];
  /** Smoke fails if any phrase appears anywhere in the topic. */
  bannedPhrases?: string[];
  /** ISO date — bump on substantive change. */
  updatedAt?: string;
}

/**
 * Default banned phrases applied to every topic with audience='operator'.
 * Topic-level `bannedPhrases` extends (not replaces) this set.
 *
 * Items here are dev-time / internal vocabulary that operators do not
 * encounter in the rest of the product surface.
 */
export const OPERATOR_DEFAULT_BANNED_PHRASES = [
  'BFF',
  'Prisma',
  'payload',
  'adapter',
  'TODO',
  'FIXME',
  'Phase 2a',
  'Phase 2b',
  'Phase 3',
  'dry-run only',
  'will be added later',
  'not implemented yet',
];

export const HELP_TOPICS: HelpTopic[] = [
  {
    topic: 'data-import-studio',
    audience: 'operator',
    title: 'Veri Aktarım Stüdyosu — Operatör Rehberi',
    summary:
      'Excel/CSV veya API kaynağından Varuna müşteri verilerine güvenli aktarım. Her commit öncesi dry-run zorunlu; her commit denetlenebilir ve desteklenen yerlerde geri alınabilir.',
    updatedAt: '2026-05-25',
    requiredKeywords: [
      'Sheet Eşleştirme',
      'Şablon İndir',
      'Dry-run',
      'Commit',
      'Rollback',
      'Geri al',
      'Şirket',
      'VKN/TCKN',
      'Sahte VKN/TCKN üretmeyin',
    ],
    bannedPhrases: [
      // Per-topic additions on top of OPERATOR_DEFAULT_BANNED_PHRASES.
      'legacy',
      'Genel Tekil',
      'Detaylar',
    ],
    sections: [
      {
        title: 'Hızlı Başlangıç',
        tone: 'success',
        body: [
          'Şirketi seçin — aktarımın hedef tenant\'ı seçili şirkettir.',
          'Şablonu indirin veya hazır dosyanızı yükleyin.',
          'Sheetleri eşleştirin — her sayfayı bir veya birden fazla veri tipine bağlayın.',
          'Alanları eşleştirin — kaynak kolonlarını Varuna alanlarına bağlayın.',
          'Dry-run çalıştırın — önizleme; veritabanına hiçbir kayıt yazılmaz.',
          'Sonucu denetleyin ve Commit edin; yanlışlık olursa Rollback ile Geri alın.',
        ],
      },
      {
        title: 'Ne zaman kullanılır?',
        body: [
          'Müşteri Ana Kartı: mevcut müşteri listesini güncellemek için. Tekil kayıt aktarımı.',
          'Müşteri 360: ilk kurulum / çoklu ilişkili veri (şirket, iletişim, adres, proje).',
        ],
      },
      {
        title: 'Şirket seçimi ve kapsamı',
        tone: 'warning',
        body: [
          'Sayfanın üst kısmındaki şirket seçimi tüm aktarımın kapsamıdır.',
          'Müşteri-Şirket satırlarında companyCode boş bırakılırsa seçili şirkete bağlanır.',
          'companyCode farklı bir şirketse satır reddedilir.',
          'Yanlış şirket seçilirse veri yanlış tenant için hazırlanır. Commit öncesi mutlaka doğrulayın.',
        ],
      },
      {
        title: 'Şablon İndir',
        body: [
          'Müşteri 360 ekranındaki "Şablon İndir" butonu önerilen XLSX dosyasını indirir.',
          'README, Accounts, Companies, Contacts, Addresses, Projects sayfaları içerir.',
          'Başlıklar Varuna alan isimleriyle birebir eşleştiği için alan eşleştirme tek tıkla geçilir.',
        ],
      },
      {
        title: 'Sheet Eşleştirme Sihirbazı',
        body: [
          'Excel\'deki sayfa adları önemli değildir; sihirbaz her sayfayı gösterir ve hangi veri tipine bağlanacağını seçmenizi ister.',
          'Bir sayfa birden fazla veri tipine eşlenebilir.',
          'Bilinmeyen sayfalar otomatik alınmaz; ya eşleştirin ya da "Atla" ile geçin.',
          'Sistem sayfa adları ve kolon başlıklarından otomatik başlangıç önerileri sunabilir; her öneriyi değiştirebilirsiniz.',
        ],
      },
      {
        title: 'Alan Eşleştirme',
        body: [
          'Sheet eşleştirmesi sonrası entity başına alan eşleştirme açılır.',
          'Sistem otomatik öneri yapar; her satırı manuel değiştirebilirsiniz.',
          'Zorunlu alanlar başlıkta belirgindir; eşleşmezse dry-run hata verir.',
          'Kullanmak istemediğiniz kolon için "eşleşmedi" seçin.',
        ],
      },
      {
        title: 'VKN/TCKN: Resmi Kimlik İsteğe Bağlıdır',
        tone: 'info',
        body: [
          'VKN/TCKN doğru girilirse mevcut müşterilerle güçlü eşleşme sağlar (update).',
          'Ancak VKN/TCKN zorunlu değildir. Kaynak dosyada yoksa kayıt yine de oluşturulur ve "VKN/TCKN yok" uyarısı kaydedilir; bu hata değildir.',
          'Sahte VKN/TCKN üretmeyin. Eksik resmi kimlik, sahte bir değerden çok daha güvenlidir; ileride tamamlanabilir.',
          'Geçerli bir VKN sağlanırsa checksum doğrulanır; geçersiz VKN hata verir.',
          'TCKN içe aktarımı gizlilik kuralları gereği engellenmiştir.',
          'Dry-run özeti, VKN/TCKN olmadan oluşturulacak müşteri sayısını (missingTaxIdCount) gösterir.',
        ],
      },
      {
        title: 'Dry-run, Uyarı ve Hata',
        body: [
          'Dry-run hiçbir kayıt yazmaz; oluşturulacak/güncellenecek kayıt sayısını, hataları ve uyarıları gösterir.',
          'Uyarı: aktarım devam edebilir, operatör bakmalı.',
          'Hata: satır işlenemez; kaynakta düzeltilmeli veya skipErrors ile atlanmalı.',
          'skipErrors=false → hata varsa commit bloklanır. skipErrors=true → hatalı satırlar atlanır, uygunlar yazılır.',
        ],
      },
      {
        title: 'Commit',
        body: [
          'Commit veriyi veritabanına yazar; dry-run\'ı atlamayın.',
          'Müşteri 360 için bağımlılık sırası: Müşteri → Müşteri-Şirket → İletişim → Adres → Proje.',
          'Sonuç panelinde entity başına oluşturuldu/güncellendi/atlandı/hata sayıları görünür.',
          'Job audit edilebilir; job id\'sini saklayın.',
        ],
      },
      {
        title: 'Rollback / Geri al',
        body: [
          'Commit edilen aktarımı geri alır; oluşturulan kayıtlar pasife alınır, güncellenenler eski değerine döner.',
          'Sert silme yapılmaz.',
          'Sonradan değişen kayıtlar varsa kısmi geri alma olabilir; panel hangi satırların geri alınamadığını listeler.',
        ],
      },
      {
        title: 'Aktarımdan sonra',
        body: [
          'Sonuç panelindeki sayımları gözden geçirin.',
          'Rastgele 2-3 müşteri kartını açıp doğru görünüp görünmediğini kontrol edin.',
          'Job id\'sini ve özet sonucu audit için kaydedin.',
          'Yanlış bir şey fark edilirse başka bir düzeltici aktarım yapmadan önce bu job\'ı Geri alın.',
        ],
      },
    ],
  },
  {
    topic: 'approval-notifications',
    audience: 'admin',
    title: 'Çözüm Onayı ve Bildirim Kuralları',
    summary:
      'Çözüm onayı politikasına bağlı bildirim akışını tanımlar: Şablonlar mesaj içeriğini, Kurallar olay+kapsam+alıcı+kanal eşlemesini, Kayıtlar her tetiklenen bildirimin kalıcı denetim izini taşır. Şu an Varuna gerçek e-posta veya SMS göndermez; her müşteri iletişimi operatör tarafından manuel olarak ulaştırılır ve audit kaydı ile kapatılır.',
    updatedAt: '2026-05-26',
    requiredKeywords: [
      'Bildirim Şablon',
      'Bildirim Kural',
      'Bildirim Kayıt',
      'Konu',
      'Gövde',
      'Değişken',
      'Önizle',
      'Eksik değişken',
      'Olay',
      'Filtre',
      'Hedef Kitle',
      'Kanal',
      'Mode',
      'LogOnly',
      'Manual',
      'Her vakaya uygula',
      'snapshot',
      'Mesajı Kopyala',
      'Mail Taslağı',
      'Manuel Olarak Hallettim',
      'Teslimat notu',
      'audit',
      'otomatik müşteri e-postası',
      'Süpervizör',
      'CSM',
      'Admin',
      'SystemAdmin',
      'boş başlar',
    ],
    bannedPhrases: [
      // Per-topic additions on top of the registry baseline. Operator-default
      // banlist does not apply because audience='admin', but we still avoid
      // implementation jargon and roadmap labels so the copy stays in user
      // language.
      'Prisma',
      'BFF',
      'payload',
      'adapter',
      'mustache',
      'Resend',
      'SMTP',
      'webhook',
      'Phase 4',
    ],
    sections: [
      {
        title: 'Bu özellik ne işe yarar?',
        body: [
          'Bir vaka kapanmadan önce belirli kişilerin onayını gerektirebilir (Çözüm Onayı Politikaları). Onay verildiğinde, reddedildiğinde veya vaka kapandığında otomatik olarak bildirim oluşturmak için Bildirim Şablon ve Bildirim Kural ekranlarını kullanırsınız.',
          'Her tetiklenen bildirim, içeriği üretildiği anda dondurulmuş bir kopya (snapshot) olarak Bildirim Kayıtlar tablosuna yazılır. Bu kayıt asla değiştirilemez; sonradan şablon güncellense bile geçmiş satırlar bozulmaz.',
        ],
      },
      {
        title: 'Önemli: Otomatik gönderim yok',
        tone: 'warning',
        body: [
          'Şu an Varuna otomatik müşteri e-postası göndermez. Hiçbir mesaj kullanıcı onayı olmadan dışarı çıkmaz.',
          'Her müşteriye giden iletişim, bir operatör tarafından "Mesajı Kopyala" veya "Mail Taslağı Aç" ile dış uygulamada gönderilir ve sonra "Manuel Olarak Hallettim" ile audit kapatılır.',
          'E-posta servisi entegrasyonu ileride eklenecek; o noktada her kural için ayrı opt-in gerekecek.',
        ],
      },
      {
        title: 'Önce Bildirim Şablonu, sonra Bildirim Kuralı',
        body: [
          '1) Şablon: hangi mesajın yazılacağını tanımlar (Konu + Gövde + Değişkenler).',
          '2) Kural: hangi olayda, hangi kapsamdaki vakalarda, hangi Hedef Kitleye, hangi Şablonla, hangi Kanaldan üretileceğini belirler.',
          'Kural oluşturmadan önce o şirkette en az bir aktif Şablon olmalıdır.',
        ],
      },
      {
        title: 'Bildirim Şablonu — Konu, Gövde, Değişkenler',
        body: [
          'Konu (Subject) ve Gövde (Body) alanları mesajın gövdesini taşır. Sabit metni serbestçe yazarsınız; vaka bilgisini eklemek için {{değişken.adı}} formunu kullanın.',
          'İzinli değişkenler editörde liste olarak gösterilir; tıklayarak Konu veya Gövde alanına yapıştırabilirsiniz. Örnek: {{case.number}}, {{account.name}}, {{assignee.name}}, {{resolution.summary}}, {{approval.rejectionReason}}.',
          'Önizle butonu örnek vaka değerleriyle Konu + Gövde\'yi render eder. Şablonda kullanılan ama izinli listede olmayan veya boş gelen değişkenler "Eksik değişken" uyarısı olarak çıkar.',
          'Format alanı "plain" (düz metin) veya "html" seçilebilir. Şu an operatör Mesajı Kopyala ile içeriği dış uygulamasına aktardığından çoğu durumda "plain" yeterlidir.',
          'Müşteriye gider mi kutusunu işaretlerseniz bu şablon "Müşteriye Gider" rozetiyle vurgulanır; kuralda kullanılırken Hedef Kitle seçimini iki kere düşünmeniz beklenir.',
        ],
      },
      {
        title: 'Bildirim Şablonu — Versiyonlama ve audit',
        body: [
          'Şablonu her kaydettiğinizde versiyon numarası otomatik artar.',
          'Bir kural bu şablonu kullanırken bildirim oluşursa, o anki versiyon Bildirim Kaydı satırına snapshot olarak yazılır; şablon sonra değiştirilse bile geçmiş satırın içeriği değişmez.',
          'Anahtar (key) alanı şablonu sistemde referanslamak için kullanılır; oluşturduktan sonra değiştirilemez. Küçük harf, rakam ve alt çizgi içerebilir.',
        ],
      },
      {
        title: 'Bildirim Kuralı — Olay seçimi',
        body: [
          'Olay (event), bildirimi neyin tetikleyeceğini belirler:',
          '• Çözüm onaya gönderildi — Agent vakayı onaya gönderir gönderilmez.',
          '• Çözüm onaylandı — Yetkili kişi onay verir vermez.',
          '• Çözüm reddedildi — Yetkili kişi reddeder reddetmez.',
          '• Vaka kapatıldı — Vaka Çözüldü durumuna geçer geçmez (politika varsa onay sonrası).',
          '• Vaka yeniden açıldı — Vaka Yeniden Açıldı durumuna geçer geçmez.',
        ],
      },
      {
        title: 'Bildirim Kuralı — Filtre (kapsam)',
        body: [
          'Filtre alanları kuralın hangi vakalarda eşleşeceğini daraltır. Boş bırakılan alanlar "tümü" sayılır.',
          'Kapsam alanları: Kategori, Alt Kategori, Öncelik, Destek Seviyesi, Takım.',
          'Daha spesifik kurallar daha geneliyle birlikte çalışır; her eşleşen kural ayrı bir bildirim üretir. Sıra alanı, hangi kuralın önce işleneceğini belirler.',
        ],
      },
      {
        title: '"Her vakaya uygula" güvenlik onayı',
        tone: 'warning',
        body: [
          'Filtre kısmında HİÇBİR alanı doldurmadan kural kaydetmek istiyorsanız "Her vakaya uygula" onayını ayrıca işaretlemeniz gerekir.',
          'Bu, yanlışlıkla tüm vakalara broadcast eden bir kural kurulmasını engeller. Tasarımla zorunlu bir adımdır; bilinçli onay vermeden kaydet butonu çalışmaz.',
          'Belirli bir tetikleyici için gerçekten her vakaya bildirim atmak istiyorsanız (örn. "Vaka kapatıldı" → atayan kişiye dahili in-app bildirimi) bu onayı işaretleyin. Müşteri iletişimi içeren kurallarda dikkatli olun.',
        ],
      },
      {
        title: 'Bildirim Kuralı — Hedef Kitle (audience)',
        body: [
          'Bir kuralda birden fazla Hedef Kitle satırı tanımlayabilirsiniz; her satır ayrı bir bildirim üretir.',
          'Hedef Kitle türleri:',
          '• Atanan kişi — Vakanın o anki sorumlusu.',
          '• Takım Lideri — Vakaya atanan takımın lideri.',
          '• Süpervizör — Vakanın şirketindeki aktif Supervisor rolündeki kullanıcılar.',
          '• Admin — Vakanın şirketindeki aktif Admin rolündeki kullanıcılar.',
          '• Müşteri (birincil kontak) — Account\'ın isPrimary kontağı.',
          '• Sabit e-posta — Belirli bir adres (örn. ekip-dağıtım@firma.com); satır seçilince adres alanı açılır.',
          'Hedef çözülemezse (örn. atanan kişi yoksa veya takımın lideri pasifse) bildirim "Suppressed" olarak yazılır; operatör buna karşı ek bir işlem yapmaz, kayıt audit için durur.',
        ],
      },
      {
        title: 'Bildirim Kuralı — Kanal ve Mode',
        body: [
          'Kanal seçenekleri:',
          '• In-App — Varuna içi bildirim için. Şu an dahili bildirim sayacını besler.',
          '• E-posta — Mesaj e-posta gövdesi olarak render edilir. Şu an gönderim manuel; operatör Vaka Detayı\'nda Mesajı Kopyala / Mail Taslağı Aç butonlarıyla dış uygulamasından iletir.',
          '• Manuel Görev — Operatöre "şu kişiyi telefonla ara" gibi bir görev olarak görünür; benzer manuel akış.',
          'Mode seçenekleri:',
          '• LogOnly — Sadece kayıt yazılır, operatör eylem beklenmez. Dahili izleme için uygundur.',
          '• Manual — Operatörün vaka detayında onay vermesi beklenir. Bildirim "Bekliyor" durumunda kalır.',
          'Şu an "Aktif gönderim" modu yoktur; arayüzde sadece LogOnly ve Manual seçilebilir.',
        ],
      },
      {
        title: 'Bildirim Kuralı — Tekrar bastırma ve hız sınırı',
        body: [
          'Tekrar bastırma (dakika): Aynı vaka + aynı alıcı + aynı şablon birleşimi bu pencere içinde ikinci kez tetiklenirse ikinci kayıt "Suppressed" yazılır (sebep: duplicate_within_window). Kaza ile çoklu fire önler.',
          'Saatlik üst sınır: Aynı kural saatte en fazla X kez fire etsin demek için kullanılır. Hızlı kapanma akışlarında müşteriye spam atmayı engeller.',
          'İki alan da boş bırakılırsa hiçbir bastırma uygulanmaz.',
        ],
      },
      {
        title: 'Bildirim Kayıtları — Ne gösterir, kim görür',
        body: [
          'Bildirim Kayıtları her tetiklenen kuralın çıktısını gösterir: zaman, olay, kural, hedef kitle (PII alanları maskelenir), kanal, mode, durum.',
          'Görüntüle butonuyla snapshot Konu ve Gövde\'yi okuyabilirsiniz; bu içerik o anki versiyondan dondurulmuş kopyadır ve değiştirilemez.',
          'Manuel olarak kapatılan satırlarda Teslimat notu da gösterilir.',
          'Erişim: Süpervizör, CSM, Admin, SystemAdmin rollerine açıktır. Agent ve Backoffice bu ekrana giremez; ama kendi vakalarındaki bildirim kayıtlarını Vaka Detayı\'nın altındaki "İletişim Bildirimleri" kartından görürler.',
        ],
      },
      {
        title: 'Vaka Detayı — Manuel iletişim akışı',
        tone: 'info',
        body: [
          'Operatör vaka detayında "İletişim Bildirimleri" kartında bekleyen mesajları görür. Her bekleyen satır için 3 eylem vardır:',
          '• Mesajı Kopyala — Konu + Gövde panoya kopyalanır; operatör kendi e-posta/SMS/CRM uygulamasına yapıştırır.',
          '• Mail Taslağı Aç — Hedef e-postaysa varsayılan mail uygulamasında alıcı/konu/gövde dolu bir taslak açar (mailto bağlantısı). Operatör gönderir.',
          '• Manuel Olarak Hallettim — Operatör mesajı ilettiğini onaylar. Modal açılır; Teslimat notu zorunludur.',
          'Sistem mesajı kendiliğinden hiçbir yere göndermez. Pano kopyalansa bile durum "Bekliyor" kalır; bir kayıt "Sent" sayılması için operatörün manuel onayı şarttır.',
        ],
      },
      {
        title: 'Teslimat notu neden zorunlu?',
        tone: 'warning',
        body: [
          'Manuel iletişim, dış sistemde gerçekleşir (kişisel e-posta, telefon, WhatsApp, vb.). Varuna o gönderim olayını göremez; tek dayanak operatörün doğrulamasıdır.',
          'Teslimat notu, denetim sırasında "ne yapıldı, ne zaman, hangi kanaldan" sorusunun yanıtıdır. Örnek: "14:32\'de e-posta gönderildi, müşteri kabul etti." veya "Telefonla aradım, mesaj bıraktım; tekrar arayacağım."',
          'Bu nedenle alan boş bırakılamaz. Onayla butonu Teslimat notu yazılmadan etkin olmaz.',
        ],
      },
      {
        title: 'Audit ve geri alma',
        body: [
          'Bir bildirim manuel olarak kapatıldığında satıra şunlar yazılır: kim onayladı, ne zaman, hangi notla. Vaka aktivite kaydına da bir satır eklenir.',
          'Bu kayıtlar değiştirilemez. Yanlış onaylanan bir bildirim için "geri al" tuşu yoktur; doğru pratik, durumu vaka notu olarak eklemek ve gerekirse yeni bir bildirim için kuralı yeniden tetiklemektir.',
          'Bildirim Kayıtları tablosu sürekli büyür; bireysel satırlar silinmez. Kapanmış vakalar arşivlenirken yine de bağlı kayıtlar saklanır.',
        ],
      },
      {
        title: 'Başlangıç: boş başlar',
        body: [
          'Yeni bir şirkette Şablonlar ve Kurallar boş başlar. Hiçbir tenant için varsayılan şablon yüklü değildir.',
          'Admin\'in ilk işi: o şirkette hangi olaylarda hangi mesajın gideceğini tasarlamak ve karşılığına şablon + kural çiftleri kurmak.',
          'Şablon ve kural yoksa hiç bildirim üretilmez. Sadece Çözüm Onayı akışı çalışmaya devam eder; ama Bildirim Kayıtları boş kalır.',
        ],
      },
      {
        title: 'Sık karşılaşılan sorunlar',
        body: [
          '"Kural kaydedilmiyor — Her vakaya uygula onayı zorunlu" → Filtre alanlarının en az birini doldurun veya bilinçli olarak Her vakaya uygula kutusunu işaretleyin.',
          '"Şablon kaydedilmiyor — Anahtar formatı geçersiz" → key alanı sadece küçük harf, rakam ve alt çizgi içerebilir; harfle başlamalıdır (örn. approval_pending_lead).',
          '"Kaydım Suppressed olarak göründü" → Tekrar bastırma penceresi içinde aynı (vaka, hedef, şablon) ikinci kez fire oldu, ya da hedef çözülemedi (örn. atanan kişi yok). Açıklama satırı kayıt detayında gösterilir.',
          '"Operatör Manuel Olarak Hallettim butonuna tıklayamıyor" → Teslimat notu alanı boş; yazınca buton aktifleşir.',
        ],
      },
    ],
  },
];

/** Convenience lookup. */
export function getHelpTopic(topic: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.topic === topic);
}
