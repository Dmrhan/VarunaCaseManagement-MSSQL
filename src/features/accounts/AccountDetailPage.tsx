import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  Clock,
  FolderKanban,
  Inbox,
  Mail,
  MapPin,
  Package,
  Pencil,
  Phone,
  Plus,
  Star,
  Users,
} from 'lucide-react';
import { useAuth } from '@/services/AuthContext';
import {
  accountService,
  ADDRESS_TYPE_LABELS,
  canReadAccounts,
  canWriteAccounts,
  CUSTOMER_TYPE_LABELS,
  PROJECT_STATUS_LABELS,
  type AccountAddressSummary,
  type AccountContact,
  type AccountCompanyDetail,
  type AccountDetail,
  type AccountProductSummary,
  type AccountProjectSummary,
} from '@/services/accountService';
import { Badge, type BadgeTint } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { AccountFormModal } from './AccountFormModal';
import { AccountCompanyEditor } from './AccountCompanyEditor';
import { AccountContactEditor } from './AccountContactEditor';
import { AccountProductEditor } from './AccountProductEditor';
import { AccountProjectEditor } from './AccountProjectEditor';
import { AccountAddressEditor } from './AccountAddressEditor';

interface AccountDetailPageProps {
  accountId: string;
  onBack: () => void;
  onSelectCase?: (caseId: string) => void;
}

/**
 * Müşteri detay sayfası — 4 bölüm: Genel, Şirket İlişkileri, Kontaklar, Vakalar.
 *
 * Phase B kapsamı: Şirket ilişkileri ve kontaklar SADECE display. CRUD yok
 * (Phase A endpoint'leri henüz desteklemiyor). PATCH /api/accounts/:id sadece
 * Account fieldlarını günceller (name, vkn, phone, email, isActive).
 */
export function AccountDetailPage({ accountId, onBack, onSelectCase }: AccountDetailPageProps) {
  const { user } = useAuth();
  const isReader = canReadAccounts(user?.role);
  const isWriter = canWriteAccounts(user?.role);

  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [companyEditor, setCompanyEditor] = useState<
    { mode: 'add' } | { mode: 'edit'; relation: AccountCompanyDetail } | null
  >(null);
  const [contactEditor, setContactEditor] = useState<
    { mode: 'add' } | { mode: 'edit'; contact: AccountContact } | null
  >(null);
  const [productEditor, setProductEditor] = useState<
    | { mode: 'add' }
    | { mode: 'edit'; product: AccountProductSummary; accountCompanyId: string }
    | null
  >(null);
  const [projectEditor, setProjectEditor] = useState<
    | { mode: 'add' }
    | { mode: 'edit'; project: AccountProjectSummary; accountCompanyId: string }
    | null
  >(null);
  const [addressEditor, setAddressEditor] = useState<
    | { mode: 'add' }
    | { mode: 'edit'; address: AccountAddressSummary }
    | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const out = await accountService.get(accountId);
    setLoading(false);
    if (!out) {
      setError('Müşteri yüklenemedi veya erişim engellendi.');
      return;
    }
    setAccount(out);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isReader) {
    return (
      <EmptyState
        icon={<AlertTriangle size={24} />}
        title="Bu sayfaya erişim yetkin yok"
        description="Müşteriler modülü Supervisor, CSM, Admin ve SystemAdmin rolleri içindir."
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-ndark-muted dark:hover:text-ndark-text"
      >
        <ArrowLeft size={12} /> Müşteri listesine dön
      </button>

      {loading && !account ? (
        <DetailSkeleton />
      ) : error ? (
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="Müşteri yüklenemedi"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Tekrar dene
            </Button>
          }
        />
      ) : account ? (
        <>
          <DetailHeader
            account={account}
            isWriter={isWriter}
            onEdit={() => setEditOpen(true)}
          />
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <CompaniesSection
                companies={account.companies}
                isWriter={isWriter}
                onAdd={() => setCompanyEditor({ mode: 'add' })}
                onEdit={(relation) => setCompanyEditor({ mode: 'edit', relation })}
              />
              <ProductsSection
                companies={account.companies}
                isWriter={isWriter}
                onAdd={() => setProductEditor({ mode: 'add' })}
                onEdit={(product, accountCompanyId) =>
                  setProductEditor({ mode: 'edit', product, accountCompanyId })
                }
              />
              <ProjectsSection
                companies={account.companies}
                isWriter={isWriter}
                onAdd={() => setProjectEditor({ mode: 'add' })}
                onEdit={(project, accountCompanyId) =>
                  setProjectEditor({ mode: 'edit', project, accountCompanyId })
                }
              />
              <AddressesSection
                addresses={account.addresses}
                companies={account.companies}
                isWriter={isWriter}
                onAdd={() => setAddressEditor({ mode: 'add' })}
                onEdit={(address) => setAddressEditor({ mode: 'edit', address })}
              />
              <ContactsSection
                contacts={account.contacts}
                isWriter={isWriter}
                onAdd={() => setContactEditor({ mode: 'add' })}
                onEdit={(contact) => setContactEditor({ mode: 'edit', contact })}
              />
            </div>
            <div className="space-y-5">
              <GeneralSection account={account} />
              <CasesSection
                stats={account.caseStats}
                recent={account.recentCases}
                onSelectCase={onSelectCase}
              />
            </div>
          </div>

          <AccountFormModal
            open={editOpen}
            mode="edit"
            account={account}
            onClose={() => setEditOpen(false)}
            onSaved={(updated) => {
              setEditOpen(false);
              if (updated) setAccount(updated);
            }}
          />

          <AccountCompanyEditor
            open={companyEditor !== null}
            mode={companyEditor?.mode ?? 'add'}
            accountId={account.id}
            relation={companyEditor && companyEditor.mode === 'edit' ? companyEditor.relation : null}
            existingCompanyIds={account.companies.map((c) => c.companyId)}
            onClose={() => setCompanyEditor(null)}
            onSaved={(updated) => {
              setCompanyEditor(null);
              if (updated) setAccount(updated);
            }}
          />

          <AccountContactEditor
            open={contactEditor !== null}
            mode={contactEditor?.mode ?? 'add'}
            accountId={account.id}
            contact={contactEditor && contactEditor.mode === 'edit' ? contactEditor.contact : null}
            onClose={() => setContactEditor(null)}
            onSaved={(updated) => {
              setContactEditor(null);
              if (updated) setAccount(updated);
            }}
          />

          <AccountProductEditor
            open={productEditor !== null}
            mode={productEditor?.mode ?? 'add'}
            accountId={account.id}
            visibleCompanies={account.companies}
            product={
              productEditor && productEditor.mode === 'edit' ? productEditor.product : null
            }
            accountCompanyId={
              productEditor && productEditor.mode === 'edit'
                ? productEditor.accountCompanyId
                : null
            }
            onClose={() => setProductEditor(null)}
            onSaved={(updated) => {
              setProductEditor(null);
              if (updated) setAccount(updated);
            }}
          />

          <AccountProjectEditor
            open={projectEditor !== null}
            mode={projectEditor?.mode ?? 'add'}
            accountId={account.id}
            visibleCompanies={account.companies}
            project={
              projectEditor && projectEditor.mode === 'edit' ? projectEditor.project : null
            }
            accountCompanyId={
              projectEditor && projectEditor.mode === 'edit'
                ? projectEditor.accountCompanyId
                : null
            }
            onClose={() => setProjectEditor(null)}
            onSaved={(updated) => {
              setProjectEditor(null);
              if (updated) setAccount(updated);
            }}
          />

          <AccountAddressEditor
            open={addressEditor !== null}
            mode={addressEditor?.mode ?? 'add'}
            accountId={account.id}
            visibleCompanies={account.companies}
            address={
              addressEditor && addressEditor.mode === 'edit' ? addressEditor.address : null
            }
            onClose={() => setAddressEditor(null)}
            onSaved={(updated) => {
              setAddressEditor(null);
              if (updated) setAccount(updated);
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function DetailHeader({
  account,
  isWriter,
  onEdit,
}: {
  account: AccountDetail;
  isWriter: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold text-slate-900 dark:text-ndark-text">
            {account.name}
          </h1>
          <Badge tint={account.isActive ? 'emerald' : 'slate'}>
            {account.isActive ? 'Aktif' : 'Pasif'}
          </Badge>
          {/* WR-A1 — Müşteri tipi badge. */}
          <Badge tint={account.customerType === 'Individual' ? 'sky' : 'indigo'}>
            {CUSTOMER_TYPE_LABELS[account.customerType] ?? account.customerType}
          </Badge>
          {account.vknMasked && (
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-ndark-surface dark:text-ndark-muted">
              VKN {account.vknMasked}
            </span>
          )}
          {/* WR-A2 — TCKN maskeli display (yalnız Individual + tcknMasked dolu ise).
              Plain TCKN UI'a hiç gelmez; sadece "*******1234" maskeli string backend'den döner. */}
          {account.customerType === 'Individual' && account.tcknMasked && (
            <span
              className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-ndark-surface dark:text-ndark-muted"
              title="TCKN güvenli şekilde hashlenmiş; gösterim için son 4 hane"
            >
              TCKN {account.tcknMasked}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-ndark-muted">
          Eklendi: {formatDate(account.createdAt)}
        </p>
      </div>
      {isWriter && (
        <Button variant="outline" leftIcon={<Pencil size={14} />} onClick={onEdit}>
          Düzenle
        </Button>
      )}
    </div>
  );
}

function GeneralSection({ account }: { account: AccountDetail }) {
  return (
    <SectionCard title="Genel Bilgiler">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm">
        <Row
          icon={<Building2 size={12} />}
          label="Müşteri Tipi"
          value={CUSTOMER_TYPE_LABELS[account.customerType] ?? account.customerType}
        />
        {/* WR-A1 — Kurumsal alanlar dolu ise göster. */}
        {account.legalName && (
          <Row icon={<Building2 size={12} />} label="Ticari Unvan" value={account.legalName} />
        )}
        {account.registrationNo && (
          <Row icon={<Inbox size={12} />} label="Sicil No" value={account.registrationNo} />
        )}
        <Row icon={<Phone size={12} />} label="Telefon" value={account.phone} />
        <Row icon={<Mail size={12} />} label="E-posta" value={account.email} />
        <Row icon={<Calendar size={12} />} label="Eklendi" value={formatDate(account.createdAt)} />
        <Row
          icon={<Star size={12} />}
          label="Durum"
          value={account.isActive ? 'Aktif' : 'Pasif'}
        />
      </dl>
    </SectionCard>
  );
}

function CompaniesSection({
  companies,
  isWriter,
  onAdd,
  onEdit,
}: {
  companies: AccountDetail['companies'];
  isWriter: boolean;
  onAdd: () => void;
  onEdit: (relation: AccountCompanyDetail) => void;
}) {
  return (
    <SectionCard
      title="Şirket İlişkileri"
      subtitle="Bu müşterinin bağlı olduğu şirketler ve dış sistem kayıtları"
      action={
        isWriter ? (
          <Button variant="outline" size="sm" leftIcon={<Plus size={12} />} onClick={onAdd}>
            Şirket Ekle
          </Button>
        ) : null
      }
    >
      {companies.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Building2 size={16} />}
          title="Şirket ilişkisi yok"
          description={
            isWriter
              ? 'Bu müşteriyi bir şirkete bağlamak için yukarıdaki düğmeyi kullan.'
              : 'Bu müşteri görünür hiçbir şirketle ilişkili değil.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {companies.map((c) => (
            <li
              key={c.accountCompanyId}
              className="rounded-lg border border-slate-200 px-3 py-3 dark:border-ndark-border"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Building2 size={14} className="text-slate-500 dark:text-ndark-muted" />
                  <span className="font-medium text-slate-900 dark:text-ndark-text">
                    {c.companyName ?? c.companyId}
                  </span>
                  <Badge tint={statusTint(c.status)}>{statusLabel(c.status)}</Badge>
                  {c.externalCustomerCode && (
                    <span
                      title="Müşteri Dış Kodu"
                      className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-ndark-surface dark:text-ndark-muted"
                    >
                      Kod {c.externalCustomerCode}
                    </span>
                  )}
                </div>
                {isWriter && (
                  <button
                    type="button"
                    onClick={() => onEdit(c)}
                    title="Düzenle"
                    aria-label={`${c.companyName ?? c.companyId} ilişkisini düzenle`}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-surface dark:hover:text-ndark-text"
                  >
                    <Pencil size={13} />
                  </button>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-ndark-muted sm:grid-cols-2">
                {c.packageName && <KeyVal label="Paket" value={c.packageName} />}
                {c.segment && <KeyVal label="Segment" value={c.segment} />}
                {c.contractStartAt && (
                  <KeyVal label="Sözleşme Başlangıç" value={formatDate(c.contractStartAt)} />
                )}
                {c.contractEndAt && (
                  <KeyVal label="Sözleşme Bitiş" value={formatDate(c.contractEndAt)} />
                )}
              </dl>
              {c.notes && (
                <p className="mt-2 whitespace-pre-wrap rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-700 dark:bg-ndark-surface dark:text-ndark-text">
                  {c.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ProductsSection({
  companies,
  isWriter,
  onAdd,
  onEdit,
}: {
  companies: AccountDetail['companies'];
  isWriter: boolean;
  onAdd: () => void;
  onEdit: (product: AccountProductSummary, accountCompanyId: string) => void;
}) {
  // Düzleştir: her şirketin ürün listesini company adıyla birlikte tek listede topla.
  const flat = companies.flatMap((c) =>
    c.products.map((p) => ({
      ...p,
      companyName: c.companyName ?? c.companyId,
      accountCompanyId: c.accountCompanyId,
    })),
  );
  const total = flat.length;
  const canAdd = isWriter && companies.length > 0;

  return (
    <SectionCard
      title="Ürünler"
      subtitle="Müşterinin kullandığı ürün ve servisler — vaka açma anında konteks olarak kullanılır"
      action={
        canAdd ? (
          <Button variant="outline" size="sm" leftIcon={<Plus size={12} />} onClick={onAdd}>
            Ürün Ekle
          </Button>
        ) : null
      }
    >
      {total === 0 ? (
        <EmptyState
          size="sm"
          icon={<Package size={16} />}
          title="Ürün yok"
          description={
            isWriter
              ? companies.length === 0
                ? 'Önce müşteriyi bir şirkete bağla, sonra ürün ekleyebilirsin.'
                : 'Müşterinin kullandığı ürünleri eklemek için yukarıdaki düğmeyi kullan.'
              : 'Bu müşteri için henüz ürün tanımlanmamış.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {flat.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-ndark-border"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Package size={13} className="text-slate-500 dark:text-ndark-muted" />
                  <span className="font-medium text-slate-900 dark:text-ndark-text">
                    {p.productName}
                  </span>
                  {p.productCode && (
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-ndark-surface dark:text-ndark-muted">
                      {p.productCode}
                    </span>
                  )}
                  {/* WR-A8 — Product Catalog linkage badge. */}
                  {p.productId ? (
                    <span
                      className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                      title="Bu ürün, şirketin Ürün Kataloğu'na bağlıdır."
                    >
                      Katalog
                    </span>
                  ) : (
                    <span
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      title="Manuel girilmiş ürün. Düzenleyerek katalogdan eşleştirebilirsiniz."
                    >
                      Manuel
                    </span>
                  )}
                  {p.productSupportLevel && (
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                      {p.productSupportLevel}
                    </span>
                  )}
                  {!p.isActive && <Badge tint="slate">Pasif</Badge>}
                  <Badge tint="blue">{p.companyName}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-ndark-muted">
                  {p.productGroupName && <span>Grup: {p.productGroupName}</span>}
                  {p.startedAt && <span>Başlangıç: {formatDate(p.startedAt)}</span>}
                  {p.endedAt && <span>Bitiş: {formatDate(p.endedAt)}</span>}
                </div>
              </div>
              {isWriter && (
                <button
                  type="button"
                  onClick={() => onEdit(p, p.accountCompanyId)}
                  title="Düzenle"
                  aria-label={`${p.productName} ürününü düzenle`}
                  className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-surface dark:hover:text-ndark-text"
                >
                  <Pencil size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ProjectsSection({
  companies,
  isWriter,
  onAdd,
  onEdit,
}: {
  companies: AccountDetail['companies'];
  isWriter: boolean;
  onAdd: () => void;
  onEdit: (project: AccountProjectSummary, accountCompanyId: string) => void;
}) {
  // WR-A4 — Şirket-ilişkisi başına projeleri tek listede düzleştir.
  const flat = companies.flatMap((c) =>
    c.projects.map((p) => ({
      ...p,
      companyName: c.companyName ?? c.companyId,
      accountCompanyId: c.accountCompanyId,
    })),
  );
  const total = flat.length;
  const canAdd = isWriter && companies.length > 0;

  return (
    <SectionCard
      title="Projeler"
      subtitle="Şirket-ilişkisi başına proje listesi — vaka açma anında opsiyonel olarak seçilebilir"
      action={
        canAdd ? (
          <Button variant="outline" size="sm" leftIcon={<Plus size={12} />} onClick={onAdd}>
            Proje Ekle
          </Button>
        ) : null
      }
    >
      {total === 0 ? (
        <EmptyState
          size="sm"
          icon={<FolderKanban size={16} />}
          title="Proje yok"
          description={
            isWriter
              ? companies.length === 0
                ? 'Önce müşteriyi bir şirkete bağla, sonra proje ekleyebilirsin.'
                : 'Müşterinin proje listesini eklemek için yukarıdaki düğmeyi kullan.'
              : 'Bu müşteri için henüz proje tanımlanmamış.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {flat.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-ndark-border"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <FolderKanban size={13} className="text-slate-500 dark:text-ndark-muted" />
                  <span className="font-medium text-slate-900 dark:text-ndark-text">
                    {p.name}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-ndark-surface dark:text-ndark-muted">
                    {p.code}
                  </span>
                  <Badge tint={projectStatusTint(p.status)}>
                    {PROJECT_STATUS_LABELS[p.status] ?? p.status}
                  </Badge>
                  {!p.isActive && <Badge tint="slate">Pasif</Badge>}
                  <Badge tint="blue">{p.companyName}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-ndark-muted">
                  {p.startDate && <span>Başlangıç: {formatDate(p.startDate)}</span>}
                  {p.endDate && <span>Bitiş: {formatDate(p.endDate)}</span>}
                </div>
                {p.description && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600 dark:text-ndark-muted">
                    {p.description}
                  </p>
                )}
              </div>
              {isWriter && (
                <button
                  type="button"
                  onClick={() => onEdit(p, p.accountCompanyId)}
                  title="Düzenle"
                  aria-label={`${p.name} projesini düzenle`}
                  className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-surface dark:hover:text-ndark-text"
                >
                  <Pencil size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function projectStatusTint(status: string): BadgeTint {
  switch (status) {
    case 'Active':
      return 'emerald';
    case 'Passive':
      return 'slate';
    case 'Completed':
      return 'blue';
    case 'Cancelled':
      return 'rose';
    default:
      return 'slate';
  }
}

function AddressesSection({
  addresses,
  companies,
  isWriter,
  onAdd,
  onEdit,
}: {
  addresses: AccountDetail['addresses'];
  companies: AccountDetail['companies'];
  isWriter: boolean;
  onAdd: () => void;
  onEdit: (address: AccountAddressSummary) => void;
}) {
  // WR-A3 — Account-level adres listesi; companyId chip ile şirket bağı görünür.
  const companyName = (companyId: string) =>
    companies.find((c) => c.companyId === companyId)?.companyName ?? companyId;
  const total = addresses.length;
  const canAdd = isWriter && companies.length > 0;

  return (
    <SectionCard
      title="Adresler"
      subtitle="Faturalama, merkez, şube, saha ziyaret, sevkiyat — country-agnostic"
      action={
        canAdd ? (
          <Button variant="outline" size="sm" leftIcon={<Plus size={12} />} onClick={onAdd}>
            Adres Ekle
          </Button>
        ) : null
      }
    >
      {total === 0 ? (
        <EmptyState
          size="sm"
          icon={<MapPin size={16} />}
          title="Adres yok"
          description={
            isWriter
              ? companies.length === 0
                ? 'Önce müşteriyi bir şirkete bağla, sonra adres ekleyebilirsin.'
                : 'Müşterinin adres bilgilerini eklemek için yukarıdaki düğmeyi kullan.'
              : 'Bu müşteri için henüz adres tanımlanmamış.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {addresses.map((a) => (
            <li
              key={a.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-ndark-border"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <MapPin size={13} className="text-slate-500 dark:text-ndark-muted" />
                  <Badge tint={addressTypeTint(a.type)}>
                    {ADDRESS_TYPE_LABELS[a.type] ?? a.type}
                  </Badge>
                  {a.label && (
                    <span className="font-medium text-slate-900 dark:text-ndark-text">
                      {a.label}
                    </span>
                  )}
                  {a.isDefault && <Badge tint="amber">Varsayılan</Badge>}
                  {!a.isActive && <Badge tint="slate">Pasif</Badge>}
                  <Badge tint="blue">{companyName(a.companyId)}</Badge>
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-ndark-surface dark:text-ndark-muted">
                    {a.country}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-700 dark:text-ndark-text">
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ''}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-ndark-muted">
                  {[a.district, a.city, a.state, a.postalCode].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              {isWriter && (
                <button
                  type="button"
                  onClick={() => onEdit(a)}
                  title="Düzenle"
                  aria-label={`${ADDRESS_TYPE_LABELS[a.type] ?? a.type} adresini düzenle`}
                  className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-surface dark:hover:text-ndark-text"
                >
                  <Pencil size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function addressTypeTint(type: string): BadgeTint {
  switch (type) {
    case 'Billing':
      return 'emerald';
    case 'Shipping':
      return 'sky';
    case 'Visit':
      return 'violet';
    case 'Headquarters':
      return 'indigo';
    case 'Branch':
      return 'teal';
    default:
      return 'slate';
  }
}

function ContactsSection({
  contacts,
  isWriter,
  onAdd,
  onEdit,
}: {
  contacts: AccountDetail['contacts'];
  isWriter: boolean;
  onAdd: () => void;
  onEdit: (contact: AccountContact) => void;
}) {
  return (
    <SectionCard
      title="İletişim Kişileri"
      subtitle="Karar verici, teknik lider veya operasyonel iletişim noktaları"
      action={
        isWriter ? (
          <Button variant="outline" size="sm" leftIcon={<Plus size={12} />} onClick={onAdd}>
            Kontak Ekle
          </Button>
        ) : null
      }
    >
      {contacts.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Users size={16} />}
          title="Kontak yok"
          description={
            isWriter
              ? 'Karar verici / iletişim noktası eklemek için yukarıdaki düğmeyi kullan.'
              : 'Bu müşteri için henüz kontak girilmemiş.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-ndark-border"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900 dark:text-ndark-text">
                    {c.fullName}
                  </span>
                  {c.title && (
                    <span className="text-xs text-slate-500 dark:text-ndark-muted">{c.title}</span>
                  )}
                  {c.isPrimary && <Badge tint="emerald">Birincil</Badge>}
                  {!c.isActive && <Badge tint="slate">Pasif</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-ndark-muted">
                  {c.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone size={11} /> {c.phone}
                    </span>
                  )}
                  {c.email && (
                    <span className="inline-flex items-center gap-1">
                      <Mail size={11} /> {c.email}
                    </span>
                  )}
                  {c.preferredChannel && (
                    <span className="text-[11px] text-slate-500 dark:text-ndark-muted">
                      Tercih: {c.preferredChannel}
                    </span>
                  )}
                </div>
              </div>
              {isWriter && (
                <button
                  type="button"
                  onClick={() => onEdit(c)}
                  title="Düzenle"
                  aria-label={`${c.fullName} kontağını düzenle`}
                  className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-surface dark:hover:text-ndark-text"
                >
                  <Pencil size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function CasesSection({
  stats,
  recent,
  onSelectCase,
}: {
  stats: AccountDetail['caseStats'];
  recent: AccountDetail['recentCases'];
  onSelectCase?: (caseId: string) => void;
}) {
  return (
    <SectionCard title="Vaka Geçmişi" subtitle="Son 5 vaka ve özet metrikler">
      <div className="grid grid-cols-2 gap-2 text-center">
        <Stat label="Toplam" value={stats.total} />
        <Stat label="Açık" value={stats.open} tint={stats.open > 0 ? 'rose' : 'slate'} />
        <Stat label="Çözüldü" value={stats.resolved} tint="emerald" />
        <Stat
          label="SLA İhlali"
          value={stats.slaBreachCount}
          tint={stats.slaBreachCount > 0 ? 'amber' : 'slate'}
        />
      </div>
      {recent.length === 0 ? (
        <EmptyState size="sm" icon={<Inbox size={16} />} title="Vaka geçmişi yok" />
      ) : (
        <ul className="space-y-1.5">
          {recent.slice(0, 5).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelectCase?.(c.id)}
                disabled={!onSelectCase}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-ndark-surface dark:disabled:hover:bg-transparent"
              >
                <Clock size={11} className="mt-0.5 shrink-0 text-slate-400 dark:text-ndark-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-800 dark:text-ndark-text">
                    {c.title}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-ndark-muted">
                    {c.caseNumber} · {c.status} · {c.priority} · {formatDate(c.createdAt)}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-ndark-border dark:bg-ndark-card">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">{title}</h2>
          {subtitle && (
            <p className="text-[11px] text-slate-500 dark:text-ndark-muted">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-1.5 last:border-b-0 last:pb-0 dark:border-ndark-border/60">
      <dt className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-ndark-muted">
        {icon}
        {label}
      </dt>
      <dd className="truncate text-sm text-slate-800 dark:text-ndark-text">
        {value || <span className="text-slate-400 dark:text-ndark-dim">—</span>}
      </dd>
    </div>
  );
}

function KeyVal({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-slate-500 dark:text-ndark-muted">{label}</dt>
      <dd className="truncate text-slate-700 dark:text-ndark-text">{value}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  tint = 'slate',
}: {
  label: string;
  value: number;
  tint?: BadgeTint;
}) {
  const colorMap: Record<BadgeTint, string> = {
    slate: 'text-slate-900 dark:text-ndark-text',
    rose: 'text-rose-700 dark:text-rose-300',
    emerald: 'text-emerald-700 dark:text-emerald-300',
    amber: 'text-amber-700 dark:text-amber-300',
    blue: 'text-blue-700 dark:text-blue-300',
    indigo: 'text-indigo-700 dark:text-indigo-300',
    sky: 'text-sky-700 dark:text-sky-300',
    violet: 'text-violet-700 dark:text-violet-300',
    teal: 'text-teal-700 dark:text-teal-300',
  };
  return (
    <div className="rounded-md bg-slate-50 px-2 py-2 dark:bg-ndark-surface">
      <div className={`text-lg font-semibold ${colorMap[tint]}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
        {label}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <div className="space-y-5">
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </div>
      </div>
    </div>
  );
}

function statusTint(status: string): BadgeTint {
  switch (status) {
    case 'active':
      return 'emerald';
    case 'churn':
      return 'rose';
    case 'prospect':
      return 'amber';
    case 'inactive':
      return 'slate';
    default:
      return 'blue';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Aktif';
    case 'churn':
      return 'Churn';
    case 'prospect':
      return 'Aday';
    case 'inactive':
      return 'Pasif';
    default:
      return status;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
