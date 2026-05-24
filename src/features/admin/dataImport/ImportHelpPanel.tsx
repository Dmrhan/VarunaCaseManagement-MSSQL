/**
 * WR-A8 — Veri Aktarım Stüdyosu in-page operator guide.
 *
 * Drawer içinde gruplanmış, daraltılabilir, taranabilir bir rehber.
 * Açma/kapatma import akışını sıfırlamaz; mevcut şirket seçimi, kaynak,
 * mapping ve dry-run state'i korunur. Pure UI — backend çağrısı yoktur.
 *
 * Yapı:
 *  - Üstte Hızlı Başlangıç (6 adım) + "Ne zaman kullanılır?" karşılaştırma.
 *  - Dört bölüm halinde gruplanmış accordion'lar (A/B/C/D).
 *  - Sticky footer: kritik hatırlatmalar + Kapat.
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
  Zap,
  X,
} from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';

interface Props {
  open: boolean;
  onClose: () => void;
}

const QUICK_STEPS: { label: string; hint: string }[] = [
  { label: 'Şirketi seç',                       hint: 'Aktarımın hedef tenant\'ı seçili şirkettir.' },
  { label: 'Şablonu indir veya dosyayı yükle',  hint: 'En güvenli başlangıç için Şablon İndir.' },
  { label: 'Sheetleri eşleştir',                hint: 'Her sayfayı bir veya birden fazla veri tipine bağlayın.' },
  { label: 'Alanları eşleştir',                 hint: 'Kaynak kolonları Varuna alanlarına eşleyin.' },
  { label: 'Dry-run çalıştır',                  hint: 'Önizleme; veritabanına hiçbir kayıt yazılmaz.' },
  { label: 'Commit / gerekirse rollback',       hint: 'Sonucu denetleyin; gerekirse geri alın.' },
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
      subtitle="Hızlı başlangıç, ayrıntılı bölümler ve sorun giderme tek panelde."
      width="xl"
      footer={
        <div className="flex items-center justify-between gap-3 text-[11px] text-slate-600 dark:text-ndark-muted">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-200">
              <ShieldCheck size={11} /> Dry-run yazmadan commit yapılmaz.
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              <Building2 size={11} /> Şirket seçimini commit öncesi mutlaka doğrulayın.
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-brand-400 hover:bg-brand-50/40 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
          >
            <X size={12} /> Kapat
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-4 py-3">
        {/* — Hızlı Başlangıç — */}
        <section className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-700/40 dark:bg-emerald-900/15">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
            <Zap size={12} /> Hızlı Başlangıç
          </div>
          <ol className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
            {QUICK_STEPS.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-300 bg-white text-[10px] font-semibold text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                  {i + 1}
                </span>
                <span>
                  <span className="font-medium text-slate-800 dark:text-ndark-text">{s.label}</span>
                  <span className="ml-1 text-slate-600 dark:text-ndark-muted">— {s.hint}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* — Ne zaman kullanılır? — */}
        <section>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
            <Workflow size={12} /> Ne zaman kullanılır?
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-white p-2.5 dark:border-ndark-border dark:bg-ndark-card">
              <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-ndark-text">
                <Database size={12} /> Müşteri Ana Kartı
              </div>
              <p className="text-[11px] text-slate-600 dark:text-ndark-muted">
                Mevcut müşteri listenizi güncellemek için. Tekil Account aktarımı.
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-2.5 dark:border-ndark-border dark:bg-ndark-card">
              <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-ndark-text">
                <Users size={12} /> Müşteri 360
              </div>
              <p className="text-[11px] text-slate-600 dark:text-ndark-muted">
                İlk kurulum / çoklu ilişkili veri (şirket, iletişim, adres, proje).
              </p>
            </div>
          </div>
        </section>

        <p className="text-[11px] text-slate-500 dark:text-ndark-muted">
          Bu rehberi açıp kapatmak akışı sıfırlamaz; şirket seçimi, kaynak, mapping ve dry-run sonuçlarınız korunur.
        </p>

        {/* ───────────────────── Group A ───────────────────── */}
        <GroupHeader letter="A" title="Başlangıç" hint="Sayfanın amacı, türler ve şirket kapsamı" />
        <Accordion>
          <AccordionItem
            title="Bu sayfa ne işe yarar?"
            icon={<HelpCircle size={14} />}
            subtitle="Genel amaç ve güvenlik felsefesi"
            defaultOpen={false}
          >
            <p className="text-xs leading-relaxed text-slate-700 dark:text-ndark-muted">
              Bu sayfa, Excel/CSV dosyanızı veya bir API kaynağını Varuna müşteri verilerine dönüştürür.
              Tasarımı, hatalı yazımı önlemek üzerine kuruludur: her commit öncesi <strong>dry-run</strong>{' '}
              (önizleme) zorunludur, her commit denetlenebilir ve desteklenen yerlerde <strong>geri alınabilir</strong>.
            </p>
          </AccordionItem>

          <AccordionItem
            title="Müşteri Ana Kartı mı, Müşteri 360 mı?"
            icon={<Workflow size={14} />}
            subtitle="İki içe aktarım türünün ayrıntıları"
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
                ]}
              />
            </div>
          </AccordionItem>

          <AccordionItem
            title="İlk kullanım adımları"
            icon={<PlayCircle size={14} />}
            subtitle="Onboarding aktarımı için 11 adımlık yol"
            defaultOpen={false}
          >
            <ol className="space-y-1.5 text-xs">
              {[
                'Doğru şirketi seçin.',
                'Mümkünse "Şablon İndir" ile başlangıç dosyasını alın.',
                'Verinizi şablona göre Excel\'de hazırlayın.',
                'Dosyayı yükleyin.',
                'Sheet Eşleştirme Sihirbazı’nda her sayfayı doğru veri tipine bağlayın.',
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

          <AccordionItem
            title="Şirket seçimi ve kapsamı"
            icon={<Building2 size={14} />}
            subtitle="Aktarımın hedef tenant'ı her zaman seçili şirkettir"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Sayfanın üst kısmındaki şirket seçimi tüm aktarımın <strong>kapsamı</strong>dır.</li>
              <li>• Müşteri 360'ta Müşteri-Şirket satırlarındaki <code>companyCode</code> boş bırakılırsa otomatik olarak <strong>seçili şirkete</strong> bağlanır.</li>
              <li>• <code>companyCode</code> dolu ama seçili şirketten farklıysa satır reddedilir (<em>account_company_selected_company_mismatch</em>).</li>
              <li>• Yanlış şirket seçilirse veri yanlış tenant için hazırlanır. Yükleme öncesi ve commit öncesi şirketi mutlaka doğrulayın.</li>
              <li>• Kaynak satırlarda farklı bir <code>companyId</code> alanı varsa <strong>yok sayılır</strong> (<em>source_company_id_ignored</em>).</li>
            </ul>
          </AccordionItem>
        </Accordion>

        {/* ───────────────────── Group B ───────────────────── */}
        <GroupHeader letter="B" title="Dosya / API Hazırlığı" hint="Kaynak, sheet ve alan eşleştirme" />
        <Accordion>
          <AccordionItem
            title="Şablon İndir"
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
                    <SheetChip key={s} label={s} />
                  ))}
                </div>
              </div>
              <ul className="ml-2 space-y-1">
                <li>• <strong>README</strong>: zorunlu alanlar, bağlantı anahtarları, örnek değerler.</li>
                <li>• Her veri sayfasında örnek satır vardır; kendi verinizle değiştirebilirsiniz.</li>
                <li>• Başlıklar Varuna alan isimleriyle birebir eşleştiği için alan eşleştirme adımı tek tıklama olur.</li>
              </ul>
            </div>
          </AccordionItem>

          <AccordionItem
            title="Sheet Eşleştirme Sihirbazı"
            icon={<Sparkles size={14} />}
            subtitle="Her sayfayı bir veya birden fazla veri tipine bağlayın"
            defaultOpen
          >
            <div className="space-y-2 text-xs text-slate-700 dark:text-ndark-muted">
              <p>
                Excel'deki sayfa adları önemli değildir. Sihirbaz her sayfayı gösterir ve hangi veri tipine
                bağlanacağını seçmenizi ister.
              </p>
              <div className="rounded-md bg-slate-50 p-2 dark:bg-ndark-card">
                <div className="mb-1 font-medium text-slate-700 dark:text-ndark-text">Seçenekler:</div>
                <div className="flex flex-wrap gap-1.5">
                  {['Müşteriler', 'Müşteri-Şirket İlişkileri', 'İletişim Kişileri', 'Adresler', 'Projeler', 'Atla'].map((e) => (
                    <SheetChip key={e} label={e} />
                  ))}
                </div>
              </div>
              <ul className="ml-2 space-y-1">
                <li>• <strong>Bir sayfa birden fazla veri tipine eşlenebilir.</strong> Örn. müşteri ve şirket bilgileri tek sayfadaysa o sayfayı hem "Müşteriler" hem "Müşteri-Şirket İlişkileri"ne bağlayabilirsiniz.</li>
                <li>• Bilinmeyen sayfalar otomatik alınmaz; ya eşleştirin ya <strong>Atla</strong> ile geçin.</li>
                <li>• "Müşteriler"e en az bir sayfa eşlenmeden Devam butonu aktif olmaz.</li>
                <li>• Sayfaları genişleterek kolon listesi ve ilk 3 örnek satırı görebilirsiniz.</li>
                <li>• Sistem sayfa adları ve kolon başlıklarından otomatik başlangıç önerileri sunabilir (bu grubun son bölümü).</li>
              </ul>
            </div>
          </AccordionItem>

          <AccordionItem
            title="Alan Eşleştirme"
            icon={<Workflow size={14} />}
            subtitle="Kaynak kolon → Varuna alanı"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Sheet eşleştirmesi sonrası entity başına alan eşleştirme açılır.</li>
              <li>• Sistem alias listesi + kolon adından otomatik öneri yapar; her satırı değiştirebilirsiniz.</li>
              <li>• <strong>Zorunlu alanlar</strong> başlıkta belirgindir; eşleşmezse dry-run hata verir.</li>
              <li>• <strong>PII / hassas alanlar</strong> ayrıca işaretlenir; bilinçli eşleyin.</li>
              <li>• Kullanmak istemediğiniz kolon için "eşleşmedi" seçin — alan atlanır.</li>
              <li>• Dropdown seçim, dış-tık veya <kbd className="rounded border border-slate-300 bg-white px-1 text-[10px] dark:border-ndark-border dark:bg-ndark-card">Esc</kbd> ile kapanır; yanlışlıkla kapanmaz.</li>
            </ul>
          </AccordionItem>

          <AccordionItem
            title="API kaynağı"
            icon={<Globe2 size={14} />}
            subtitle="Excel yerine canlı entegrasyon"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Excel/CSV yerine bir API'den veri çekilebilir.</li>
              <li>• URL, method (GET/POST), header'lar ve body sağlayabilirsiniz.</li>
              <li>• <strong>API secret'ları tarayıcıda saklanmaz.</strong> Sadece env değişkeninin <em>adı</em> kullanılır; değer sunucuda resolve edilir.</li>
              <li>• Nested JSON için <code>dataPath</code> alanına accounts dizisinin yolunu yazın (örn. <code>data.customers</code>).</li>
              <li>• API verisi de aynı güvenlik adımlarından geçer: alan eşleştirme → dry-run → commit.</li>
            </ul>
          </AccordionItem>

          <AccordionItem
            title="Otomatik Sheet Önerileri"
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
                Bu öneriler yalnızca başlangıç noktasıdır. Her sayfanın hangi veri tipine bağlanacağını
                siz belirlersiniz. Gerekirse bir sayfayı birden fazla veri tipine bağlayabilir veya
                kullanmayacağınız sayfaları <strong>"Atla"</strong> olarak işaretleyebilirsiniz. Bu
                aşamada veritabanına hiçbir kayıt yazılmaz.
              </p>
            </div>
          </AccordionItem>
        </Accordion>

        {/* ───────────────────── Group C ───────────────────── */}
        <GroupHeader letter="C" title="Güvenli Aktarım" hint="Dry-run, commit, rollback ve güvenceler" />
        <Accordion>
          <AccordionItem
            title="İlişki Ağacı"
            icon={<Network size={14} />}
            subtitle="Yeşil/sarı/kırmızı sağlık göstergesi"
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
                  • <StatusPill color="emerald">Yeşil</StatusPill> sağlıklı (zorunlu alanlar eşli, dry-run temiz).
                </li>
                <li>
                  • <StatusPill color="amber">Sarı</StatusPill> uyarı var (örn. eksik opsiyonel alan, otomatik bind).
                </li>
                <li>
                  • <StatusPill color="rose">Kırmızı</StatusPill> hata var (eksik zorunlu, orphan satır vb.).
                </li>
                <li>• Bir entity kutusuna tıklayarak o entity'nin eşleştirmesini ve örnek satırlarını açabilirsiniz.</li>
              </ul>
            </div>
          </AccordionItem>

          <AccordionItem
            title="Dry-run nedir?"
            icon={<CircleDot size={14} />}
            subtitle="Önizleme — veritabanına yazma yok"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Dry-run <strong>hiçbir kayıt yazmaz</strong>. Ne olacağını simüle eder.</li>
              <li>• Sonucu şunları gösterir:
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
              <li>• Sonuç izin verdiğinde Commit butonu aktif olur.</li>
              <li>• Dosya veya eşleştirme değişirse dry-run yeniden çalıştırılmalıdır.</li>
            </ul>
          </AccordionItem>

          <AccordionItem
            title="Uyarı, Hata ve skipErrors"
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

          <AccordionItem
            title="Commit"
            icon={<Rocket size={14} />}
            subtitle="Gerçek aktarımı başlatır"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Commit, veriyi veritabanına yazar. Dry-run'ı atlamayın.</li>
              <li>• Müşteri 360 için bağımlılık sırası uygulanır:{' '}
                <code className="font-mono text-[11px]">Müşteri → Müşteri-Şirket → İletişim → Adres → Proje</code>.
              </li>
              <li>• Aynı job tekrar gönderilirse tamamlanmış satırlar atlanır (idempotent).</li>
              <li>• Sonuç panelinde entity başına <strong>oluşturuldu/güncellendi/atlandı/hata</strong> sayıları görülür.</li>
              <li>• Job audit edilebilir; job id'sini saklayın.</li>
            </ul>
          </AccordionItem>

          <AccordionItem
            title="Rollback"
            icon={<Undo2 size={14} />}
            subtitle="Aktarımı geri alır"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Commit edilen aktarımı geri alır (destek olan yerlerde).</li>
              <li>• <strong>Oluşturulan</strong> kayıtlar pasife alınır / geri alınır (sert silme yapılmaz).</li>
              <li>• <strong>Güncellenen</strong> kayıtlar audit snapshot'larından eski değerlerine döner.</li>
              <li>• Ters bağımlılık sırasında çalışır: Proje → Adres → İletişim → Müşteri-Şirket → Müşteri.</li>
              <li>• Sonradan değişen kayıtlar varsa <strong>kısmi geri alma</strong> olabilir; panel hangi satırların geri alınamadığını listeler.</li>
            </ul>
          </AccordionItem>

          <AccordionItem
            title="Veri güvenliği güvenceleri"
            icon={<ShieldCheck size={14} />}
            subtitle="Sınırlar, TCKN, sert silme yok"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Her aktarımdan önce <strong>dry-run</strong> zorunludur.</li>
              <li>• Aktarım yalnız seçili şirket kapsamındadır; başka tenant'a yazılmaz.</li>
              <li>• <strong>TCKN aktarımı engellenir</strong> (<code>tckn_import_blocked</code>).</li>
              <li>• Normal aktarım akışında <strong>sert silme yoktur</strong>; rollback pasife alma + alan restore ile çalışır.</li>
              <li>• Commit sonrası rollback elinizin altındadır.</li>
              <li>• Job geçmişi audit için saklanır.</li>
              <li>• Açıkça değiştirmediğiniz mevcut/manuel müşteri verisi <strong>korunur</strong>.</li>
            </ul>
          </AccordionItem>
        </Accordion>

        {/* ───────────────────── Group D ───────────────────── */}
        <GroupHeader letter="D" title="Sorun Giderme" hint="Sık karşılaşılan durumlar, checklist ve referans" />
        <Accordion>
          <AccordionItem
            title="Sık karşılaşılan durumlar"
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

          <AccordionItem
            title="Commit öncesi operator kontrol listesi"
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

          <AccordionItem
            title="Aktarımdan sonra"
            icon={<History size={14} />}
            subtitle="Doğrulama, audit ve gerekirse rollback"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Sonuç panelindeki sayımları (oluşturuldu/güncellendi/atlandı/hata) gözden geçirin.</li>
              <li>• Rastgele 2-3 müşteri kartını açıp doğru görünüp görünmediğini kontrol edin (spot-check).</li>
              <li>• Job id'sini ve özet sonucu audit için kaydedin.</li>
              <li>• Yanlış bir şey fark edilirse <strong>başka bir düzeltici aktarım yapmadan önce</strong> bu job'ı rollback edin.</li>
              <li>• Büyük göçlerde önce küçük bir alt küme ile prova aktarımı yapmak yaygın iyi uygulamadır.</li>
            </ul>
          </AccordionItem>

          <AccordionItem
            title="Standart dosya formatı"
            icon={<FileSpreadsheet size={14} />}
            subtitle="Şablon kullanmıyorsanız beklenen sayfa adları"
            defaultOpen={false}
          >
            <div className="space-y-2 text-xs text-slate-700 dark:text-ndark-muted">
              <div>
                Standart sayfa adları:
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {['Accounts', 'Companies', 'Contacts', 'Addresses', 'Projects'].map((s) => (
                    <SheetChip key={s} label={s} />
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

// ─────────────────────────────────────────────────────────────
// Small presentational helpers
// ─────────────────────────────────────────────────────────────

function GroupHeader({ letter, title, hint }: { letter: string; title: string; hint: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 border-b border-slate-200 pb-1.5 dark:border-ndark-border">
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-500 text-[10px] font-bold text-white">
        {letter}
      </span>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-ndark-text">
        {title}
      </span>
      <span className="text-[11px] text-slate-500 dark:text-ndark-muted">— {hint}</span>
      <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-400">
        <ListChecks size={10} />
      </span>
    </div>
  );
}

function SheetChip({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] dark:border-ndark-border dark:bg-ndark-card">
      {label}
    </span>
  );
}

function StatusPill({ color, children }: { color: 'emerald' | 'amber' | 'rose'; children: ReactNode }) {
  const cls = {
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700',
  }[color];
  return (
    <span className={`inline-flex items-center gap-1 rounded ${cls} px-1.5 py-0.5 text-[10px] font-semibold`}>
      {children}
    </span>
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
