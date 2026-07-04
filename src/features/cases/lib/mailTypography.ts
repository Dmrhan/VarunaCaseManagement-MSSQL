/**
 * mailTypography — İletişim (mail) yüzeyleri tipografi merdiveni (R11).
 *
 * TEK KAYNAK: ListPane / Reader / CommunicationTab bar + hızlı-yanıt /
 * MailComposer kompakt özet buradan çeker. Dağınık text-[11px]/text-lg
 * hardcode'ları YASAK; sapmalar smoke ile yakalanır.
 *
 * Kademe kararı (kullanıcı direktifi 2026-07-04):
 *   T1 11px  — yardımcı meta (liste tarih, 📎N rozeti, "Yazışma · N" bar)
 *   T2 13px  — gövde-altı: liste gönderen (medium) + snippet (normal),
 *              reader meta, aksiyon butonları, hızlı-yanıt, "ayrıntılar ▾"
 *   T3 14px  — mail gövdesi (prose-sm) + composer editör (prose-sm) paritesi
 *   T4 17px  — reader konu (içerik başlığı, TEK yer)
 *
 * Bar (bağlam — konuyla YARIŞMAZ):
 *   caseNumber badge 12px mono · title 14px semibold · müşteri 13px muted
 *
 * Renk / weight component tarafında karılır — bu dosya boyut token'ı. Dark
 * mode için ayrı token gerekmiyor (renk sınıflarıyla ayrılır).
 *
 * NOT: Tailwind JIT bu dosyayı tarar; literal `text-[Xpx]` ifadelerinin
 * burada olması extraction için yeterli — component'lerde token adıyla
 * kullanılır.
 */
export const MAIL_TYPE = {
  /** T1 11px */
  t1: 'text-[11px]',
  /** T2 13px */
  t2: 'text-[13px]',
  /** T3 14px (prose-sm ile parite) */
  t3: 'text-sm',
  /** T4 17px (reader konu — TEK yer) */
  t4: 'text-[17px]',
  /**
   * R14 M2 (2026-07-04) — Merdiven ara kademesi: sekme-içi (mode='inline')
   * Reader konusu. 17px dar bağlamda büyük kaçıyordu (kullanıcı direktifi).
   * 15px medium ile fs T4 (17px) arasında konforlu okunuşluk sağlar.
   * BİLİNÇLİ istisna — açık yorum + tek tüketici (MailThreadReader inline).
   */
  t4Inline: 'text-[15px]',
  /** Bar bağlam — vaka no badge (12px mono) */
  barCaseNo: 'font-mono text-xs',
  /** Bar bağlam — başlık (14px semibold) */
  barTitle: 'text-sm font-semibold',
  /** Bar bağlam — müşteri / iletişim (13px muted) */
  barCustomer: 'text-[13px]',
} as const;
