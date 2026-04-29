import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { StatusPill } from '@/components/ui/StatusPill';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { caseService, lookupService, type NewCaseInput } from '@/services/caseService';
import {
  CASE_ORIGINS,
  CASE_PRIORITIES,
  CASE_PRIORITY_LABELS,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  FINANCIAL_STATUSES,
  OFFER_OUTCOMES,
  PRODUCT_USAGES,
  RESPONSE_LEVELS,
  USAGE_CHANGE_ALERTS,
  type Case,
  type CaseOrigin,
  type CasePriority,
  type CaseRequestType,
  type CaseType,
  type FinancialStatus,
  type OfferOutcome,
  type ProductUsage,
  type ResponseLevel,
  type UsageChangeAlert,
} from './types';

interface NewCaseFormProps {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Case) => void;
  onShowExisting?: (caseId: string) => void;
}

const emptyForm = {
  title: '',
  description: '',
  caseType: 'GeneralSupport' as CaseType,
  priority: 'Medium' as CasePriority,
  origin: 'Telefon' as CaseOrigin,
  originDescription: '',
  companyId: '',
  accountId: '',
  category: '',
  subCategory: '',
  requestType: '' as '' | CaseRequestType,
  productGroup: '',
  assignedTeamId: '',
  assignedPersonId: '',

  // Spec 5.2 — ProactiveTracking (caseType=ProactiveTracking ile görünür; KURAL-3: tip değişince silinmez)
  financialStatus:    '' as '' | FinancialStatus,
  productUsage:       '' as '' | ProductUsage,
  usageChangeAlert:   '' as '' | UsageChangeAlert,
  responseLevel:      '' as '' | ResponseLevel,

  // Spec 5.3 — Churn
  cancellationRequest: false,
  offeredSolutions:    [] as string[],
  offerExpiryDate:     '',
  offerOutcome:        '' as '' | OfferOutcome,
  offerRejectionReason:'',
  actionTaken:         '',
  followUpDate:        '',
};

export function NewCaseForm({ open, onClose, onCreated, onShowExisting }: NewCaseFormProps) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicateCase, setDuplicateCase] = useState<Case | undefined>(undefined);
  const [overrideDuplicate, setOverrideDuplicate] = useState(false);

  const companies = useMemo(() => lookupService.companies(), []);
  const accounts = useMemo(() => lookupService.accounts(), []);
  const categories = useMemo(() => lookupService.categories(), []);
  const teams = useMemo(() => lookupService.teams(), []);
  const requestTypes = useMemo(() => lookupService.requestTypes(), []);
  const offeredSolutions = useMemo(() => lookupService.offeredSolutions(), []);

  const subCategories = useMemo(
    () => categories.find((c) => c.category === form.category)?.subCategories ?? [],
    [categories, form.category],
  );
  const personsForTeam = useMemo(
    () => (form.assignedTeamId ? lookupService.personsByTeam(form.assignedTeamId) : []),
    [form.assignedTeamId],
  );

  useEffect(() => {
    if (!open) {
      setForm(emptyForm);
      setErrors({});
      setDuplicateCase(undefined);
      setOverrideDuplicate(false);
    }
  }, [open]);

  // Reset subCategory if category changes invalidates it
  useEffect(() => {
    if (form.subCategory && !subCategories.includes(form.subCategory)) {
      setForm((f) => ({ ...f, subCategory: '' }));
    }
  }, [subCategories, form.subCategory]);

  // Reset person if team changes
  useEffect(() => {
    if (form.assignedPersonId && !personsForTeam.find((p) => p.id === form.assignedPersonId)) {
      setForm((f) => ({ ...f, assignedPersonId: '' }));
    }
  }, [personsForTeam, form.assignedPersonId]);

  // Spec KURAL-4: account + caseType için açık vaka var mı?
  useEffect(() => {
    let alive = true;
    setOverrideDuplicate(false);
    if (!form.accountId || !form.caseType) {
      setDuplicateCase(undefined);
      return;
    }
    void caseService.findOpenCaseFor(form.accountId, form.caseType).then((found) => {
      if (alive) setDuplicateCase(found);
    });
    return () => {
      alive = false;
    };
  }, [form.accountId, form.caseType]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = 'Başlık zorunlu';
    if (!form.description.trim()) e.description = 'Açıklama zorunlu';
    if (!form.companyId) e.companyId = 'Şirket seçilmeli';
    if (!form.accountId) e.accountId = 'Müşteri seçilmeli';
    if (!form.category) e.category = 'Kategori seçilmeli';
    if (!form.subCategory) e.subCategory = 'Alt kategori seçilmeli';
    if (!form.requestType) e.requestType = 'Talep türü seçilmeli';
    if (form.origin === 'Diğer' && !form.originDescription.trim())
      e.originDescription = 'Origin "Diğer" seçildiğinde açıklama zorunlu';
    // Spec 5.3 — Churn koşullu zorunluluklar
    if (form.caseType === 'Churn') {
      if (form.offerOutcome === 'Reddedildi' && !form.offerRejectionReason.trim()) {
        e.offerRejectionReason = 'Reddedildi seçildiğinde gerekçe zorunludur';
      }
      if (form.offerOutcome === 'Beklemede' && !form.followUpDate) {
        e.followUpDate = 'Beklemede outcome\'da takip tarihi zorunludur';
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    if (duplicateCase && !overrideDuplicate) return; // Spec KURAL-4: override gerekli
    setSubmitting(true);
    const account = accounts.find((a) => a.id === form.accountId)!;
    const company = companies.find((c) => c.id === form.companyId)!;
    const team = teams.find((t) => t.id === form.assignedTeamId);
    const person = personsForTeam.find((p) => p.id === form.assignedPersonId);

    const input: NewCaseInput = {
      title: form.title.trim(),
      description: form.description.trim(),
      caseType: form.caseType,
      priority: form.priority,
      origin: form.origin,
      originDescription: form.origin === 'Diğer' ? form.originDescription.trim() : undefined,
      companyId: company.id,
      companyName: company.name,
      accountId: account.id,
      accountName: account.name,
      category: form.category,
      subCategory: form.subCategory,
      requestType: form.requestType as CaseRequestType,
      productGroup: form.productGroup || undefined,
      assignedTeamId: team?.id,
      assignedTeamName: team?.name,
      assignedPersonId: person?.id,
      assignedPersonName: person?.name,
      // Type-spesifik alanlar (caseService.create yalnızca tipe uygun olanları persist eder)
      financialStatus:    form.financialStatus    || undefined,
      productUsage:       form.productUsage       || undefined,
      usageChangeAlert:   form.usageChangeAlert   || undefined,
      responseLevel:      form.responseLevel      || undefined,
      cancellationRequest: form.cancellationRequest,
      offeredSolutions:    form.offeredSolutions.length ? form.offeredSolutions : undefined,
      offerExpiryDate:     form.offerExpiryDate || undefined,
      offerOutcome:        form.offerOutcome    || undefined,
      offerRejectionReason: form.offerRejectionReason.trim() || undefined,
      actionTaken:         form.actionTaken.trim() || undefined,
      followUpDate:        form.followUpDate    || undefined,
    };
    const created = await caseService.create(input);
    setSubmitting(false);
    onCreated(created);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      title={
        <div className="flex items-center gap-2">
          <span>Yeni Vaka</span>
          <Badge tint="slate">FAZ 0 — Mock</Badge>
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {duplicateCase && !overrideDuplicate
              ? <span className="text-amber-700">Açık vaka mevcut — devam etmek için &quot;Yine de Devam Et&quot; gerekli.</span>
              : <>Vaka oluşturulduğunda statü <strong>Açık</strong> olarak başlar.</>}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Vazgeç
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || (Boolean(duplicateCase) && !overrideDuplicate)}>
              {submitting ? 'Oluşturuluyor…' : 'Vakayı Oluştur'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-4">
        {duplicateCase && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div>
                  Bu müşteri için aynı tipte <strong>açık bir vaka</strong> mevcut.
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded bg-white/60 px-2 py-1.5 ring-1 ring-amber-200">
                  <span className="font-mono text-xs text-slate-600">{duplicateCase.caseNumber}</span>
                  <span className="truncate text-sm font-medium text-slate-800">{duplicateCase.title}</span>
                  <StatusPill status={duplicateCase.status} />
                  {onShowExisting && (
                    <button
                      type="button"
                      onClick={() => {
                        onShowExisting(duplicateCase.id);
                        onClose();
                      }}
                      className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-amber-800 underline hover:bg-amber-100"
                    >
                      <ExternalLink size={12} /> Mevcut Vakayı Gör
                    </button>
                  )}
                </div>
                {!overrideDuplicate ? (
                  <Button size="sm" variant="outline" onClick={() => setOverrideDuplicate(true)}>
                    Yine de Devam Et
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-amber-800">
                    <Badge tint="amber">Override aktif</Badge>
                    <button
                      type="button"
                      onClick={() => setOverrideDuplicate(false)}
                      className="underline hover:text-amber-900"
                    >
                      vazgeç
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Vaka Başlığı" required error={errors.title}>
            <TextInput
              placeholder="Kısa, özetleyici bir başlık"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
            />
          </Field>
          <Field label="Vaka Tipi" required>
            <Select value={form.caseType} onChange={(e) => update('caseType', e.target.value as CaseType)}>
              {CASE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CASE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Şirket" required error={errors.companyId}>
            <Select value={form.companyId} onChange={(e) => update('companyId', e.target.value)}>
              <option value="">Şirket seçin…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Müşteri" required error={errors.accountId}>
            <Select value={form.accountId} onChange={(e) => update('accountId', e.target.value)}>
              <option value="">Müşteri seçin…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Öncelik" required>
            <Select value={form.priority} onChange={(e) => update('priority', e.target.value as CasePriority)}>
              {CASE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {CASE_PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Origin (Kanal)" required>
            <Select value={form.origin} onChange={(e) => update('origin', e.target.value as CaseOrigin)}>
              {CASE_ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Origin Açıklama"
            required={form.origin === 'Diğer'}
            error={errors.originDescription}
            hint={form.origin === 'Diğer' ? 'Origin "Diğer" seçildiğinde zorunludur.' : undefined}
          >
            <TextInput
              placeholder={form.origin === 'Diğer' ? 'Kanalı kısaca açıklayın' : 'Opsiyonel'}
              value={form.originDescription}
              onChange={(e) => update('originDescription', e.target.value)}
              disabled={form.origin !== 'Diğer'}
            />
          </Field>

          <Field label="Kategori" required error={errors.category}>
            <Select value={form.category} onChange={(e) => update('category', e.target.value)}>
              <option value="">Seçin…</option>
              {categories.map((c) => (
                <option key={c.category} value={c.category}>
                  {c.category}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Alt Kategori" required error={errors.subCategory}>
            <Select
              value={form.subCategory}
              onChange={(e) => update('subCategory', e.target.value)}
              disabled={!form.category}
            >
              <option value="">Seçin…</option>
              {subCategories.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Talep Türü" required error={errors.requestType}>
            <Select value={form.requestType} onChange={(e) => update('requestType', e.target.value as '' | CaseRequestType)}>
              <option value="">Seçin…</option>
              {requestTypes.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ürün Grubu" hint="SLA hesaplamasında kullanılır (opsiyonel — FAZ 0)">
            <TextInput
              placeholder="ör. ERP - Kasa"
              value={form.productGroup}
              onChange={(e) => update('productGroup', e.target.value)}
            />
          </Field>

          <Field label="Atanan Takım">
            <Select value={form.assignedTeamId} onChange={(e) => update('assignedTeamId', e.target.value)}>
              <option value="">Atanmadı</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Atanan Kişi"
            hint={form.assignedTeamId ? 'Sadece seçili takımın üyeleri listelenir.' : 'Önce takım seçin.'}
          >
            <Select
              value={form.assignedPersonId}
              onChange={(e) => update('assignedPersonId', e.target.value)}
              disabled={!form.assignedTeamId}
            >
              <option value="">Atanmadı</option>
              {personsForTeam.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Açıklama"
          required
          error={errors.description}
          actions={
            <VoiceNoteButton
              onTranscript={(chunk) =>
                update('description', form.description ? `${form.description} ${chunk}` : chunk)
              }
            />
          }
        >
          <TextArea
            placeholder="Sorun veya talebin detayını yazın…"
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            rows={5}
          />
        </Field>

        {/* Spec 11.2 + KURAL-3 — tip değişince state silinmiyor, sadece görünürlük değişiyor */}
        {form.caseType === 'ProactiveTracking' && (
          <SectionFrame title="Proaktif Takip Bilgileri" tint="violet">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Finansal Risk Seviyesi" hint="Müşteri finansal sağlık skoru">
                <Select
                  value={form.financialStatus}
                  onChange={(e) => update('financialStatus', e.target.value as '' | FinancialStatus)}
                >
                  <option value="">Seçin…</option>
                  {FINANCIAL_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Ürün Kullanımı" hint="Kullanım yoğunluğu">
                <Select
                  value={form.productUsage}
                  onChange={(e) => update('productUsage', e.target.value as '' | ProductUsage)}
                >
                  <option value="">Seçin…</option>
                  {PRODUCT_USAGES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Kullanım Trendi">
                <Select
                  value={form.usageChangeAlert}
                  onChange={(e) => update('usageChangeAlert', e.target.value as '' | UsageChangeAlert)}
                >
                  <option value="">Seçin…</option>
                  {USAGE_CHANGE_ALERTS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Müdahale Önceliği">
                <Select
                  value={form.responseLevel}
                  onChange={(e) => update('responseLevel', e.target.value as '' | ResponseLevel)}
                >
                  <option value="">Seçin…</option>
                  {RESPONSE_LEVELS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </SectionFrame>
        )}

        {form.caseType === 'Churn' && (
          <SectionFrame title="Churn Yönetimi" tint="rose">
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.cancellationRequest}
                  onChange={(e) => update('cancellationRequest', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                Müşteri iptal talebinde bulundu
              </label>

              <Field label="Önerilen Teklifler" hint="Birden fazla seçilebilir">
                <div className="space-y-1.5 rounded-md border border-slate-200 bg-white px-3 py-2">
                  {offeredSolutions.map((o) => {
                    const checked = form.offeredSolutions.includes(o.id);
                    return (
                      <label key={o.id} className="flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...form.offeredSolutions, o.id]
                              : form.offeredSolutions.filter((id) => id !== o.id);
                            update('offeredSolutions', next);
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                        />
                        <span className="flex-1">
                          <span className="font-medium text-slate-800">{o.name}</span>
                          {o.description && (
                            <span className="ml-1 text-xs text-slate-500">— {o.description}</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </Field>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Teklif Geçerlilik Tarihi">
                  <TextInput
                    type="date"
                    value={form.offerExpiryDate}
                    onChange={(e) => update('offerExpiryDate', e.target.value)}
                  />
                </Field>
                <Field label="Teklif Sonucu">
                  <Select
                    value={form.offerOutcome}
                    onChange={(e) => update('offerOutcome', e.target.value as '' | OfferOutcome)}
                  >
                    <option value="">Henüz cevap yok</option>
                    {OFFER_OUTCOMES.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </Select>
                </Field>
              </div>

              {form.offerOutcome === 'Reddedildi' && (
                <Field label="Red Gerekçesi" required error={errors.offerRejectionReason}>
                  <TextArea
                    rows={2}
                    placeholder="Müşteri neden teklifi reddetti?"
                    value={form.offerRejectionReason}
                    onChange={(e) => update('offerRejectionReason', e.target.value)}
                  />
                </Field>
              )}

              <Field label="Yapılan Aksiyon" hint="Süreçte alınan ana aksiyon notu">
                <TextArea
                  rows={3}
                  placeholder="ör. İndirim teklifi sunuldu, takip görüşmesi planlandı…"
                  value={form.actionTaken}
                  onChange={(e) => update('actionTaken', e.target.value)}
                />
              </Field>

              <Field
                label="Takip Tarihi"
                hint="Teklif sonrası ~7 gün — outcome 'Beklemede' ise zorunlu"
                required={form.offerOutcome === 'Beklemede'}
                error={errors.followUpDate}
              >
                <TextInput
                  type="date"
                  value={form.followUpDate}
                  onChange={(e) => update('followUpDate', e.target.value)}
                />
              </Field>
            </div>
          </SectionFrame>
        )}
        </div>

        {/* Spec 11.2 — sağ SLA paneli (salt okunur, otomatik hesaplanmış) */}
        <aside className="space-y-3 lg:sticky lg:top-2 lg:self-start">
          <SlaPanel priority={form.priority} caseType={form.caseType} category={form.category} />
        </aside>
      </div>
    </Modal>
  );
}

function SlaPanel({
  priority,
  caseType,
  category,
}: {
  priority: CasePriority;
  caseType: CaseType;
  category: string;
}) {
  // FAZ 0 tahmini — gerçek SLAPolicy lookup FAZ 3'te (Spec 6)
  const map: Record<CasePriority, [number, number]> = {
    Low:      [12, 72],
    Medium:   [8, 48],
    High:     [4, 24],
    Critical: [1, 6],
  };
  const [responseHours, resolutionHours] = map[priority];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
        SLA Bilgisi
      </h3>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Yanıt Süresi</dt>
          <dd className="font-medium text-slate-800">{responseHours} saat</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Çözüm Süresi</dt>
          <dd className="font-medium text-slate-800">{resolutionHours} saat</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Öncelik</dt>
          <dd className="text-slate-700">{priority}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Kategori</dt>
          <dd className="text-slate-700">{category || '—'}</dd>
        </div>
      </dl>
      <p className="mt-3 border-t border-slate-200 pt-2 text-[11px] leading-relaxed text-slate-500">
        Tahmini değerler. Gerçek SLA, şirket + ürün grubu + kategori + alt kategori + talep türü
        kombinasyonundan hesaplanır (FAZ 3).
      </p>
      {caseType === 'ProactiveTracking' && (
        <p className="mt-2 text-[11px] text-violet-700">
          Proaktif takip vakalarında SLA öncelikle takip planı üzerinden değerlendirilir.
        </p>
      )}
      {caseType === 'Churn' && (
        <p className="mt-2 text-[11px] text-rose-700">
          Churn vakalarında SLA, retention follow-up tarihiyle birlikte takip edilir.
        </p>
      )}
    </div>
  );
}

function SectionFrame({
  title,
  tint,
  children,
}: {
  title: string;
  tint: 'violet' | 'rose';
  children: React.ReactNode;
}) {
  const ring = tint === 'violet' ? 'ring-violet-200 bg-violet-50/40' : 'ring-rose-200 bg-rose-50/40';
  const head = tint === 'violet' ? 'text-violet-800' : 'text-rose-800';
  return (
    <section className={`rounded-lg p-3 ring-1 ring-inset ${ring}`}>
      <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${head}`}>{title}</h3>
      {children}
    </section>
  );
}
