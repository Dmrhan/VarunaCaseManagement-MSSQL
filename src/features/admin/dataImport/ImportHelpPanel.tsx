/**
 * WR-A8 — Veri Aktarım Stüdyosu in-page operator guide.
 *
 * Drawer içinde 18 başlıkta detaylı, Türkçe, operator-friendly rehber.
 * Açma/kapatma import akışını sıfırlamaz; mevcut şirket seçimi, kaynak,
 * mapping ve dry-run state'i korunur. Pure UI — backend çağrısı yoktur.
 */

import type { ReactNode } from 'react';
import {
  Database,
  Users,
  Workflow,
  PlayCircle,
  Rocket,
  Undo2,
  AlertTriangle,
  FileSpreadsheet,
  Network,
  ShieldCheck,
  HelpCircle,
  CheckCircle2,
  CircleDot,
  Building2,
  Download,
  Sparkles,
  Globe2,
  ListChecks,
  ClipboardCheck,
  History,
  BookOpen,
} from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface TocEntry {
  num: number;
  title: string;
  hint: string;
}
const TOC: TocEntry[] = [
  { num: 1,  title: 'Bu sayfa ne işe yarar?',                hint: 'Genel amaç ve güvenlik felsefesi' },
  { num: 2,  title: 'İki içe aktarım türü',                  hint: 'Müşteri Ana Kartı / Müşteri 360' },
  { num: 3,  title: 'İlk kullanım için önerilen adımlar',     hint: '11 adımlık güvenli aktarım yolu' },
  { num: 4,  title: 'Şirket seçimi ve kapsamı',              hint: 'Doğru tenant her şeyin başı' },
  { num: 5,  title: 'Şablon İndir',                          hint: 'Önerilen Customer 360 XLSX yapısı' },
  { num: 6,  title: 'Sheet Eşleştirme Sihirbazı',            hint: 'Herhangi bir Excel’i bağlama' },
  { num: 7,  title: 'Alan Eşleştirme',                       hint: 'Kaynak kolon → Varuna alanı' },
  { num: 8,  title: 'İlişki Ağacı',                          hint: 'Renkli sağlık göstergesi' },
  { num: 9,  title: 'Dry-run nedir?',                        hint: 'Önizleme, yazma yok' },
  { num: 10, title: 'Uyarı vs Hata + skipErrors',            hint: 'Hangisi durdurur, hangisi atlanır?' },
  { num: 11, title: 'Commit',                                hint: 'Gerçek aktarımı başlatır' },
  { num: 12, title: 'Rollback',                              hint: 'Aktarımı geri alır' },
  { num: 13, title: 'API kaynağı',                           hint: 'Excel yerine canlı entegrasyon' },
  { num: 14, title: 'Otomatik Sheet Önerileri',              hint: 'Standart şablon dışı dosyalar için başlangıç önerileri' },
  { num: 15, title: 'Veri güvenliği güvenceleri',            hint: 'Sınırlar, TCKN, sert silme yok' },
  { num: 16, title: 'Sık karşılaşılan durumlar',             hint: 'Hata avlama listesi' },
  { num: 17, title: 'Commit öncesi operator kontrol listesi', hint: 'Son onay öncesi 9 soru' },
  { num: 18, title: 'Aktarımdan sonra',                      hint: 'Doğrulama, audit, gerekirse rollback' },
];

export function ImportHelpPanel({ open, onClose }: Props) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <HelpCircle size={16} /> Veri Aktarım Stüdyosu — Operatör Rehberi
        </span>
      }
      subtitle="Veri Aktarım Stüdyosu ile güvenli müşteri veri aktarımı"
      width="xl"
    >
      <div className="space-y-4 px-4 py-3">
        {/* Opening block */}
        <div className="rounded-md border border-brand-200 bg-brand-50/60 px-3 py-2.5 text-xs text-brand-900 dark:border-brand-700/40 dark:bg-brand-900/10 dark:text-brand-100">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <BookOpen size={13} /> Veri Aktarım Stüdyosu ile güvenli müşteri veri aktarımı
          </div>
          <p className="leading-relaxed">
            Bu sayfa, Excel/CSV dosyanızı veya bir API kaynağını Varuna müşteri verilerine dönüştürür.
            Tasarımı, hatalı yazımı önlemek üzerine kuruludur: her commit öncesi <strong>dry-run</strong>{' '}
            (önizleme) zorunludur, her commit denetlenebilir ve desteklenen yerlerde <strong>geri alınabilir</strong>.
          </p>
          <p className="mt-1 text-[11px] opacity-90">
            Bu rehberi açıp kapatmak akışı sıfırlamaz; şirket seçimi, kaynak, mapping ve dry-run sonuçlarınız korunur.
          </p>
        </div>

        {/* Table of contents */}
        <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
            <ListChecks size={12} /> İçindekiler
          </div>
          <ol className="grid grid-cols-1 gap-x-3 gap-y-1 text-[11px] md:grid-cols-2">
            {TOC.map((e) => (
              <li key={e.num} className="flex gap-1.5">
                <span className="w-5 text-right font-mono text-slate-400">{e.num}.</span>
                <span className="flex-1">
                  <span className="text-slate-700 dark:text-ndark-text">{e.title}</span>
                  <span className="text-slate-400 dark:text-ndark-muted"> — {e.hint}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <Accordion>
          {/* §2 — Two modes */}
          <AccordionItem
            title="2. İki içe aktarım türü"
            icon={<Workflow size={14} />}
            subtitle="Müşteri Ana Kartı (tekil) vs. Müşteri 360 (çoklu entity)"
            defaultOpen
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ModeCard
                icon={<Database size={14} />}
                title="Müşteri Ana Kartı"
                badge="canlı"
                points={[
                  'Tekil müşteri ana kartı (Account) aktarımıdır.',
                  'Account temel alanlarını işler: ad, VKN, müşteri tipi, iletişim.',
                  'Hızlı, sade müşteri listesi güncellemeleri için en uygunu.',
                  'Dry-run, commit, rollback destekler.',
                ]}
              />
              <ModeCard
                icon={<Users size={14} />}
                title="Müşteri 360"
                badge="canlı"
                points={[
                  'Müşteri + ilişkili şirket + iletişim + adres + projeyi birlikte işler.',
                  'İlk müşteri göçü / onboarding için en kapsamlı seçenek.',
                  'Commit sırası: Müşteri → Müşteri-Şirket → İletişim → Adres → Proje.',
                  'Rollback bu sırayı tersinden uygular.',
                  '5 sayfalı XLSX, nested API JSON veya rastgele sayfalı Excel destekler.',
                ]}
              />
            </div>
          </AccordionItem>

          {/* §3 — First-use flow */}
          <AccordionItem
            title="3. İlk kullanım için önerilen adımlar"
            icon={<PlayCircle size={14} />}
            subtitle="Onboarding aktarımı için güvenli yol"
            defaultOpen
          >
            <ol className="space-y-1.5 text-xs">
              {[
                'Doğru şirketi seçin.',
                'Mümkünse "Şablon İndir" ile başlangıç dosyasını alın.',
                'Verinizi şablona göre Excel\'de hazırlayın.',
                'Dosyayı yükleyin.',
                'Sheet Eşleştirme Sihirbazı’nda her sayfayı doğru entity\'lere bağlayın.',
                'Alan eşleştirmesinde kaynak kolonları Varuna alanlarına eşleyin.',
                'Dry-run çalıştırın.',
                'Hata ve uyarıları gözden geçirin; gerekirse dosyayı düzeltip tekrar yükleyin.',
                'Sonuç tatmin ediciyse Commit edin.',
                'Commit sonucunu (job id, sayım, durum) audit için saklayın.',
                'Yanlış bir şey fark ederseniz aynı ekrandan Rollback yapın.',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-semibold text-slate-600 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted">
                    {i + 1}
                  </span>
                  <span className="text-slate-700 dark:text-ndark-muted">{step}</span>
                </li>
              ))}
            </ol>
          </AccordionItem>

          {/* §4 — Company scope */}
          <AccordionItem
            title="4. Şirket seçimi ve kapsamı"
            icon={<Building2 size={14} />}
            subtitle="Aktarımın hedef tenant'ı her zaman seçili şirkettir"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Sayfanın üst kısmındaki şirket seçimi, tüm aktarımın <strong>kapsamı</strong>dır.</li>
              <li>• Müşteri 360'ta Müşteri-Şirket satırlarındaki <code>companyCode</code> boş bırakılırsa otomatik olarak <strong>seçili şirkete</strong> bağlanır.</li>
              <li>• <code>companyCode</code> dolu ama seçili şirketten farklıysa satır reddedilir (<em>account_company_selected_company_mismatch</em>).</li>
              <li>• Yanlış şirket seçilirse veri yanlış tenant için hazırlanır. <strong>Yükleme öncesi ve commit öncesi</strong> şirketi mutlaka doğrulayın.</li>
              <li>• Kaynak satırlarda farklı bir <code>companyId</code> alanı varsa <strong>yok sayılır</strong> ve uyarı kaydedilir (<em>source_company_id_ignored</em>).</li>
            </ul>
          </AccordionItem>

          {/* §5 — Template download */}
          <AccordionItem
            title="5. Şablon İndir"
            icon={<Download size={14} />}
            subtitle="En güvenli başlangıç noktası"
            defaultOpen={false}
          >
            <div className="space-y-2 text-xs text-slate-700 dark:text-ndark-muted">
              <p>
                Müşteri 360 ekranında <strong>"Şablon İndir"</strong> butonu önerilen Customer 360 XLSX dosyasını indirir.
              </p>
              <div>
                <div className="text-[11px] font-medium text-slate-600">Şablon sayfaları:</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {['README', 'Accounts', 'Companies', 'Contacts', 'Addresses', 'Projects'].map((s) => (
                    <span
                      key={s}
                      className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] dark:border-ndark-border dark:bg-ndark-card"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <ul className="ml-2 space-y-1">
                <li>• <strong>README</strong> sayfasında zorunlu alanlar, bağlantı anahtarları ve örnek değerler açıklanır.</li>
                <li>• Her veri sayfasında 1-2 örnek satır vardır. Bunları kendi verinizle değiştirebilirsiniz.</li>
                <li>• Şablon başlıkları Varuna alan isimleriyle birebir eşleştiği için alan eşleştirme adımı tek tıklama olur.</li>
                <li>• Yeni başlıyorsanız her zaman şablondan başlamak en güvenli yoldur.</li>
              </ul>
            </div>
          </AccordionItem>

          {/* §6 — Sheet Mapping Wizard */}
          <AccordionItem
            title="6. Sheet Eşleştirme Sihirbazı"
            icon={<Sparkles size={14} />}
            subtitle="Excel’deki her sayfayı Varuna entity'lerine bağlayın"
            defaultOpen={false}
          >
            <div className="space-y-2 text-xs text-slate-700 dark:text-ndark-muted">
              <p>
                Excel dosyanızdaki sayfaların adı önemli değildir (Sheet1, Sayfa1, Cari Liste, vb. olabilir).
                Yükleme sonrası sihirbaz size <strong>her sayfayı</strong> gösterir ve hangi Varuna entity'sine
                bağlanacağını seçmenizi ister.
              </p>
              <div className="rounded-md bg-slate-50 p-2 dark:bg-ndark-card">
                <div className="mb-1 font-medium text-slate-700 dark:text-ndark-text">Bir sayfayı şu seçeneklere bağlayabilirsiniz:</div>
                <div className="flex flex-wrap gap-1.5">
                  {['Müşteriler', 'Müşteri-Şirket İlişkileri', 'İletişim Kişileri', 'Adresler', 'Projeler', 'Atla'].map((e) => (
                    <span
                      key={e}
                      className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] dark:border-ndark-border dark:bg-ndark-card"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              </div>
              <ul className="ml-2 space-y-1">
                <li>• <strong>Bir sayfa birden fazla veri tipine eşlenebilir.</strong> Örn. müşteri ve şirket ilişki
                  bilgileri tek sayfadaysa o sayfayı hem "Müşteriler" hem "Müşteri-Şirket İlişkileri"ne bağlayabilirsiniz.</li>
                <li>• Bilinmeyen sayfalar otomatik olarak alınmaz. Ya eşleştirin ya da <strong>Atla</strong> ile geçin.</li>
                <li>• "Müşteriler"e en az bir sayfa eşlenmeden Devam butonu aktif olmaz.</li>
                <li>• Sayfaları genişleterek kolon listesini ve ilk 3 örnek satırı görebilirsiniz.</li>
                <li>• Sistem, sayfa adları ve kolon başlıklarından yola çıkarak başlangıç önerileri sunabilir (bkz. §14).</li>
              </ul>
            </div>
          </AccordionItem>

          {/* §7 — Field Mapping */}
          <AccordionItem
            title="7. Alan Eşleştirme"
            icon={<Workflow size={14} />}
            subtitle="Kaynak kolon → Varuna alanı"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Sheet eşleştirmesi tamamlandıktan sonra entity başına alan eşleştirme açılır.</li>
              <li>• Sistem alias listesi + kolon adından otomatik öneri yapar; her satırı manuel değiştirebilirsiniz.</li>
              <li>• <strong>Zorunlu alanlar</strong> başlıkta belirgindir; eşleşmezse dry-run hata verir.</li>
              <li>• <strong>PII / hassas alanlar</strong> ayrıca işaretlenir; bilinçli eşleyin.</li>
              <li>• Kullanmak istemediğiniz kolon için "eşleşmedi" seçin — alan atlanır.</li>
              <li>• Eşleştirme dropdown'u seçim, dış-tık veya <kbd className="rounded border border-slate-300 bg-white px-1 text-[10px] dark:border-ndark-border dark:bg-ndark-card">Esc</kbd> ile kapanır; başka şeyler tıklandığında yanlışlıkla kapanmaz.</li>
            </ul>
          </AccordionItem>

          {/* §8 — Relationship graph */}
          <AccordionItem
            title="8. İlişki Ağacı"
            icon={<Network size={14} />}
            subtitle="Sağlık göstergesi: yeşil/sarı/kırmızı"
            defaultOpen={false}
          >
            <div className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <p>Customer 360 ilişki ağacı, yüklediğiniz verinin nasıl bağlandığını gösterir:</p>
              <pre className="rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700 dark:bg-ndark-card dark:text-ndark-muted">{`Müşteri (Account)
  ├─ Müşteri-Şirket İlişkisi (AccountCompany)
  │     └─ Proje (Project)
  ├─ İletişim Kişisi (Contact)
  └─ Adres (Address)`}</pre>
              <ul className="ml-1 space-y-1">
                <li>
                  • <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Yeşil</span>{' '}
                  sağlıklı (zorunlu alanlar eşli, dry-run temiz).
                </li>
                <li>
                  • <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Sarı</span>{' '}
                  uyarı var (örn. eksik opsiyonel alan, otomatik bind).
                </li>
                <li>
                  • <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">Kırmızı</span>{' '}
                  hata var (eksik zorunlu, parent bulunamayan orphan satır vb.).
                </li>
                <li>• Bir entity kutusuna tıklayarak o entity'nin eşleştirmesini ve örnek satırlarını açabilirsiniz.</li>
              </ul>
            </div>
          </AccordionItem>

          {/* §9 — Dry-run */}
          <AccordionItem
            title="9. Dry-run nedir?"
            icon={<CircleDot size={14} />}
            subtitle="Önizleme — veritabanına yazma yok"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Dry-run <strong>hiçbir kayıt yazmaz</strong>. Ne olacağını simüle eder.</li>
              <li>• Dry-run sonucu şunları gösterir:
                <ul className="mt-1 ml-4 space-y-0.5 list-disc">
                  <li>oluşturulacak kayıt sayısı,</li>
                  <li>güncellenecek kayıt sayısı,</li>
                  <li>atlanacak satırlar,</li>
                  <li>hatalar ve gerekçeleri,</li>
                  <li>uyarılar,</li>
                  <li>tamlık (completeness) yüzdesi,</li>
                  <li>orphan (parent'ı bulunamayan) çocuk satırlar.</li>
                </ul>
              </li>
              <li>• Dry-run sonucu izin verdiğinde Commit butonu aktif olur.</li>
              <li>• Dosya veya eşleştirme değişirse dry-run yeniden çalıştırılmalıdır.</li>
            </ul>
          </AccordionItem>

          {/* §10 — Warnings vs Errors + skipErrors */}
          <AccordionItem
            title="10. Uyarı, Hata ve skipErrors"
            icon={<AlertTriangle size={14} />}
            subtitle="Hangisi durdurur, hangisi atlanır?"
            defaultOpen={false}
            tint="rose"
          >
            <div className="space-y-2 text-xs text-slate-700 dark:text-ndark-muted">
              <div>
                <strong className="text-amber-700 dark:text-amber-300">Uyarı (warning):</strong>{' '}
                Aktarım devam edebilir; satır işlenir ama operator bakmalı.
              </div>
              <div>
                <strong className="text-rose-700 dark:text-rose-300">Hata (error):</strong>{' '}
                Satır işlenemez. Ya kaynakta düzeltilmeli ya da skipErrors ile atlanmalı.
              </div>
              <div className="rounded-md bg-slate-50 p-2 dark:bg-ndark-card">
                <div>
                  <code>skipErrors=false</code> → Hata varsa <strong>commit bloklanır</strong>; hiçbir satır yazılmaz.
                </div>
                <div>
                  <code>skipErrors=true</code> → Hatalı satırlar <strong>atlanır</strong>, uygun satırlar yazılır.
                  Sonuç durumu <em>partial</em> olur.
                </div>
              </div>
              <div className="rounded-md border border-slate-200 p-2 dark:border-ndark-border">
                <div className="mb-1 font-medium text-slate-700 dark:text-ndark-text">Örnekler</div>
                <ul className="space-y-1">
                  <li>
                    <span className="font-mono text-[11px] text-amber-700 dark:text-amber-300">Uyarı:</span>{' '}
                    <code>companyCode</code> boş; seçili şirkete otomatik bağlandı.
                  </li>
                  <li>
                    <span className="font-mono text-[11px] text-rose-700 dark:text-rose-300">Hata:</span>{' '}
                    Müşteri için <code>name</code> eksik.
                  </li>
                  <li>
                    <span className="font-mono text-[11px] text-rose-700 dark:text-rose-300">Hata:</span>{' '}
                    İletişim satırı parent <code>accountKey</code> bulamadı (orphan).
                  </li>
                </ul>
              </div>
            </div>
          </AccordionItem>

          {/* §11 — Commit */}
          <AccordionItem
            title="11. Commit"
            icon={<Rocket size={14} />}
            subtitle="Gerçek aktarımı başlatır"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Commit, veriyi veritabanına yazar. Dry-run'ı atlamayın.</li>
              <li>• Müşteri 360 için bağımlılık sırası uygulanır:{' '}
                <code className="font-mono text-[11px]">Müşteri → Müşteri-Şirket → İletişim → Adres → Proje</code>.
              </li>
              <li>• Bu sıra, çocuk kayıtların doğru müşteriye bağlanmasını garanti eder.</li>
              <li>• Aynı job tekrar gönderilirse tamamlanmış satırlar atlanır (idempotent).</li>
              <li>• Sonuç panelinde entity başına <strong>oluşturuldu/güncellendi/atlandı/hata</strong> sayıları görülür.</li>
              <li>• Her job audit edilebilir; job id'sini saklayın.</li>
            </ul>
          </AccordionItem>

          {/* §12 — Rollback */}
          <AccordionItem
            title="12. Rollback"
            icon={<Undo2 size={14} />}
            subtitle="Aktarımı geri alır"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Rollback, commit edilen aktarımı geri alır (destek olan yerlerde).</li>
              <li>• <strong>Oluşturulan</strong> kayıtlar entity davranışına göre pasife alınır / geri alınır (sert silme yapılmaz).</li>
              <li>• <strong>Güncellenen</strong> kayıtlar, audit snapshot'larından eski değerlerine döner.</li>
              <li>• Ters bağımlılık sırasında çalışır: Proje → Adres → İletişim → Müşteri-Şirket → Müşteri.</li>
              <li>• Commit sonrası başka bir işlemle ilgili kayıt değiştiyse <strong>kısmi geri alma</strong> olabilir; ekrandaki panel hangi satırların geri alınamadığını listeler.</li>
            </ul>
          </AccordionItem>

          {/* §13 — API source */}
          <AccordionItem
            title="13. API kaynağı"
            icon={<Globe2 size={14} />}
            subtitle="Excel yerine canlı entegrasyon"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Excel/CSV yerine bir API'den veri çekilebilir.</li>
              <li>• URL, method (GET/POST), header'lar ve body sağlayabilirsiniz.</li>
              <li>• <strong>API secret'ları tarayıcıda saklanmaz.</strong> Sadece env değişkeninin <em>adı</em> kullanılır; değer sunucuda resolve edilir.</li>
              <li>• API yanıtınız nested JSON ise <code>dataPath</code> alanına accounts dizisinin yolunu yazın (örn. <code>data.customers</code>).</li>
              <li>• API'den gelen veri de aynı güvenlik adımlarından geçer: sheet/entity konsepti yerine direkt entity bundle'ı oluşturulur, ardından alan eşleştirme + dry-run + commit.</li>
            </ul>
          </AccordionItem>

          {/* §14 — Auto sheet suggestions */}
          <AccordionItem
            title="14. Otomatik Sheet Önerileri"
            icon={<Sparkles size={14} />}
            subtitle="Standart şablon dışı dosyalar için başlangıç önerileri"
            defaultOpen={false}
          >
            <div className="space-y-2 text-xs text-slate-700 dark:text-ndark-muted">
              <p>
                Dosyanız standart Varuna şablonunda olmasa bile sistem, sayfa adları ve kolon
                başlıklarından yola çıkarak ilk eşleştirme önerilerini hazırlayabilir. Örneğin
                müşteri adı, vergi numarası ve telefon bilgileri bulunan bir sayfa
                <strong> "Müşteriler"</strong> olarak; ilgili kişi ve e-posta bilgileri bulunan bir
                sayfa <strong>"İletişim Kişileri"</strong> olarak önerilebilir.
              </p>
              <p>
                Bu öneriler yalnızca başlangıç noktasıdır. Her sayfanın hangi veri tipine
                bağlanacağını siz belirlersiniz. Gerekirse bir sayfayı birden fazla veri tipine
                bağlayabilir veya kullanmayacağınız sayfaları <strong>"Atla"</strong> olarak
                işaretleyebilirsiniz. Bu aşamada veritabanına hiçbir kayıt yazılmaz.
              </p>
            </div>
          </AccordionItem>

          {/* §15 — Data safety */}
          <AccordionItem
            title="15. Veri güvenliği güvenceleri"
            icon={<ShieldCheck size={14} />}
            subtitle="Sınırlar, TCKN, sert silme yok"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Her aktarımdan önce <strong>dry-run</strong> zorunludur.</li>
              <li>• Aktarım yalnız seçili şirket kapsamındadır; başka tenant'a yazılmaz.</li>
              <li>• <strong>TCKN aktarımı engellenir.</strong> Kaynakta TCKN benzeri kolon bulunursa aktarım bloklanır (<code>tckn_import_blocked</code>).</li>
              <li>• Normal aktarım akışında <strong>sert silme yoktur</strong>; rollback pasife alma + alan restore üzerinden çalışır.</li>
              <li>• Commit sonrası rollback her zaman elinizin altındadır.</li>
              <li>• Job geçmişi audit için saklanır.</li>
              <li>• Açıkça değiştirmediğiniz mevcut/manuel müşteri verisi <strong>korunur</strong>.</li>
            </ul>
          </AccordionItem>

          {/* §16 — Common mistakes */}
          <AccordionItem
            title="16. Sık karşılaşılan durumlar"
            icon={<AlertTriangle size={14} />}
            subtitle="Hata avlama listesi"
            defaultOpen={false}
            tint="rose"
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              {[
                'Yanlış şirket seçilmiş — veri yanlış tenant\'a hazırlanır.',
                'Sayfa adı beklenmedik ve sihirbazda eşlenmemiş.',
                'Zorunlu alan eşleşmemiş; dry-run hata verir.',
                '`accountKey` eksik; çocuk satırlar orphan olur.',
                '`companyCode` başka bir şirkete ait; satır reddedilir.',
                'Tarih veya sayı formatı geçersiz; satır hatalı işlenir.',
                'Mükerrer iletişim kişileri (aynı e-posta tekrar tekrar).',
                'Operator dry-run uyarılarını okumadan commit etti.',
                'API kaynağı yalnız örnek (sample) satır döndü ya da `dataPath` yanlış.',
              ].map((line, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-500" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </AccordionItem>

          {/* §17 — Pre-commit checklist */}
          <AccordionItem
            title="17. Commit öncesi operator kontrol listesi"
            icon={<ClipboardCheck size={14} />}
            subtitle="Son onay öncesi 9 soru"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              {[
                'Doğru şirket seçili mi?',
                'Tüm sayfalar eşleşti mi (ya da bilinçli olarak atlandı mı)?',
                'Zorunlu alanlar eşleşti mi?',
                'Dry-run hataları gözden geçirildi mi?',
                'Uyarılar kabul edilebilir mi?',
                'Oluştur/güncelle sayıları beklenen aralıkta mı?',
                'Orphan satır var mı? Varsa farkında mıyız?',
                'Kaynak dosyanın yedeği saklandı mı?',
                'Gerekirse rollback yapmaya hazır mıyız?',
              ].map((line, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-emerald-500" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </AccordionItem>

          {/* §18 — After import */}
          <AccordionItem
            title="18. Aktarımdan sonra"
            icon={<History size={14} />}
            subtitle="Doğrulama, audit ve gerekirse rollback"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Sonuç panelindeki sayımları (oluşturuldu/güncellendi/atlandı/hata) gözden geçirin.</li>
              <li>• Rastgele 2-3 müşteri kartını açıp doğru görünüp görünmediğini kontrol edin (spot-check).</li>
              <li>• Job id'sini ve özet sonucu audit için kaydedin.</li>
              <li>• Yanlış bir şey fark edilirse <strong>başka bir düzeltici aktarım yapmadan önce</strong> bu job'ı rollback edin; aksi halde rollback yapma şansınız azalır.</li>
              <li>• Büyük göçlerde önce küçük bir alt küme ile prova aktarımı yapmak (örn. 50 müşteri) yaygın iyi uygulamadır.</li>
            </ul>
          </AccordionItem>

          {/* Ek — Standard 5-sheet file format reminder for users not using the template. */}
          <AccordionItem
            title="Ek — Müşteri 360 standart dosya formatı"
            icon={<FileSpreadsheet size={14} />}
            subtitle="Şablonu kullanmıyorsanız bu sayfa adlarını kullanın"
            defaultOpen={false}
          >
            <div className="space-y-2 text-xs text-slate-700 dark:text-ndark-muted">
              <div>
                Standart sayfa adları:
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {['Accounts', 'Companies', 'Contacts', 'Addresses', 'Projects'].map((s) => (
                    <span
                      key={s}
                      className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] dark:border-ndark-border dark:bg-ndark-card"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <ul className="ml-2 space-y-1">
                <li>• Bu adları kullanıyorsanız Sheet Eşleştirme Sihirbazı tek tıkla geçilebilir.</li>
                <li>• Türkçe karşılıkları da otomatik tanınır: Müşteriler, Şirketler, İletişim Kişileri, Adresler, Projeler.</li>
                <li>• Farklı adlar kullanılırsa sihirbazda manuel eşleştirin.</li>
              </ul>
            </div>
          </AccordionItem>
        </Accordion>
      </div>
    </Drawer>
  );
}

function ModeCard({
  icon,
  title,
  badge,
  points,
}: {
  icon: ReactNode;
  title: string;
  badge: string;
  points: string[];
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-slate-500 dark:text-ndark-muted">{icon}</span>
        <span className="text-sm font-semibold text-slate-800 dark:text-ndark-text">{title}</span>
        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          {badge}
        </span>
      </div>
      <ul className="space-y-1 text-[11px] text-slate-600 dark:text-ndark-muted">
        {points.map((p, i) => (
          <li key={i}>• {p}</li>
        ))}
      </ul>
    </div>
  );
}
