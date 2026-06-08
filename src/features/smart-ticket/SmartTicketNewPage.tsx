import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Sparkles, Users2 } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { useToast } from '@/components/ui/Toast';
import { AccountSearchPicker } from '@/features/accounts/AccountSearchPicker';
import {
  caseService,
  lookupService,
  type SmartTicketTaxonomyItem,
  type SmartTicketTaxonomyResponse,
} from '@/services/caseService';
import { accountService, type AccountListItem } from '@/services/accountService';
import type { Case } from '@/features/cases/types';

/**
 * WR-Smart-Ticket Phase 1c — ayrı "Akıllı Ticket Aç" intake screen.
 *
 * SCOPE GUARD:
 *  - Bu shell mevcut `POST /api/cases` üzerine gerçek bir Case oluşturur.
 *  - Smart Ticket meta verisi `customFields.smartTicket` içine yazılır.
 *  - Quick Case / New Case / Case Detail akışları DOKUNULMADI.
 *  - Schema migration YOK; `customFields` zaten Case modelinde mevcut.
 *  - Smart Ticket alanları → klasik Case alanları eşlemesi BU PR'DA YOK.
 *    Case.category/subCategory/requestType sabit fallback değerlerle
 *    set ediliyor: ("Akıllı Ticket" / "Genel" / "Talep"). Eşleme PR-1d+.
 *  - CaseSolutionStep, External KB, structured closure → KAPSAM DIŞI.
 *
 * Form akışı sade — kullanıcıdan minimum bilgi:
 *  - Şirket (zorunlu, varsayılan = ilk erişilebilir şirket)
 *  - Müşteri (zorunlu — picker)
 *  - Proje (opsiyonel, müşteri+şirket bağlamına göre)
 *  - Başlık (zorunlu)
 *  - Açıklama (zorunlu)
 *  - 5 açılış taxonomy seçimi (her biri opsiyonel; lookup endpoint'ten):
 *    platform / businessProcess / operationType / affectedObject / impact
 */

const SMART_TICKET_CATEGORY = 'Akıllı Ticket';
const SMART_TICKET_SUBCATEGORY = 'Genel';
const SMART_TICKET_REQUEST_TYPE = 'Talep' as const;

const TAXONOMY_FIELDS: Array<{
  key: 'platform' | 'businessProcess' | 'operationType' | 'affectedObject' | 'impact';
  label: string;
  hint?: string;
}> = [
  { key: 'platform',        label: 'Platform' },
  { key: 'businessProcess', label: 'İş Süreci' },
  { key: 'operationType',   label: 'İşlem Tipi' },
  { key: 'affectedObject',  label: 'Etkilenen Nesne' },
  { key: 'impact',          label: 'Etki' },
];

interface SmartTicketProjectOption {
  id: string;
  name: string;
}

interface SmartTicketFormState {
  companyId: string;
  accountId: string;
  accountName: string;
  accountProjectId: string;
  accountProjectName: string;
  title: string;
  description: string;
  platform: string;
  businessProcess: string;
  operationType: string;
  affectedObject: string;
  impact: string;
}

const emptyForm = (companyId: string): SmartTicketFormState => ({
  companyId,
  accountId: '',
  accountName: '',
  accountProjectId: '',
  accountProjectName: '',
  title: '',
  description: '',
  platform: '',
  businessProcess: '',
  operationType: '',
  affectedObject: '',
  impact: '',
});

export function SmartTicketNewPage({
  onCreated,
  onCancel,
}: {
  onCreated: (caseId: string) => void;
  onCancel: () => void;
}) {
  const companies = useMemo(() => lookupService.companies(), []);
  const defaultCompanyId = companies[0]?.id ?? '';
  const [form, setForm] = useState<SmartTicketFormState>(() => emptyForm(defaultCompanyId));

  const [taxonomies, setTaxonomies] = useState<SmartTicketTaxonomyResponse['taxonomies'] | null>(null);
  const [taxonomiesLoading, setTaxonomiesLoading] = useState(false);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);

  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [projects, setProjects] = useState<SmartTicketProjectOption[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Taxonomy lookup — companyId değişince yeniden çek.
  useEffect(() => {
    let alive = true;
    if (!form.companyId) {
      setTaxonomies(null);
      return;
    }
    setTaxonomiesLoading(true);
    setTaxonomyError(null);
    void lookupService
      .smartTicketTaxonomies(form.companyId)
      .then((res: SmartTicketTaxonomyResponse) => {
        if (!alive) return;
        setTaxonomies(res.taxonomies);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setTaxonomyError((e as Error)?.message ?? 'Taxonomy çekilemedi');
      })
      .finally(() => {
        if (alive) setTaxonomiesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [form.companyId]);

  // Müşteri seçilince proje listesini doldur (opsiyonel).
  useEffect(() => {
    let alive = true;
    if (!form.accountId || !form.companyId) {
      setProjects([]);
      return;
    }
    void accountService.get(form.accountId).then((detail) => {
      if (!alive) return;
      if (!detail) {
        setProjects([]);
        return;
      }
      const company = detail.companies.find((c) => c.companyId === form.companyId);
      const list: SmartTicketProjectOption[] = (company?.projects ?? [])
        .filter((p) => p.isActive && p.status === 'Active')
        .map((p) => ({ id: p.id, name: p.name }));
      setProjects(list);
      setForm((f) =>
        f.accountProjectId && !list.some((p) => p.id === f.accountProjectId)
          ? { ...f, accountProjectId: '', accountProjectName: '' }
          : f,
      );
    });
    return () => {
      alive = false;
    };
  }, [form.accountId, form.companyId]);

  // Şirket değişince müşteri/proje sıfırla.
  useEffect(() => {
    setForm((f) => ({
      ...f,
      accountId: '',
      accountName: '',
      accountProjectId: '',
      accountProjectName: '',
    }));
  }, [form.companyId]);

  function handleSelectAccount(item: AccountListItem | null) {
    setAccountPickerOpen(false);
    if (!item) return;
    setForm((f) => ({
      ...f,
      accountId: item.id,
      accountName: item.name ?? '',
    }));
  }

  function handleSelectProject(id: string) {
    const project = projects.find((p) => p.id === id);
    setForm((f) => ({
      ...f,
      accountProjectId: id,
      accountProjectName: project?.name ?? '',
    }));
  }

  function selectedCompanyName(): string {
    return companies.find((c) => c.id === form.companyId)?.name ?? '';
  }

  const canSubmit =
    !!form.companyId &&
    !!form.accountId &&
    form.title.trim().length > 0 &&
    form.description.trim().length > 0 &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const smartTicket: Record<string, string> = {};
    for (const f of TAXONOMY_FIELDS) {
      const v = form[f.key];
      if (v) smartTicket[f.key] = v;
    }

    try {
      const created: Case = await caseService.create({
        title: form.title.trim(),
        description: form.description.trim(),
        caseType: 'GeneralSupport',
        priority: 'Medium',
        origin: 'Web',
        companyId: form.companyId,
        companyName: selectedCompanyName(),
        accountId: form.accountId,
        accountName: form.accountName || undefined,
        ...(form.accountProjectId
          ? {
              accountProjectId: form.accountProjectId,
              accountProjectName: form.accountProjectName || undefined,
            }
          : {}),
        // Smart Ticket bu PR'da klasik kategori alanlarına EŞLENMİYOR.
        // Şeman güvende — sabit fallback ile case create devam eder.
        category: SMART_TICKET_CATEGORY,
        subCategory: SMART_TICKET_SUBCATEGORY,
        requestType: SMART_TICKET_REQUEST_TYPE,
        customFields: {
          smartTicket,
        },
      });
      toast({
        type: 'success',
        message: `Akıllı Ticket "${created.title}" oluşturuldu.`,
        duration: 2500,
      });
      onCreated(created.id);
    } catch (e) {
      setError((e as Error)?.message ?? 'Vaka oluşturulamadı.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-2 py-4">
      <div className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="mb-2 flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 dark:text-ndark-muted dark:hover:text-ndark-text"
          >
            <ArrowLeft size={12} />
            <span>Vakalara dön</span>
          </button>
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-brand-500" />
            <h1 className="text-xl font-semibold text-slate-900 dark:text-ndark-text">
              Akıllı Ticket Aç
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-ndark-muted">
            Akıllı Ticket akışı yapılandırılıyor — bu shell mevcut <strong>POST /api/cases</strong>{' '}
            üzerine gerçek bir vaka açar; Smart Ticket meta verisi vakanın{' '}
            <code className="font-mono text-[11px]">customFields.smartTicket</code> alanına yazılır.
            Quick Case ve klasik Yeni Vaka akışları aynen çalışmaya devam eder.
          </p>
        </div>
      </div>

      <Card>
        <CardBody className="space-y-5">
          {/* Şirket / müşteri / proje */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <CompanySelector
              label="Şirket"
              value={form.companyId || null}
              onChange={(id) => setForm((f) => ({ ...f, companyId: id ?? '' }))}
              required
            />
            <Field label="Müşteri" required>
              <button
                type="button"
                onClick={() => setAccountPickerOpen(true)}
                className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:border-slate-400 dark:border-ndark-border dark:bg-ndark-card"
              >
                <span className={form.accountName ? 'text-slate-800 dark:text-ndark-text' : 'text-slate-400'}>
                  {form.accountName || 'Müşteri seçin…'}
                </span>
                <Users2 size={14} className="text-slate-400" />
              </button>
            </Field>
            {projects.length > 0 && (
              <Field label="Proje" hint="Opsiyonel — müşterinin aktif projeleri">
                <Select
                  value={form.accountProjectId}
                  onChange={(e) => handleSelectProject(e.target.value)}
                >
                  <option value="">— Proje yok —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          {/* Başlık / açıklama */}
          <Field label="Başlık" required>
            <TextInput
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="ör. Müşteri ürün kartı kaydı sırasında hata alıyor"
            />
          </Field>

          <Field label="Açıklama" required>
            <TextArea
              rows={5}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Problemi kısa ve net anlat. Hangi platform? Hangi işlem? Hangi etki?"
            />
          </Field>

          {/* Smart Ticket taxonomy alanları */}
          <div className="rounded-md border border-brand-100 bg-brand-50/40 p-4 dark:border-brand-900/30 dark:bg-brand-950/20">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles size={14} className="text-brand-500" />
              <span className="text-sm font-medium text-brand-700 dark:text-brand-200">
                Akıllı Tanımlar
              </span>
              {taxonomiesLoading && (
                <span className="text-xs text-slate-500 dark:text-ndark-muted">yükleniyor…</span>
              )}
            </div>
            {taxonomyError && (
              <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {taxonomyError}
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {TAXONOMY_FIELDS.map((f) => {
                const items = (taxonomies?.[f.key] ?? []) as SmartTicketTaxonomyItem[];
                return (
                  <Field key={f.key} label={f.label} hint={f.hint}>
                    <Select
                      value={form[f.key]}
                      onChange={(e) =>
                        setForm((s) => ({ ...s, [f.key]: e.target.value }))
                      }
                      disabled={taxonomiesLoading || items.length === 0}
                    >
                      <option value="">— Seçim yok —</option>
                      {items.map((it) => (
                        <option key={it.code} value={it.code}>
                          {it.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-slate-500 dark:text-ndark-muted">
              Bu alanlar henüz mevcut Kategori/Alt Kategori/İstek Tipi alanlarına
              eşlenmiyor — yalnızca customFields.smartTicket içine kaydediliyor.
              Eşleme sonraki sürümde devreye alınacak.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-ndark-border">
            <Button variant="outline" onClick={onCancel} disabled={submitting}>
              Vazgeç
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
              {submitting ? 'Açılıyor…' : 'Akıllı Ticket Aç'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <AccountSearchPicker
        open={accountPickerOpen}
        companyId={form.companyId || null}
        selectedAccountId={form.accountId || null}
        onClose={() => setAccountPickerOpen(false)}
        onSelect={handleSelectAccount}
      />
    </div>
  );
}
