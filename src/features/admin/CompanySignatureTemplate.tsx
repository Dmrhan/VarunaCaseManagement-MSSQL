/**
 * Compose-Signature F2 — Şirket İmza Şablonu editörü.
 *
 * AdminExternalMailPage'in EN ALTINDA, FromAlias yönetiminden sonra
 * render edilir. Şirketin tek bir HTML şablonu vardır; placeholder'lar
 * `{{agent.name}}` + `{{agent.title}}` ile mail dispatch anında User →
 * Person üzerinden interpolate edilir.
 *
 * REUSE: TipTap RichTextEditor (UserSignatureModal'da kullanılan aynı
 * bileşen), adminService.externalMailSettings.save (mevcut PATCH),
 * notificationRepository.renderTemplate (canlı önizleme için frontend'de
 * basit replace; backend sanitize edip kaydeder).
 *
 * UX kararları (n4b parite + advisor):
 *  - Placeholder paleti — tıkla-ekle butonları + açıklama (HELP)
 *  - CANLI ÖNİZLEME — örnek isim/title ile render
 *  - Empty-state — "Henüz şablon yok" + örnek yükle butonu
 *  - Save sanitize-html backend'de; XSS koruma
 *
 * Lazy loaded — TipTap ağır (~133 KB chunk); main bundle'a girmesin.
 */
import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { RichTextEditor } from '@/features/cases/components/RichTextEditor';
import { adminService } from '@/services/adminService';

export function CompanySignatureTemplate({ companyId }: { companyId: string }) {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [initialHtml, setInitialHtml] = useState<string>('');
  // Codex P2 fix — load failure preserve (M6.3b UserSignatureModal paterni).
  // get() undefined dönerse mevcut şablonun üstüne yazılma riskine karşı
  // editor düzenleme dışı + retry banner. Aksi halde transient network
  // hatasında editor blank açılır → save → mevcut şablonu siler.
  const [loadFailed, setLoadFailed] = useState(false);
  const { toast } = useToast();

  const SAMPLE_NAME = 'Demirhan İşbakan';
  const SAMPLE_TITLE = 'Ürün Direktörü';

  function loadTemplate() {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    void adminService.externalMailSettings.get(companyId).then((s) => {
      if (cancelled) return;
      if (s === undefined) {
        // fetch fail — apiFetch zaten toast attı; editor'ı düzenleme dışı tut.
        setLoadFailed(true);
        setHtml('');
        setInitialHtml('');
      } else {
        const init = s?.signatureHtml ?? '';
        setHtml(init);
        setInitialHtml(init);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }

  useEffect(() => {
    return loadTemplate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const dirty = html !== initialHtml;

  function insertPlaceholder(token: string) {
    setHtml((cur) => cur + token);
  }

  async function handleSave() {
    if (loadFailed) return; // Codex P2 — yüklenemeyen şablonu yanlışlıkla silme.
    setBusy(true);
    // Codex P2 fix — TipTap boş çıktıda "<p></p>" döndürür → `html || null`
    // truthy sayar ve "boş ama configured" şablon kaydeder. M6.3b
    // UserSignatureModal paterni: strip-tags + image presence kontrolü;
    // sadece metinsiz ve görselsiz ise null geç (gerçek clear).
    const textOnly = html.replace(/<[^>]+>/g, '').trim();
    const hasImg = /<img\b/i.test(html);
    const payload = (textOnly || hasImg) ? html : null;
    const r = await adminService.externalMailSettings.save(companyId, { signatureHtml: payload });
    setBusy(false);
    if (r.ok) {
      toast({ type: 'success', title: 'Şirket imza şablonu kaydedildi', message: '' });
      setInitialHtml(payload ?? '');
      if (payload === null) setHtml('');
    } else {
      toast({ type: 'error', title: 'Kaydedilemedi', message: r.error });
    }
  }

  async function handleReset() {
    if (!dirty || loadFailed) return;
    if (!confirm('Yapılan değişiklikler kaybolacak. Devam edilsin mi?')) return;
    setHtml(initialHtml);
  }

  function loadExampleTemplate() {
    const example = `<p><strong>{{agent.name}}</strong></p>
<p style="color:#6b7280">{{agent.title}}</p>
<hr style="border-color:#e5e7eb"/>
<p><strong>Univera</strong></p>
<p>Adres: <i>(şirketinizin adresi)</i></p>
<p>Tel: <i>(şirket telefonu)</i></p>
<p><a href="https://www.univera.com.tr">www.univera.com.tr</a></p>`;
    setHtml(example);
  }

  // Compose-Signature F4 — Defense-in-depth: canlı önizleme path'i
  // DOMPurify sarmal (MailMessageCard ile aynı pattern).
  // Backend M6.1 sanitize-html save öncesi zaten temizler ama editör
  // henüz kaydedilmemiş raw HTML render edilir → admin kendi şablonunda
  // bir hata/typo (örn. <script> yazsa) preview'da çalıştırılmasın.
  //
  // ALLOWED_ATTR/FORBID_TAGS: MailMessageCard preview ile aynı seti
  // tutalım (tutarlılık).
  const safePreviewHtml = useMemo(() => {
    const rendered = html
      .replaceAll('{{agent.name}}', SAMPLE_NAME)
      .replaceAll('{{agent.title}}', SAMPLE_TITLE);
    return DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'width', 'height', 'style', 'class'],
      FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed', 'link', 'meta', 'style'],
    });
  }, [html]);

  const isEmpty = !html.trim();

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold text-slate-800 dark:text-ndark-text">Şirket İmza Şablonu</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-ndark-muted">
          Giden mail'lerin altına otomatik eklenen şirket bloğu. Kişisel kısım
          (ad + unvan) her agent için Person kartından otomatik doldurulur —
          adres veya logo değiştirdiğinizde TÜM agent'ların imzaları kendiliğinden güncellenir.
        </p>
      </CardHeader>
      <CardBody>
        {loading ? (
          <p className="text-sm text-slate-400">Yükleniyor…</p>
        ) : loadFailed ? (
          // Codex P2 fix — load fail banner. Editor düzenleme dışı; save
          // disable. Aksi halde transient hata mevcut şablonu siler.
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
            <p className="mb-2 font-medium">Şablon yüklenemedi</p>
            <p className="mb-3 text-xs">
              Mevcut şirket imzanız okunamadı. Bu durumda kaydetmek mevcut
              şablonu yanlışlıkla silebilir; önce yeniden yüklemeyi deneyin.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => loadTemplate()}
            >
              Tekrar Dene
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-ndark-border dark:bg-ndark-bg">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Hızlı placeholder ekle
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline"
                  onClick={() => insertPlaceholder('{{agent.name}}')}
                  title="Kişinin adını otomatik doldurur (Person kartından)">
                  + {`{{agent.name}}`}
                </Button>
                <Button type="button" size="sm" variant="outline"
                  onClick={() => insertPlaceholder('{{agent.title}}')}
                  title="Kişinin unvanını otomatik doldurur (Person kartından)">
                  + {`{{agent.title}}`}
                </Button>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Bu placeholder'lar mail gönderilirken her agent için ayrı doldurulur.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Şablon (HTML)
                </label>
                {isEmpty ? (
                  <div className="rounded-md border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center dark:border-ndark-border dark:bg-ndark-bg">
                    <p className="mb-2 text-sm font-medium text-slate-700 dark:text-ndark-text">
                      Henüz şirket imzası tanımlı değil
                    </p>
                    <p className="mb-3 text-xs text-slate-500">
                      Bir kez kurun; tüm agent'lar otomatik kullanır.
                    </p>
                    <Button type="button" variant="primary" onClick={loadExampleTemplate}>
                      Örnek Şablon Yükle
                    </Button>
                  </div>
                ) : (
                  <RichTextEditor value={html} onChange={setHtml} />
                )}
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Canlı önizleme
                  <span className="ml-2 font-normal lowercase text-slate-400">
                    örnek: {SAMPLE_NAME} / {SAMPLE_TITLE}
                  </span>
                </label>
                <div className="prose prose-sm max-w-none rounded-md border border-slate-200 bg-white p-3 text-sm dark:prose-invert dark:border-ndark-border dark:bg-ndark-card"
                  dangerouslySetInnerHTML={{ __html: safePreviewHtml || '<p class="text-slate-400">Önizleme burada görünür.</p>' }}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => void handleReset()} disabled={!dirty || busy || loadFailed}>
                Vazgeç
              </Button>
              <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={!dirty || busy || loadFailed}>
                {busy ? 'Kaydediliyor…' : 'Kaydet'}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default CompanySignatureTemplate;
