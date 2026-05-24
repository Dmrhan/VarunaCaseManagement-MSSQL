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
    updatedAt: '2026-05-24',
    requiredKeywords: [
      'Sheet Eşleştirme',
      'Şablon İndir',
      'Dry-run',
      'Commit',
      'Rollback',
      'Geri al',
      'Şirket',
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
];

/** Convenience lookup. */
export function getHelpTopic(topic: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.topic === topic);
}
