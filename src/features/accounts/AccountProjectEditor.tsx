import { useEffect, useMemo, useState } from 'react';
import { FolderKanban, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { notify } from '@/components/ui/Toast';
import {
  accountService,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type AccountCompanyDetail,
  type AccountDetail,
  type AccountProjectMutationInput,
  type AccountProjectSummary,
  type CentralAccountRow,
  type ProjectStatus,
} from '@/services/accountService';

interface AccountProjectEditorProps {
  open: boolean;
  mode: 'add' | 'edit';
  accountId: string;
  /** Kullanıcının görebildiği AccountCompany'ler — Proje hangi şirket-ilişkisine eklenecek. */
  visibleCompanies: AccountCompanyDetail[];
  project?: AccountProjectSummary | null;
  /** Edit modunda projenin ait olduğu accountCompanyId. */
  accountCompanyId?: string | null;
  onClose: () => void;
  onSaved: (account: AccountDetail | undefined) => void;
}

function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/**
 * WR-A4 / PM-04 — Proje ekleme / düzenleme / pasifleştirme.
 * Proje AccountCompany-scoped (NEVER Account-level). Add'de önce şirket seçilir.
 * Edit'te accountCompanyId değişmez (taşıma desteklenmiyor — case bağları kopmasın).
 */
export function AccountProjectEditor({
  open,
  mode,
  accountId,
  visibleCompanies,
  project,
  accountCompanyId: editAccountCompanyId,
  onClose,
  onSaved,
}: AccountProjectEditorProps) {
  const [accountCompanyId, setAccountCompanyId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('Active');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  // Faz B-temel — Ana Firma (Merkez Müşteri) seçimi
  const [anaFirmaAccountId, setAnaFirmaAccountId] = useState<string>('');
  const [centralAccounts, setCentralAccounts] = useState<CentralAccountRow[]>([]);
  const [centralLoading, setCentralLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (mode === 'edit' && project) {
      setAccountCompanyId(editAccountCompanyId ?? '');
      setCode(project.code);
      setName(project.name);
      setStatus(project.status);
      setStartDate(toDateInput(project.startDate));
      setEndDate(toDateInput(project.endDate));
      setDescription(project.description ?? '');
      setIsActive(project.isActive);
      setAnaFirmaAccountId(project.anaFirmaAccountId ?? '');
    } else {
      const defaultAcId =
        visibleCompanies.length === 1 ? visibleCompanies[0].accountCompanyId : '';
      setAccountCompanyId(defaultAcId);
      setCode('');
      setName('');
      setStatus('Active');
      setStartDate('');
      setEndDate('');
      setDescription('');
      setIsActive(true);
      setAnaFirmaAccountId('');
    }
  }, [open, mode, project, editAccountCompanyId, visibleCompanies]);

  const selectedCompany = useMemo(
    () => visibleCompanies.find((c) => c.accountCompanyId === accountCompanyId) ?? null,
    [visibleCompanies, accountCompanyId],
  );

  // Faz B-temel — Ana Firma dropdown'unu seçilen şirketin tenant'ına göre yükle.
  // companyId'si değişince central account listesi yenilenir (cross-tenant
  // koruması: backend sadece user'ın bu tenant'a erişimi varsa döner).
  useEffect(() => {
    if (!open || !selectedCompany?.companyId) {
      setCentralAccounts([]);
      return;
    }
    let cancelled = false;
    setCentralLoading(true);
    accountService.listCentral(selectedCompany.companyId).then((rows) => {
      if (cancelled) return;
      setCentralAccounts(rows);
      setCentralLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, selectedCompany?.companyId]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (mode === 'add' && !accountCompanyId) errs.accountCompanyId = 'Şirket seç.';
    if (!code.trim()) errs.code = 'Proje kodu zorunlu.';
    if (!name.trim()) errs.name = 'Proje adı zorunlu.';
    if (startDate && endDate && startDate > endDate) {
      errs.endDate = 'Bitiş tarihi başlangıçtan önce olamaz.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);

    let updated: AccountDetail | undefined;
    if (mode === 'add') {
      const body: AccountProjectMutationInput = {
        code: code.trim(),
        name: name.trim(),
        status,
        startDate: startDate || null,
        endDate: endDate || null,
        description: description.trim() || null,
        isActive,
        anaFirmaAccountId: anaFirmaAccountId || null, // Faz B-temel
      };
      const result = await accountService.addProject(accountId, accountCompanyId, body);
      updated = result?.account;
      if (updated) notify({ type: 'success', title: 'Proje eklendi', message: '' });
    } else if (project) {
      const body: AccountProjectMutationInput = {
        code: code.trim(),
        name: name.trim(),
        status,
        startDate: startDate || null,
        endDate: endDate || null,
        description: description.trim() || null,
        isActive,
        anaFirmaAccountId: anaFirmaAccountId || null, // Faz B-temel
      };
      const result = await accountService.updateProject(accountId, project.id, body);
      updated = result?.account;
      if (updated) notify({ type: 'success', title: 'Proje güncellendi', message: '' });
    }
    setSubmitting(false);
    if (updated) onSaved(updated);
  }

  async function handleDeactivate() {
    if (!project || mode !== 'edit') return;
    if (!window.confirm('Bu projeyi pasifleştirmek istediğine emin misin? Bağlı vakalar etkilenmez.')) return;
    setDeleting(true);
    const result = await accountService.removeProject(accountId, project.id);
    setDeleting(false);
    if (result?.account) {
      notify({ type: 'success', title: 'Proje pasifleştirildi', message: '' });
      onSaved(result.account);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="inline-flex items-center gap-1.5">
          <FolderKanban size={14} />
          {mode === 'add' ? 'Yeni Proje' : 'Projeyi Düzenle'}
        </span>
      }
      footer={
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            {mode === 'edit' && project?.isActive && (
              <Button
                variant="outline"
                type="button"
                leftIcon={<Trash2 size={12} />}
                disabled={submitting || deleting}
                onClick={handleDeactivate}
                className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-900/30"
              >
                {deleting ? 'Pasifleştiriliyor…' : 'Pasifleştir'}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
              Vazgeç
            </Button>
            <Button type="submit" form="account-project-form" disabled={submitting || deleting}>
              {submitting
                ? 'Kaydediliyor…'
                : mode === 'add'
                  ? 'Proje Ekle'
                  : 'Değişiklikleri Kaydet'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="account-project-form" onSubmit={handleSubmit} className="space-y-4 p-5">
        <Field
          label="Şirket"
          required
          error={errors.accountCompanyId}
          hint={mode === 'edit' ? 'Şirket değişimi desteklenmiyor — proje case bağları korunsun.' : undefined}
        >
          {mode === 'edit' ? (
            <TextInput
              value={selectedCompany?.companyName ?? accountCompanyId}
              disabled
              readOnly
            />
          ) : (
            <Select
              value={accountCompanyId}
              onChange={(e) => setAccountCompanyId(e.target.value)}
            >
              <option value="">Şirket seç…</option>
              {visibleCompanies.map((c) => (
                <option key={c.accountCompanyId} value={c.accountCompanyId}>
                  {c.companyName ?? c.companyId}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Proje Kodu" required error={errors.code} hint="Şirket içinde benzersiz">
            <TextInput
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Örn. ROTA-2026"
              autoFocus
            />
          </Field>
          <Field label="Proje Adı" required error={errors.name} className="sm:col-span-2">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn. Rota Optimizasyonu — Faz 1"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Durum">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Başlangıç">
            <TextInput
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="Bitiş" error={errors.endDate}>
            <TextInput
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
        </div>

        {/* Faz B-temel — Ana Firma (Merkez Müşteri) seçimi.
            customerRole='Central' olan ve aynı tenant'a bağlı account'lar
            dropdown'da listelenir. Cross-tenant koruma backend'de. */}
        <Field
          label="Ana Firma"
          hint={
            !selectedCompany
              ? 'Önce şirket seçin.'
              : centralLoading
                ? 'Yükleniyor…'
                : centralAccounts.length === 0
                  ? 'Bu şirkette "Merkez Müşteri" rolünde account yok. Müşteri kartından rolü işaretleyin.'
                  : 'Bu projenin bağlı olduğu ana firma (Nestlé, JTI gibi). Bayinin kendi projeleri için ana firmadır; raporlama bu bağ üzerinden çalışır.'
          }
        >
          <Select
            value={anaFirmaAccountId}
            onChange={(e) => setAnaFirmaAccountId(e.target.value)}
            disabled={!selectedCompany || centralLoading}
          >
            <option value="">— Ana firma yok / belirtilmemiş —</option>
            {centralAccounts.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}{row.vkn ? ` (${row.vkn})` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Açıklama" hint="Opsiyonel">
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Kapsam, paydaşlar, varsayımlar…"
            rows={3}
          />
        </Field>

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-ndark-text">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-ndark-border dark:bg-ndark-surface"
          />
          <span>Aktif</span>
        </label>
      </form>
    </Modal>
  );
}
