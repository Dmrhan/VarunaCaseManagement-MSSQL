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
import { useEffect, useState } from 'react';
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
  const { toast } = useToast();

  const SAMPLE_NAME = 'Demirhan İşbakan';
  const SAMPLE_TITLE = 'Ürün Direktörü';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void adminService.externalMailSettings.get(companyId).then((s) => {
      if (cancelled) return;
      const init = s?.signatureHtml ?? '';
      setHtml(init);
      setInitialHtml(init);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [companyId]);

  const dirty = html !== initialHtml;

  function insertPlaceholder(token: string) {
    setHtml((cur) => cur + token);
  }

  async function handleSave() {
    setBusy(true);
    const r = await adminService.externalMailSettings.save(companyId, { signatureHtml: html || null });
    setBusy(false);
    if (r.ok) {
      toast({ type: 'success', title: 'Şirket imza şablonu kaydedildi', message: '' });
      setInitialHtml(html);
    } else {
      toast({ type: 'error', title: 'Kaydedilemedi', message: r.error });
    }
  }

  async function handleReset() {
    if (!dirty) return;
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

  const previewHtml = html
    .replaceAll('{{agent.name}}', SAMPLE_NAME)
    .replaceAll('{{agent.title}}', SAMPLE_TITLE);

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
                  dangerouslySetInnerHTML={{ __html: previewHtml || '<p class="text-slate-400">Önizleme burada görünür.</p>' }}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => void handleReset()} disabled={!dirty || busy}>
                Vazgeç
              </Button>
              <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={!dirty || busy}>
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
