/**
 * WR-A8 — Veri Aktarım Stüdyosu in-page help panel.
 *
 * Yan çekmece (Drawer) içinde operator-friendly Türkçe rehber. Açıldığında
 * import akışını sıfırlamaz; mevcut şirket seçimi, kaynak, mapping ve
 * dry-run state'i korunur. Pure UI: no service calls, no backend mutation.
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
} from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ImportHelpPanel({ open, onClose }: Props) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <HelpCircle size={16} /> Veri Aktarım Stüdyosu nasıl çalışır?
        </span>
      }
      subtitle="Excel/CSV veya API üzerinden gelen müşteri verilerini Varuna'ya kontrollü, görsel ve geri alınabilir biçimde aktarın."
      width="xl"
    >
      <div className="space-y-3 px-4 py-3">
        {/* §1 — Page purpose */}
        <p className="text-xs text-slate-600 dark:text-ndark-muted">
          Bu rehber sayfa içinde açıktır. Kapatmak güvenlidir: şirket seçimi, kaynak, mapping ve dry-run sonuçların korunur — akış sıfırlanmaz.
        </p>

        <Accordion>
          {/* §2 — Two import modes */}
          <AccordionItem
            title="İki içe aktarım türü"
            icon={<Workflow size={14} />}
            subtitle="Müşteri Ana Kartı (tekil Account) vs. Müşteri 360 (multi-entity)"
            defaultOpen
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ModeCard
                icon={<Database size={14} />}
                title="Müşteri Ana Kartı"
                badge="canlı"
                points={[
                  'Tekil müşteri ana kartı (Account) aktarımıdır.',
                  'Account temel alanlarını işler (ad, VKN, müşteri tipi, iletişim, …).',
                  'Dry-run sonrası commit yapılabilir.',
                  'Geri alma (rollback) desteklenir.',
                ]}
              />
              <ModeCard
                icon={<Users size={14} />}
                title="Müşteri 360"
                badge="canlı"
                points={[
                  'Müşteri ana kartı + ilişkili şirket + iletişim + adres + projeleri birlikte işler.',
                  '5 sheet\'li XLSX veya nested API JSON destekler.',
                  'Her aktarım seçili şirkete bağlıdır.',
                  'Dry-run zorunludur; başarılıysa commit edilebilir.',
                  'Commit sonrası rollback ile geri alınabilir.',
                ]}
              />
            </div>
          </AccordionItem>

          {/* §3 — Step-by-step flow */}
          <AccordionItem
            title="Adım adım akış"
            icon={<PlayCircle size={14} />}
            subtitle="Şirket → kaynak → eşleştirme → dry-run → commit → rollback"
            defaultOpen
          >
            <ol className="space-y-1.5 text-xs">
              {[
                'Şirket seç',
                'Kaynak seç (dosya veya API)',
                'Dosya yükle ya da API\'den veri al',
                'Alanları hedef alanlara eşleştir',
                'Doğrula ve dry-run çalıştır',
                'Ön izlemede hata ve uyarıları kontrol et',
                'Commit / içe aktarımı başlat',
                'Gerekirse rollback ile geri al',
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

          {/* §4 — Dry-run */}
          <AccordionItem
            title="Dry-run ne demek?"
            icon={<CircleDot size={14} />}
            subtitle="Önizleme — kayıt yazılmaz, simülasyon"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Dry-run <strong>gerçek kayıt yazmaz</strong>. Kaynak verinin Varuna'ya nasıl işleneceğini simüle eder.</li>
              <li>• Hangi kayıt oluşturulacak, hangisi güncellenecek, hangisi hata alacak görülebilir.</li>
              <li>• Dry-run başarılıysa ekranda <strong>"Commit hazır"</strong> görünür.</li>
              <li>• Dry-run hatalıysa hatalar düzeltilmeli ya da skipErrors açıklanmalıdır.</li>
            </ul>
          </AccordionItem>

          {/* §5 — Commit */}
          <AccordionItem
            title="Commit ne demek?"
            icon={<Rocket size={14} />}
            subtitle="Gerçek aktarımı başlatır"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• <strong>Commit</strong> gerçek aktarımı başlatır ve veritabanına yazar.</li>
              <li>
                • Müşteri 360 için sıralama:{' '}
                <code className="font-mono text-[11px]">Müşteri → İlişkili Şirket → İletişim → Adres → Proje</code>.
              </li>
              <li>• Bu bağımlılık sırası, alt kayıtların doğru müşteriye bağlanmasını sağlar.</li>
              <li>• Aynı job tekrar gönderilirse tamamlanmış satırlar atlanır (idempotent).</li>
            </ul>
          </AccordionItem>

          {/* §6 — Rollback */}
          <AccordionItem
            title="Rollback ne demek?"
            icon={<Undo2 size={14} />}
            subtitle="Aktarımı geri alır"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• <strong>Rollback</strong>, yapılan aktarımı geri alır.</li>
              <li>• Oluşturulan kayıtlar pasife alınır (soft deactivate). Sert silme yapılmaz.</li>
              <li>• Güncellenen kayıtlar eski değerlerine döndürülür.</li>
              <li>• Ters bağımlılık sırasında ilerler: Proje → Adres → İletişim → İlişkili Şirket → Müşteri.</li>
              <li>• Bazı satırlar geri alınamazsa ekranda <strong>kısmi geri alma</strong> uyarısı ve satır detayları gösterilir.</li>
            </ul>
          </AccordionItem>

          {/* §7 — Warnings vs Errors */}
          <AccordionItem
            title="Uyarı, hata ve skipErrors"
            icon={<AlertTriangle size={14} />}
            subtitle="Aktarım sırasında ne ne demek?"
            defaultOpen={false}
            tint="rose"
          >
            <div className="space-y-2 text-xs text-slate-700 dark:text-ndark-muted">
              <div>
                <strong className="text-amber-700 dark:text-amber-300">Uyarı (warning):</strong>{' '}
                Aktarım devam edebilir ama operator kontrol etmeli. Örn. VKN eksik, source companyId yok sayıldı.
              </div>
              <div>
                <strong className="text-rose-700 dark:text-rose-300">Hata (error):</strong>{' '}
                Satır işlenemez; düzeltilmesi gerekir.
              </div>
              <div className="rounded-md bg-slate-50 p-2 dark:bg-ndark-card">
                <div>
                  <code>skipErrors=false</code> → Hata varsa <strong>commit bloklanır</strong>. Hiçbir kayıt yazılmaz.
                </div>
                <div>
                  <code>skipErrors=true</code> → Hatalı satırlar <strong>atlanır</strong>, uygun satırlar işlenir.
                  Sonuç durumu <em>partial</em> (kısmen tamamlandı) olur.
                </div>
              </div>
            </div>
          </AccordionItem>

          {/* §8 — Müşteri 360 file format */}
          <AccordionItem
            title="Müşteri 360 dosya formatı"
            icon={<FileSpreadsheet size={14} />}
            subtitle="Beklenen sheet'ler ve adlandırma"
            defaultOpen={false}
          >
            <div className="space-y-2 text-xs text-slate-700 dark:text-ndark-muted">
              <div>
                Beklenen sheet'ler:
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
                <li>• Sheet isimleri bu adlarla eşleşmelidir. Eşleşmeyen sayfalar atlanır.</li>
                <li>• Her entity ilişki ağacında ayrı kutu olarak görünür.</li>
                <li>• Yalnızca Müşteri Ana Kartı sheet'i (Accounts) doluysa, sadece account commit edilir.</li>
                <li>
                  • Test için örnek Customer 360 dosyaları kullanılabilir;{' '}
                  <strong>"Şablon İndir"</strong> butonu boş bir başlık satırı CSV indirir.
                </li>
              </ul>
            </div>
          </AccordionItem>

          {/* §9 — Relationship Graph */}
          <AccordionItem
            title="İlişki Ağacı"
            icon={<Network size={14} />}
            subtitle="Yüklenen verinin görsel haritası"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• İlişki ağacı, yüklenen verinin müşteri etrafında nasıl bağlanacağını gösterir.</li>
              <li>
                • <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">yeşil</span>{' '}
                sağlıklı,{' '}
                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">sarı</span>{' '}
                uyarılı,{' '}
                <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">kırmızı</span>{' '}
                hatalı alanı gösterir.
              </li>
              <li>• Bir entity kutusuna tıklayarak o entity'nin alan eşleştirmesini görebilirsiniz.</li>
              <li>• Orphan (parent'ı bulunamayan) child kayıtlar ayrıca etiketlenir.</li>
            </ul>
          </AccordionItem>

          {/* §10 — Security / data safety */}
          <AccordionItem
            title="Güvenlik ve veri koruma"
            icon={<ShieldCheck size={14} />}
            subtitle="Aktarım sınırları ve gizlilik"
            defaultOpen={false}
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>• Aktarım yalnız seçili şirket kapsamındadır. Başka şirket verisine yazılmaz.</li>
              <li>• Source row'da farklı bir <code>companyId</code> varsa <strong>yok sayılır</strong> (selected company belirleyici).</li>
              <li>
                • <strong>TCKN import edilmez.</strong> Kaynak verisinde TCKN benzeri sütun bulunursa aktarım bloklanır
                (<code>tckn_import_blocked</code>).
              </li>
              <li>• API kaynağı kullanılırsa API secret <strong>tarayıcıda saklanmaz</strong>; sadece env değişkeninin <em>adı</em> kullanılır, değer sunucu tarafında resolve edilir.</li>
              <li>• Hiçbir kayıt sert silinmez (no hard delete). Rollback soft deactivate veya field restore yapar.</li>
            </ul>
          </AccordionItem>

          {/* §11 — Common mistakes */}
          <AccordionItem
            title="Sık karşılaşılan durumlar"
            icon={<AlertTriangle size={14} />}
            subtitle="Aktarımdan önce hızlı kontrol listesi"
            defaultOpen={false}
            tint="rose"
          >
            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-ndark-muted">
              <li>
                <CheckCircle2 size={11} className="mr-1 inline text-emerald-500" />
                Yanlış şirket seçilmişse sonuçlar yanlış scope'a düşebilir; aktarımdan önce şirketi kontrol et.
              </li>
              <li>
                <CheckCircle2 size={11} className="mr-1 inline text-emerald-500" />
                Sheet adı yanlışsa veri görünmez. (Accounts/Companies/Contacts/Addresses/Projects)
              </li>
              <li>
                <CheckCircle2 size={11} className="mr-1 inline text-emerald-500" />
                Zorunlu alan eşleşmemişse dry-run hata verir.
              </li>
              <li>
                <CheckCircle2 size={11} className="mr-1 inline text-emerald-500" />
                Çok fazla hata varsa önce dosyada düzelt, sonra yeniden yükle.
              </li>
              <li>
                <CheckCircle2 size={11} className="mr-1 inline text-emerald-500" />
                Commit sonrası yanlışlık fark edilirse <strong>"Bu Aktarımı Geri Al"</strong> butonunu kullan.
              </li>
            </ul>
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
