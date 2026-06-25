import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Filter, KeyRound, Pencil, Power, PowerOff, ShieldCheck } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeTint } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { lookupService } from '@/services/caseService';
import { authorizationService, type AuthorizationRegistry } from '@/services/authorizationService';
import {
  adminService,
  type AdminUser,
  type AuthorizationPolicy,
  type AuthorizationEffectivePreview,
  type AuthorizationPolicyEffect,
  type AuthorizationPolicyInput,
  type AuthorizationPolicyTarget,
  type AuthorizationPrincipalType,
} from '@/services/adminService';
import type { CasePerson, CaseTeam } from '@/features/cases/types';
import { AdminListLayout } from './AdminListLayout';
import { AUTHORIZATION_POLICIES_HELP } from './helpContents';

const POLICY_TARGETS: { value: AuthorizationPolicyTarget; label: string }[] = [
  { value: 'menu', label: 'Menü' },
  { value: 'resource', label: 'Kayıt İşlemleri' },
  { value: 'field', label: 'Alan Yetkisi' },
  { value: 'securityFilter', label: 'Güvenlik Filtresi' },
];

const PRINCIPAL_TYPES: { value: AuthorizationPrincipalType; label: string }[] = [
  { value: 'systemRole', label: 'Sistem rolü' },
  { value: 'companyRole', label: 'Şirket rolü' },
  { value: 'team', label: 'Takım' },
  { value: 'user', label: 'Kullanıcı' },
];

const EFFECTS: { value: AuthorizationPolicyEffect; label: string }[] = [
  { value: 'allow', label: 'İzin ver' },
  { value: 'deny', label: 'Engelle' },
];

const ENFORCEMENT_STATUS: Record<
  AuthorizationPolicyTarget,
  { label: string; tint: BadgeTint; description: string }
> = {
  menu: {
    label: 'Canlı',
    tint: 'emerald',
    description: 'Menü görünürlüğü, feature flag açık olduğunda uygulama navigasyonunda dikkate alınır.',
  },
  resource: {
    label: 'Pilot',
    tint: 'violet',
    description: 'Kayıt işlemi kuralları seçili vaka notu/dosya API uçlarında AUTHORIZATION_RESOURCE_ENFORCEMENT_ENABLED=true iken daraltıcı guard olarak çalışır.',
  },
  field: {
    label: 'Pilot',
    tint: 'violet',
    description: 'Alan zorunluluğu kuralları case.close kapsamındaki seçili kapanış alanlarında AUTHORIZATION_FIELD_ENFORCEMENT_ENABLED=true iken pilot çalışır.',
  },
  securityFilter: {
    label: 'Pilot',
    tint: 'violet',
    description: 'Güvenlik filtresi kuralları vaka listeleme uçlarında AUTHORIZATION_SECURITY_FILTER_ENFORCEMENT_ENABLED=true iken daraltıcı kayıt filtresi olarak pilot çalışır.',
  },
};

const TARGET_LABELS = Object.fromEntries(POLICY_TARGETS.map((x) => [x.value, x.label])) as Record<
  AuthorizationPolicyTarget,
  string
>;
const PRINCIPAL_LABELS = Object.fromEntries(PRINCIPAL_TYPES.map((x) => [x.value, x.label])) as Record<
  AuthorizationPrincipalType,
  string
>;

const DEFAULT_FILTER_JSON = `{
  "op": "in",
  "field": "@record.companyId",
  "value": "@user.allowedCompanyIds"
}`;

const SECURITY_FILTER_PRESETS: Array<{
  value: string;
  label: string;
  description: string;
  expression: unknown;
}> = [
  {
    value: 'company_scope',
    label: 'Yetkili olduğu şirket kayıtları',
    description: 'Kullanıcı yalnızca erişim hakkı olan şirketlerin kayıtlarını görür.',
    expression: {
      op: 'in',
      field: '@record.companyId',
      value: '@user.allowedCompanyIds',
    },
  },
  {
    value: 'assigned_to_me',
    label: 'Bana atanmış kayıtlar',
    description: 'Kullanıcı yalnızca kendisine atanmış kayıtları görür.',
    expression: {
      op: 'eq',
      field: '@record.assignedPersonId',
      value: '@user.personId',
    },
  },
  {
    value: 'assigned_to_my_team',
    label: 'Takımıma atanmış kayıtlar',
    description: 'Kullanıcı yalnızca kendi takımına atanmış kayıtları görür.',
    expression: {
      op: 'eq',
      field: '@record.assignedTeamId',
      value: '@user.teamId',
    },
  },
  {
    value: 'company_and_me_or_team',
    label: 'Şirket + bana veya takımıma atanmış',
    description: 'Kullanıcı yetkili şirketlerde, kendisine veya takımına atanmış kayıtları görür.',
    expression: {
      op: 'and',
      conditions: [
        { op: 'in', field: '@record.companyId', value: '@user.allowedCompanyIds' },
        {
          op: 'or',
          conditions: [
            { op: 'eq', field: '@record.assignedPersonId', value: '@user.personId' },
            { op: 'eq', field: '@record.assignedTeamId', value: '@user.teamId' },
          ],
        },
      ],
    },
  },
];

type SelectOption = { value: string; label: string; detail?: string };
type MenuOption = SelectOption & { key: string; group: string };
type ResourceOption = SelectOption & { category: string; actions: string[] };
type FieldScopeOption = SelectOption & { resourceKey: string; fields: SelectOption[] };

const SYSTEM_ROLE_OPTIONS: SelectOption[] = [
  { value: 'Agent', label: 'Agent' },
  { value: 'Backoffice', label: 'Backoffice' },
  { value: 'Supervisor', label: 'Supervisor' },
  { value: 'CSM', label: 'CSM' },
  { value: 'Admin', label: 'Admin' },
  { value: 'SystemAdmin', label: 'SystemAdmin' },
];

const COMPANY_ROLE_OPTIONS: SelectOption[] = [
  { value: 'Agent', label: 'Agent' },
  { value: 'Supervisor', label: 'Supervisor' },
  { value: 'Admin', label: 'Admin' },
  { value: 'SystemAdmin', label: 'SystemAdmin' },
];

const MENU_GROUP_LABELS: Record<string, string> = {
  main: 'Ana Menü',
  workspace: 'Çalışma Alanı',
  reports: 'Raporlar',
  case: 'Vaka',
  'admin.definitions': 'Yönetim / Tanımlar',
  'admin.configuration': 'Yönetim / Yapılandırma',
  'admin.company': 'Yönetim / Şirket',
};

const MENU_OPTIONS: MenuOption[] = [
  { key: 'main.myHome', value: 'my-home', label: 'Anasayfa', group: 'main' },
  { key: 'main.cases', value: 'cases', label: 'Vakalar', group: 'main' },
  { key: 'main.dashboard', value: 'dashboard', label: 'Vaka Raporları', group: 'main' },
  { key: 'main.accounts', value: 'accounts', label: 'Müşteriler', group: 'main' },
  { key: 'workspace.calendar', value: 'my-calendar', label: 'Takvimim', group: 'workspace' },
  { key: 'workspace.watching', value: 'watching', label: 'İzleyici Inbox', group: 'workspace' },
  { key: 'workspace.knowledgeBase', value: 'kb-viewer', label: 'Bilgi Bankası', group: 'workspace' },
  { key: 'reports.aiUsage', value: 'analytics-ai-usage', label: 'AI Kullanımı', group: 'reports' },
  { key: 'reports.qaScores', value: 'analytics-qa-scores', label: 'QA Skorları', group: 'reports' },
  { key: 'reports.patterns', value: 'analytics-patterns', label: 'Örüntü Alarmları', group: 'reports' },
  { key: 'reports.caseStudio', value: 'case-report-studio', label: 'Rapor Stüdyosu', group: 'reports' },
  { key: 'reports.rootCause', value: 'root-cause-report', label: 'Kök Neden Analiz Raporu', group: 'reports' },
  { key: 'reports.taggingReview', value: 'tagging-review', label: 'Etiket Doğrulama', group: 'reports' },
  { key: 'smartTicket.intake', value: 'smart-ticket-new', label: 'Akıllı Ticket', group: 'case' },
  { key: 'admin.categories', value: 'admin-categories', label: 'Kategori & Alt Kategori', group: 'admin.definitions' },
  { key: 'admin.sla', value: 'admin-sla', label: 'SLA Kuralları', group: 'admin.definitions' },
  { key: 'admin.checklist', value: 'admin-checklist', label: 'Kontrol Listesi', group: 'admin.definitions' },
  { key: 'admin.thirdParty', value: 'admin-thirdparty', label: '3. Parti Tanımları', group: 'admin.definitions' },
  { key: 'admin.documents', value: 'admin-documents', label: 'Belge Türleri', group: 'admin.definitions' },
  { key: 'admin.offeredSolutions', value: 'admin-offered-solutions', label: 'Teklif Tanımları', group: 'admin.definitions' },
  { key: 'admin.productCatalog', value: 'admin-product-catalog', label: 'Ürün Kataloğu', group: 'admin.definitions' },
  { key: 'admin.teams', value: 'admin-teams', label: 'Takımlar & Üyeler', group: 'admin.definitions' },
  { key: 'admin.taxonomyDefs', value: 'admin-taxonomy-defs', label: 'Akıllı Ticket Tanımları', group: 'admin.definitions' },
  { key: 'admin.fields', value: 'admin-fields', label: 'Dinamik Alanlar', group: 'admin.configuration' },
  { key: 'admin.knowledgeSources', value: 'admin-knowledge', label: 'Bilgi Kaynakları', group: 'admin.configuration' },
  { key: 'admin.externalKb', value: 'admin-external-kb', label: 'Bilgi Bankası Entegrasyonu', group: 'admin.configuration' },
  { key: 'admin.externalDevOps', value: 'admin-external-devops', label: 'DevOps / TFS Entegrasyonu', group: 'admin.configuration' },
  { key: 'admin.externalMail', value: 'admin-external-mail', label: 'Mail Entegrasyonu', group: 'admin.configuration' },
  { key: 'admin.dataImport', value: 'admin-data-import', label: 'Veri Aktarım Stüdyosu', group: 'admin.configuration' },
  { key: 'admin.resolutionApproval', value: 'admin-resolution-approval', label: 'Çözüm Onayı Politikaları', group: 'admin.configuration' },
  { key: 'admin.notificationTemplates', value: 'admin-notification-templates', label: 'Bildirim Şablonları', group: 'admin.configuration' },
  { key: 'admin.notificationRules', value: 'admin-notification-rules', label: 'Bildirim Kuralları', group: 'admin.configuration' },
  { key: 'admin.notificationDispatches', value: 'admin-notification-dispatches', label: 'Bildirim Kayıtları', group: 'admin.configuration' },
  { key: 'admin.authorizationPolicies', value: 'admin-authorization-policies', label: 'Yetkilendirme Yönetimi', group: 'admin.configuration' },
  { key: 'admin.companies', value: 'admin-companies', label: 'Şirketler', group: 'admin.company' },
  { key: 'admin.users', value: 'admin-users', label: 'Kullanıcılar', group: 'admin.company' },
];

const RESOURCE_CATEGORY_LABELS: Record<string, string> = {
  case: 'Vaka',
  customer360: 'Müşteri 360',
  reporting: 'Raporlama',
  admin: 'Yönetim',
};

const RESOURCE_OPTIONS: ResourceOption[] = [
  { value: 'case', label: 'Vaka', category: 'case', actions: ['create', 'read', 'update', 'assign', 'transfer', 'close', 'archive', 'restore'] },
  { value: 'case.note', label: 'Vaka Notu', category: 'case', actions: ['create', 'read', 'update', 'delete'] },
  { value: 'case.attachment', label: 'Vaka Dosyası', category: 'case', actions: ['create', 'read', 'delete'] },
  { value: 'case.solutionStep', label: 'Çözüm Adımı', category: 'case', actions: ['create', 'read', 'update'] },
  { value: 'case.watcher', label: 'Vaka İzleyicisi', category: 'case', actions: ['create', 'read', 'delete'] },
  { value: 'case.link', label: 'Vaka Bağlantısı', category: 'case', actions: ['create', 'read', 'delete'] },
  { value: 'account', label: 'Müşteri', category: 'customer360', actions: ['create', 'read', 'update', 'delete'] },
  { value: 'account.contact', label: 'Müşteri Kontağı', category: 'customer360', actions: ['create', 'read', 'update', 'delete'] },
  { value: 'account.project', label: 'Müşteri Projesi', category: 'customer360', actions: ['create', 'read', 'update', 'delete'] },
  { value: 'report.caseStudio', label: 'Vaka Rapor Stüdyosu', category: 'reporting', actions: ['read', 'export'] },
  { value: 'report.view', label: 'Kayıtlı Rapor Görünümü', category: 'reporting', actions: ['create', 'read', 'update', 'delete'] },
  { value: 'admin.team', label: 'Takım', category: 'admin', actions: ['create', 'read', 'update', 'delete'] },
  { value: 'admin.category', label: 'Kategori', category: 'admin', actions: ['create', 'read', 'update', 'delete'] },
  { value: 'admin.slaPolicy', label: 'SLA Politikası', category: 'admin', actions: ['create', 'read', 'update', 'delete'] },
  { value: 'admin.fieldDefinition', label: 'Dinamik Alan', category: 'admin', actions: ['create', 'read', 'update', 'delete'] },
  { value: 'admin.taxonomyDef', label: 'Akıllı Ticket Tanımı', category: 'admin', actions: ['create', 'read', 'update', 'delete'] },
  { value: 'admin.notificationRule', label: 'Bildirim Kuralı', category: 'admin', actions: ['create', 'read', 'update', 'delete'] },
  { value: 'admin.user', label: 'Kullanıcı', category: 'admin', actions: ['create', 'read', 'update', 'delete'] },
];

const ACTION_LABELS: Record<string, string> = {
  create: 'Oluştur',
  read: 'Oku',
  update: 'Güncelle',
  delete: 'Sil / Pasifleştir',
  export: 'Dışa aktar',
  approve: 'Onayla',
  assign: 'Üstlen / Ata',
  transfer: 'Devret',
  close: 'Kapat / Çöz',
  archive: 'Arşivle',
  restore: 'Geri al',
};

const FIELD_ACTION_OPTIONS: SelectOption[] = [
  { value: 'visible', label: 'Görünsün' },
  { value: 'readable', label: 'Okunabilsin' },
  { value: 'editable', label: 'Düzenlenebilsin' },
  { value: 'required', label: 'Zorunlu olsun' },
  { value: 'masked', label: 'Maskelensin' },
];

const FIELD_SCOPE_OPTIONS: FieldScopeOption[] = [
  {
    value: 'case.open',
    label: 'Vaka Açılışı',
    resourceKey: 'case',
    fields: [
      { value: 'accountId', label: 'Müşteri' },
      { value: 'projectId', label: 'Proje' },
      { value: 'title', label: 'Başlık' },
      { value: 'description', label: 'Açıklama' },
      { value: 'requestType', label: 'Talep Türü' },
      { value: 'priority', label: 'Öncelik' },
      { value: 'category', label: 'Kategori' },
      { value: 'subCategory', label: 'Alt Kategori' },
      { value: 'attachments', label: 'Dosyalar' },
    ],
  },
  {
    value: 'case.detail',
    label: 'Vaka Detayı',
    resourceKey: 'case',
    fields: [
      { value: 'priority', label: 'Öncelik' },
      { value: 'assignedTeamId', label: 'Atanan Takım' },
      { value: 'assignedPersonId', label: 'Atanan Kişi' },
      { value: 'category', label: 'Kategori' },
      { value: 'subCategory', label: 'Alt Kategori' },
      { value: 'requestType', label: 'Talep Türü' },
      { value: 'description', label: 'Açıklama' },
      { value: 'internalNote', label: 'İç Not' },
    ],
  },
  {
    value: 'case.close',
    label: 'Vaka Kapanışı',
    resourceKey: 'case',
    fields: [
      { value: 'resolutionNote', label: 'Çözüm Açıklaması' },
      { value: 'rootCauseGroup', label: 'Kök Neden Grubu' },
      { value: 'rootCauseDetail', label: 'Kök Neden Detayı' },
      { value: 'resolutionType', label: 'Çözüm Tipi' },
      { value: 'permanentPrevention', label: 'Kalıcı Önlem' },
    ],
  },
  {
    value: 'case.transfer',
    label: 'Vaka Devri',
    resourceKey: 'case',
    fields: [
      { value: 'transferNote', label: 'Devir Notu' },
      { value: 'toTeamId', label: 'Hedef Takım' },
      { value: 'toPersonId', label: 'Hedef Kişi' },
      { value: 'priority', label: 'Öncelik' },
    ],
  },
  {
    value: 'smartTicket.stage1',
    label: 'Akıllı Ticket / 1. Adım',
    resourceKey: 'case',
    fields: [
      { value: 'accountId', label: 'Müşteri' },
      { value: 'projectId', label: 'Proje' },
      { value: 'title', label: 'Başlık' },
      { value: 'description', label: 'Konu Detayı' },
      { value: 'requestType', label: 'Talep Türü' },
      { value: 'priority', label: 'Öncelik' },
      { value: 'attachments', label: 'Dosyalar' },
    ],
  },
  {
    value: 'smartTicket.stage3Closure',
    label: 'Akıllı Ticket / Çözümle Kapat',
    resourceKey: 'case',
    fields: [
      { value: 'rootCauseGroup', label: 'Kök Neden Grubu' },
      { value: 'rootCauseDetail', label: 'Kök Neden Detayı' },
      { value: 'resolutionType', label: 'Çözüm Tipi' },
      { value: 'permanentPrevention', label: 'Kalıcı Önlem' },
      { value: 'resolutionNote', label: 'Çözüm Açıklaması' },
    ],
  },
  {
    value: 'smartTicket.stage3Transfer',
    label: 'Akıllı Ticket / L2 Devri',
    resourceKey: 'case',
    fields: [
      { value: 'transferNote', label: 'Devir Notu' },
      { value: 'toTeamId', label: 'Hedef Takım' },
      { value: 'toPersonId', label: 'Hedef Kişi' },
      { value: 'priority', label: 'Öncelik' },
    ],
  },
];

function menuOptionsFromRegistry(registry: AuthorizationRegistry | null): MenuOption[] {
  if (!registry) return MENU_OPTIONS;
  return registry.menus.map((m) => ({
    key: m.key,
    value: m.viewKey,
    label: m.label,
    group: m.group,
  }));
}

function resourceOptionsFromRegistry(registry: AuthorizationRegistry | null): ResourceOption[] {
  if (!registry) return RESOURCE_OPTIONS;
  return registry.resources.map((r) => ({
    value: r.key,
    label: r.label,
    category: r.category,
    actions: r.actions,
  }));
}

/**
 * Bu ekran eski Varuna'daki yetkilendirme matrisini menü, kayıt işlemi, alan ve
 * güvenlik filtresi düzeyinde yönetmek için kullanılır.
 */
export function AdminAuthorizationPoliciesPage() {
  const companies = useMemo(() => lookupService.companies(), []);
  const teams = useMemo(() => lookupService.teams(), []);
  const persons = useMemo(() => lookupService.persons(), []);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [target, setTarget] = useState<AuthorizationPolicyTarget | ''>('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<AuthorizationPolicy[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [registry, setRegistry] = useState<AuthorizationRegistry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [previewPrincipalType, setPreviewPrincipalType] = useState<AuthorizationPrincipalType>('systemRole');
  const [previewPrincipalKey, setPreviewPrincipalKey] = useState('Agent');
  const [preview, setPreview] = useState<AuthorizationEffectivePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const { toast } = useToast();

  const previewPrincipalOptions = useMemo(
    () => buildPrincipalOptions(previewPrincipalType, companyId, companies, teams, persons, users),
    [previewPrincipalType, companyId, companies, teams, persons, users],
  );
  const menuOptions = useMemo(() => menuOptionsFromRegistry(registry), [registry]);
  const resourceOptions = useMemo(() => resourceOptionsFromRegistry(registry), [registry]);

  async function refresh() {
    if (!companyId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await adminService.authorizationPolicies.list({
        companyId,
        target: target || undefined,
        isActive: includeInactive ? undefined : true,
      });
      setItems(list);
    } catch (err) {
      setError((err as Error).message ?? 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, target, includeInactive]);

  useEffect(() => {
    let alive = true;
    adminService.users
      .list()
      .then((list) => {
        if (alive) setUsers(list);
      })
      .catch(() => {
        if (alive) setUsers([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    authorizationService
      .registry()
      .then((value) => {
        if (alive) setRegistry(value);
      })
      .catch(() => {
        if (alive) setRegistry(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q) return items;
    return items.filter((p) => {
      const haystack = [
        p.target,
        p.principalType,
        p.principalKey,
        p.effect,
        p.menuKey,
        p.viewKey,
        p.resourceKey,
        p.action,
        p.scope,
        p.fieldKey,
        p.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR');
      return haystack.includes(q);
    });
  }, [items, search]);

  async function handleToggleActive(row: AuthorizationPolicy) {
    const result = await adminService.authorizationPolicies.setActive(row.id, !row.isActive);
    if (result.ok) {
      await refresh();
      toast({
        type: 'success',
        message: result.item.isActive ? 'Yetki kuralı aktif edildi.' : 'Yetki kuralı pasifleştirildi.',
        duration: 2000,
      });
    } else {
      toast({ type: 'error', message: result.error });
    }
  }

  async function handlePreview() {
    if (!companyId || !previewPrincipalKey.trim()) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await adminService.authorizationPolicies.effectivePreview({
        companyId,
        principalType: previewPrincipalType,
        principalKey: previewPrincipalKey.trim(),
        featureFlags: { smartTicketIntakeEnabled: true },
      });
      setPreview(result);
    } catch (err) {
      setPreviewError((err as Error).message ?? 'Önizleme hesaplanamadı');
    } finally {
      setPreviewLoading(false);
    }
  }

  if (!companyId) {
    return (
      <AdminListLayout
        title="Yetkilendirme Yönetimi"
        description="Menü görünürlüğü, kayıt işlemleri, alan zorunluluğu ve kayıt erişim kuralları."
        helpTitle={AUTHORIZATION_POLICIES_HELP.title}
        helpSections={AUTHORIZATION_POLICIES_HELP.sections}
      >
        <CardBody>
          <EmptyState
            icon={<ShieldCheck size={22} />}
            title="Şirket seçilmedi"
            description="Yetki kuralı yönetimi için önce bir şirket seçin."
          />
        </CardBody>
      </AdminListLayout>
    );
  }

  return (
    <>
      <AdminListLayout
        title="Yetkilendirme Yönetimi"
        description="Kullanıcı, rol ve takım bazında menü görünürlüğünü yönetin; kayıt işlemi, alan ve kayıt erişim kurallarını önizleyip kontrollü devreye alın."
        count={filtered.length}
        searchPlaceholder="Kime uygulanır, kaynak, işlem veya nota göre ara…"
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setEditor({ mode: 'create' })}
        addLabel="Yeni Yetki Kuralı"
        loading={loading}
        error={error}
        onRetry={() => void refresh()}
        helpTitle={AUTHORIZATION_POLICIES_HELP.title}
        helpSections={AUTHORIZATION_POLICIES_HELP.sections}
        filters={
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-52">
              <CompanySelector
                label="Şirket"
                value={companyId}
                  onChange={(id) => {
                    const nextCompanyId = id ?? '';
                    setCompanyId(nextCompanyId);
                    setPreview(null);
                    const nextOptions = buildPrincipalOptions(
                      previewPrincipalType,
                      nextCompanyId,
                      companies,
                      teams,
                      persons,
                      users,
                    );
                    setPreviewPrincipalKey(nextOptions[0]?.value ?? '');
                  }}
                required
              />
            </div>
            <div className="w-48">
              <Field label="Kural Tipi">
                <Select
                  value={target}
                  onChange={(e) => setTarget(e.target.value as AuthorizationPolicyTarget | '')}
                >
                  <option value="">Tümü</option>
                  {POLICY_TARGETS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Pasifleri göster
            </label>
          </div>
        }
      >
        <EnforcementStatusNotice />

        <EffectivePreviewPanel
          principalType={previewPrincipalType}
          principalKey={previewPrincipalKey}
          principalOptions={previewPrincipalOptions}
          preview={preview}
          loading={previewLoading}
          error={previewError}
          onPrincipalTypeChange={(value) => {
            setPreviewPrincipalType(value);
            const nextOptions = buildPrincipalOptions(value, companyId, companies, teams, persons, users);
            setPreviewPrincipalKey(nextOptions[0]?.value ?? '');
            setPreview(null);
          }}
          onPrincipalKeyChange={(value) => {
            setPreviewPrincipalKey(value);
            setPreview(null);
          }}
          onPreview={() => void handlePreview()}
        />

        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<ShieldCheck size={22} />}
              title={search ? 'Aramaya uyan yetki kuralı yok' : 'Henüz yetki kuralı yok'}
              description={
                search
                  ? 'Farklı bir arama deneyin.'
                  : 'İlk menü, kayıt işlemi, alan veya güvenlik filtresi yetki kuralını oluşturun.'
              }
              action={
                !search ? (
                  <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
                    Yeni Yetki Kuralı
                  </Button>
                ) : undefined
              }
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <Th>Kural</Th>
                  <Th>Kime Uygulanır?</Th>
                  <Th>Etki</Th>
                  <Th>Hedef</Th>
                  <Th>Uygulama</Th>
                  <Th align="right">Öncelik</Th>
                  <Th>Durum</Th>
                  <Th align="right">Aksiyon</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <Td>
                      <div className="flex items-center gap-2">
                        <Badge tint="violet">{TARGET_LABELS[row.target]}</Badge>
                        <span className="font-mono text-[10px] text-slate-400">{row.id}</span>
                      </div>
                      {row.notes && <div className="mt-1 text-xs text-slate-500">{row.notes}</div>}
                    </Td>
                    <Td>
                      <div className="font-medium text-slate-800">
                        {formatPrincipalLabel(row.principalType, row.principalKey, row.companyId, companies, teams, persons, users)}
                      </div>
                      <div className="text-xs text-slate-500">{PRINCIPAL_LABELS[row.principalType]}</div>
                    </Td>
                    <Td>
                      {row.effect === 'allow' ? (
                        <Badge tint="emerald">İzin</Badge>
                      ) : (
                        <Badge tint="rose">Engel</Badge>
                      )}
                    </Td>
                    <Td>
                      <PolicyTargetSummary row={row} menuOptions={menuOptions} resourceOptions={resourceOptions} />
                    </Td>
                    <Td>
                      <EnforcementBadge target={row.target} />
                    </Td>
                    <Td align="right" className="text-slate-600">{row.priority}</Td>
                    <Td>
                      {row.isActive ? <Badge tint="emerald">Aktif</Badge> : <Badge tint="slate">Pasif</Badge>}
                    </Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditor({ mode: 'edit', id: row.id })}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          title="Düzenle"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleActive(row)}
                          className={`rounded p-1.5 hover:bg-slate-100 ${
                            row.isActive
                              ? 'text-amber-600 hover:text-amber-700'
                              : 'text-emerald-600 hover:text-emerald-700'
                          }`}
                          title={row.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                        >
                          {row.isActive ? <PowerOff size={14} /> : <Power size={14} />}
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminListLayout>

      <AuthorizationPolicyModal
        open={editor !== null}
        mode={editor?.mode ?? 'create'}
        editingId={editor?.mode === 'edit' ? editor.id : null}
        companyId={companyId}
        companies={companies}
        teams={teams}
        persons={persons}
        users={users}
        menuOptions={menuOptions}
        resourceOptions={resourceOptions}
        items={items}
        onClose={() => setEditor(null)}
        onSaved={() => void refresh()}
      />
    </>
  );
}

function EnforcementStatusNotice() {
  return (
    <div className="border-b border-slate-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Uygulama durumu:</span>
        <Badge tint="emerald">Menü canlı</Badge>
        <Badge tint="violet">CRUD pilot</Badge>
        <Badge tint="violet">Alan zorunluluğu pilot</Badge>
        <Badge tint="violet">Güvenlik filtresi pilot</Badge>
      </div>
      <p className="mt-1 text-amber-800">
        Menü görünürlüğü feature flag açık olduğunda uygulamada dikkate alınır. Kayıt işlemi kuralları seçili
        vaka notu/dosya uçlarında flag ile pilot çalışır. Alan zorunluluğu case.close kapsamındaki seçili kapanış
        alanlarında flag ile pilot çalışır. Güvenlik filtresi kuralları vaka listesi ve etiket doğrulama liste/export
        uçlarında flag ile daraltıcı kayıt filtresi olarak pilot çalışır.
      </p>
    </div>
  );
}

function EnforcementBadge({ target }: { target: AuthorizationPolicyTarget }) {
  const info = ENFORCEMENT_STATUS[target];
  return (
    <div className="max-w-56">
      <Badge tint={info.tint}>{info.label}</Badge>
      <div className="mt-1 text-[11px] leading-snug text-slate-500">{info.description}</div>
    </div>
  );
}

function EffectivePreviewPanel({
  principalType,
  principalKey,
  principalOptions,
  preview,
  loading,
  error,
  onPrincipalTypeChange,
  onPrincipalKeyChange,
  onPreview,
}: {
  principalType: AuthorizationPrincipalType;
  principalKey: string;
  principalOptions: SelectOption[];
  preview: AuthorizationEffectivePreview | null;
  loading: boolean;
  error: string | null;
  onPrincipalTypeChange: (value: AuthorizationPrincipalType) => void;
  onPrincipalKeyChange: (value: string) => void;
  onPreview: () => void;
}) {
  const visibleMenus = preview?.menus.filter((m) => m.allowed).slice(0, 6) ?? [];
  const deniedMenus = preview?.menus.filter((m) => !m.allowed).slice(0, 4) ?? [];
  const resourceHighlights = preview?.resources
    .flatMap((r) => r.actions.map((a) => ({ ...a, resourceKey: r.key, label: r.label })))
    .filter((a) => a.reason === 'override_deny' || a.reason === 'override_allow')
    .slice(0, 6) ?? [];

  return (
    <div className="border-b border-slate-200 bg-slate-50/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ShieldCheck size={16} className="text-violet-600" />
            Etkili Yetki Önizlemesi
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Kayıtlı aktif yetki kuralları seçilen rol, takım veya kullanıcı için nasıl sonuç üretir?
            Bu panel kontrol amaçlıdır.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Kime uygulanır?" className="w-44">
            <Select
              value={principalType}
              onChange={(e) => onPrincipalTypeChange(e.target.value as AuthorizationPrincipalType)}
            >
              {PRINCIPAL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hedef" className="w-64">
            <Select
              value={principalKey}
              onChange={(e) => onPrincipalKeyChange(e.target.value)}
            >
              {renderOptionsWithCurrent(principalOptions, principalKey)}
            </Select>
          </Field>
          <Button
            variant="outline"
            onClick={onPreview}
            disabled={loading || !principalKey.trim()}
            leftIcon={<ShieldCheck size={14} />}
          >
            {loading ? 'Hesaplanıyor…' : 'Önizle'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}

      {preview && (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Özet</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <Metric label="Menü açık" value={preview.summary.menuAllowed} tint="emerald" />
              <Metric label="Menü kapalı" value={preview.summary.menuDenied} tint="rose" />
              <Metric label="İşlem izni" value={preview.summary.resourceAllowed} tint="emerald" />
              <Metric label="İşlem engeli" value={preview.summary.resourceDenied} tint="amber" />
            </div>
            <div className="mt-2">
              <Badge tint={preview.summary.securityFilterCount > 0 ? 'violet' : 'slate'}>
                {preview.summary.securityFilterCount} güvenlik filtresi
              </Badge>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Menüler</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {visibleMenus.map((m) => (
                <Badge key={m.key} tint="emerald">{m.label}</Badge>
              ))}
              {deniedMenus.map((m) => (
                <Badge key={m.key} tint="slate">{m.label}</Badge>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Override Etkileri</div>
            {resourceHighlights.length === 0 ? (
              <div className="mt-2 text-xs text-slate-500">Kayıt işlemleri için özel izin veya engel yok.</div>
            ) : (
              <div className="mt-2 space-y-1">
                {resourceHighlights.map((r) => (
                  <div key={`${r.resourceKey}:${r.action}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-slate-700">{r.resourceKey}.{r.action}</span>
                    <Badge tint={r.allowed ? 'emerald' : 'rose'}>
                      {r.allowed ? 'İzin' : 'Engel'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tint }: { label: string; value: number; tint: 'emerald' | 'rose' | 'amber' }) {
  return (
    <div className="rounded-md bg-slate-50 px-2 py-1">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-lg font-semibold ${
        tint === 'emerald' ? 'text-emerald-700' : tint === 'rose' ? 'text-rose-700' : 'text-amber-700'
      }`}>
        {value}
      </div>
    </div>
  );
}

function PolicyTargetSummary({
  row,
  menuOptions,
  resourceOptions,
}: {
  row: AuthorizationPolicy;
  menuOptions: MenuOption[];
  resourceOptions: ResourceOption[];
}) {
  if (row.target === 'menu') {
    const menu = findMenuOptionByViewKey(row.viewKey ?? '', menuOptions);
    return (
      <SummaryLine
        icon={<KeyRound size={13} />}
        title={menu?.label ?? row.viewKey ?? row.menuKey ?? '—'}
        detail={`Menü görünürlüğü${menu ? ` · ${MENU_GROUP_LABELS[menu.group] ?? menu.group}` : ''}`}
      />
    );
  }
  if (row.target === 'resource') {
    const resource = findResourceOption(row.resourceKey ?? '', resourceOptions);
    return (
      <SummaryLine
        icon={<ShieldCheck size={13} />}
        title={resource?.label ?? row.resourceKey ?? '—'}
        detail={row.action ? ACTION_LABELS[row.action] ?? row.action : 'İşlem yok'}
      />
    );
  }
  if (row.target === 'field') {
    const scope = findFieldScopeOption(row.scope ?? '');
    const field = scope?.fields.find((f) => f.value === row.fieldKey);
    return (
      <SummaryLine
        icon={<KeyRound size={13} />}
        title={`${scope?.label ?? row.scope ?? 'Bölüm yok'} · ${field?.label ?? row.fieldKey ?? 'Alan yok'}`}
        detail={row.action ? FIELD_ACTION_OPTIONS.find((x) => x.value === row.action)?.label ?? row.action : 'Alan davranışı yok'}
      />
    );
  }
  const resource = findResourceOption(row.resourceKey ?? '', resourceOptions);
  return <SummaryLine icon={<Filter size={13} />} title={resource?.label ?? row.resourceKey ?? '—'} detail="Güvenlik filtresi" />;
}

function SummaryLine({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div>
        <div className="font-mono text-xs text-slate-700">{title}</div>
        <div className="text-xs text-slate-500">{detail}</div>
      </div>
    </div>
  );
}

function KeyHint({ value, prefix = 'Kaydedilecek değer' }: { value: string | null | undefined; prefix?: string }) {
  if (!value) return null;
  return <div className="mt-1 font-mono text-[11px] text-slate-400">{prefix}: {value}</div>;
}

function renderOptionsWithCurrent(options: SelectOption[], currentValue: string | null | undefined) {
  const current = currentValue ?? '';
  const hasCurrent = current ? options.some((o) => o.value === current) : true;
  return (
    <>
      {!current && <option value="">Seçin…</option>}
      {current && !hasCurrent && <option value={current}>{current} (mevcut özel değer)</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.detail ? `${option.label} — ${option.detail}` : option.label}
        </option>
      ))}
    </>
  );
}

function renderGroupedMenuOptions(currentValue: string, menuOptions: MenuOption[]) {
  const hasCurrent = currentValue ? menuOptions.some((o) => o.value === currentValue) : true;
  const groups = groupBy(menuOptions, (option) => option.group);
  return (
    <>
      {!currentValue && <option value="">Seçin…</option>}
      {currentValue && !hasCurrent && <option value={currentValue}>{currentValue} (mevcut özel değer)</option>}
      {Array.from(groups.entries()).map(([group, options]) => (
        <optgroup key={group} label={MENU_GROUP_LABELS[group] ?? group}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function renderGroupedResourceOptions(currentValue: string, resourceOptions: ResourceOption[]) {
  const hasCurrent = currentValue ? resourceOptions.some((o) => o.value === currentValue) : true;
  const groups = groupBy(resourceOptions, (option) => option.category);
  return (
    <>
      {!currentValue && <option value="">Seçin…</option>}
      {currentValue && !hasCurrent && <option value={currentValue}>{currentValue} (mevcut özel değer)</option>}
      {Array.from(groups.entries()).map(([category, options]) => (
        <optgroup key={category} label={RESOURCE_CATEGORY_LABELS[category] ?? category}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = getKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  });
  return groups;
}

function findMenuOptionByViewKey(viewKey: string, menuOptions: MenuOption[]): MenuOption | undefined {
  return menuOptions.find((m) => m.value === viewKey);
}

function findResourceOption(resourceKey: string, resourceOptions: ResourceOption[]): ResourceOption | undefined {
  return resourceOptions.find((r) => r.value === resourceKey);
}

function findFieldScopeOption(scope: string): FieldScopeOption | undefined {
  return FIELD_SCOPE_OPTIONS.find((s) => s.value === scope);
}

function buildPrincipalOptions(
  principalType: AuthorizationPrincipalType,
  companyId: string,
  companies: ReturnType<typeof lookupService.companies>,
  teams: CaseTeam[],
  persons: CasePerson[],
  users: AdminUser[],
): SelectOption[] {
  if (principalType === 'systemRole') return SYSTEM_ROLE_OPTIONS;
  const company = companies.find((c) => c.id === companyId);
  if (principalType === 'companyRole') {
    return COMPANY_ROLE_OPTIONS.map((role) => ({
      value: `${companyId}:${role.value}`,
      label: `${company?.name ?? companyId} / ${role.label}`,
      detail: `${companyId}:${role.value}`,
    }));
  }
  if (principalType === 'team') {
    return teams
      .filter((team) => team.companyId === companyId)
      .map((team) => ({
        value: team.id,
        label: team.name,
        detail: [team.defaultSupportLevel, team.id].filter(Boolean).join(' · '),
      }));
  }
  const personById = new Map(persons.map((person) => [person.id, person]));
  const teamById = new Map(teams.map((team) => [team.id, team]));
  return users
    .filter((user) => user.isActive && (user.role === 'SystemAdmin' || user.assignments.some((a) => a.companyId === companyId)))
    .map((user) => {
      const person = user.personId ? personById.get(user.personId) : undefined;
      const team = person ? teamById.get(person.teamId) : undefined;
      return {
        value: user.id,
        label: `${user.fullName || user.email}`,
        detail: [user.email, user.role, team?.name].filter(Boolean).join(' · '),
      };
    });
}

function formatPrincipalLabel(
  principalType: AuthorizationPrincipalType,
  principalKey: string,
  companyId: string,
  companies: ReturnType<typeof lookupService.companies>,
  teams: CaseTeam[],
  persons: CasePerson[],
  users: AdminUser[],
): string {
  const options = buildPrincipalOptions(principalType, companyId, companies, teams, persons, users);
  return options.find((option) => option.value === principalKey)?.label ?? principalKey;
}

function AuthorizationPolicyModal({
  open,
  mode,
  editingId,
  companyId,
  companies,
  teams,
  persons,
  users,
  menuOptions,
  resourceOptions,
  items,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  editingId: string | null;
  companyId: string;
  companies: ReturnType<typeof lookupService.companies>;
  teams: CaseTeam[];
  persons: CasePerson[];
  users: AdminUser[];
  menuOptions: MenuOption[];
  resourceOptions: ResourceOption[];
  items: AuthorizationPolicy[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<AuthorizationPolicyInput>(() => emptyPolicy(companyId));
  const [filterText, setFilterText] = useState(DEFAULT_FILTER_JSON);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const principalOptions = useMemo(
    () => buildPrincipalOptions(form.principalType, companyId, companies, teams, persons, users),
    [form.principalType, companyId, companies, teams, persons, users],
  );
  const selectedResource = findResourceOption(form.resourceKey ?? '', resourceOptions);
  const resourceActionOptions = selectedResource?.actions.map((action) => ({
    value: action,
    label: ACTION_LABELS[action] ?? action,
  })) ?? [];
  const selectedFieldScope = findFieldScopeOption(form.scope ?? '');
  const fieldOptions = selectedFieldScope?.fields ?? [];

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && editingId) {
      const row = items.find((x) => x.id === editingId);
      if (row) {
        setForm({
          companyId: row.companyId,
          target: row.target,
          principalType: row.principalType,
          principalKey: row.principalKey,
          effect: row.effect,
          menuKey: row.menuKey,
          viewKey: row.viewKey,
          resourceKey: row.resourceKey,
          action: row.action,
          scope: row.scope,
          fieldKey: row.fieldKey,
          filterJson: row.filterJson,
          priority: row.priority,
          isActive: row.isActive,
          notes: row.notes,
        });
        setFilterText(prettyJson(row.filterJson) || DEFAULT_FILTER_JSON);
      }
      return;
    }
    setForm(emptyPolicy(companyId));
    setFilterText(DEFAULT_FILTER_JSON);
  }, [open, mode, editingId, companyId, items]);

  function patch(patchValue: Partial<AuthorizationPolicyInput>) {
    setForm((f) => ({ ...f, ...patchValue }));
  }

  function handlePrincipalTypeChange(value: AuthorizationPrincipalType) {
    const nextOptions = buildPrincipalOptions(value, companyId, companies, teams, persons, users);
    patch({ principalType: value, principalKey: nextOptions[0]?.value ?? '' });
  }

  function handleMenuChange(viewKey: string) {
    const menu = findMenuOptionByViewKey(viewKey, menuOptions);
    patch({ viewKey, menuKey: menu?.key ?? null });
  }

  function handleResourceChange(resourceKey: string) {
    const nextResource = findResourceOption(resourceKey, resourceOptions);
    patch({ resourceKey, action: nextResource?.actions[0] ?? null });
  }

  function handleFieldScopeChange(scope: string) {
    const nextScope = findFieldScopeOption(scope);
    patch({
      scope,
      resourceKey: nextScope?.resourceKey ?? form.resourceKey ?? 'case',
      fieldKey: nextScope?.fields[0]?.value ?? '',
    });
  }

  function applySecurityFilterPreset(presetValue: string) {
    const preset = SECURITY_FILTER_PRESETS.find((p) => p.value === presetValue);
    if (!preset) return;
    setFilterText(JSON.stringify(preset.expression, null, 2));
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    const payload = buildPayload(form, filterText);
    if ('error' in payload) {
      setSubmitting(false);
      setError(payload.error);
      return;
    }

    const result =
      mode === 'create'
        ? await adminService.authorizationPolicies.create(payload.value)
        : editingId
          ? await adminService.authorizationPolicies.update(editingId, payload.value)
          : null;
    setSubmitting(false);

    if (!result) {
      setError('Yetki kuralı bulunamadı.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
    toast({
      type: 'success',
      message: mode === 'create' ? 'Yetki kuralı oluşturuldu.' : 'Yetki kuralı güncellendi.',
      duration: 2500,
    });
  }

  const canSubmit = form.principalKey?.trim() && !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={mode === 'create' ? 'Yeni Yetki Kuralı' : 'Yetki Kuralını Düzenle'}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {submitting ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Şirket">
          <TextInput value={form.companyId} disabled />
        </Field>

        <Field label="Kural Tipi" required>
          <Select
            value={form.target}
            onChange={(e) => patch(resetTargetSpecific(e.target.value as AuthorizationPolicyTarget))}
          >
            {POLICY_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Kime Uygulanır?" required>
          <Select
            value={form.principalType}
            onChange={(e) => handlePrincipalTypeChange(e.target.value as AuthorizationPrincipalType)}
          >
            {PRINCIPAL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Hedef"
          required
          hint="Kaydedilecek teknik değer altta gösterilir; elle ID yazmanız gerekmez."
        >
          <Select
            autoFocus
            value={form.principalKey}
            onChange={(e) => patch({ principalKey: e.target.value })}
          >
            {renderOptionsWithCurrent(principalOptions, form.principalKey)}
          </Select>
          <KeyHint value={form.principalKey} />
        </Field>

        <Field label="Etki" required>
          <Select
            value={form.effect}
            onChange={(e) => patch({ effect: e.target.value as AuthorizationPolicyEffect })}
          >
            {EFFECTS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Öncelik" hint="Yüksek değer daha baskın değerlendirilir.">
          <TextInput
            type="number"
            value={String(form.priority ?? 100)}
            onChange={(e) => patch({ priority: Number(e.target.value) || 0 })}
          />
        </Field>

        {form.target === 'menu' && (
          <>
            <Field label="Ekran / Menü" required hint="Kullanıcının sol menüde veya ana akışta göreceği ekran.">
              <Select value={form.viewKey ?? ''} onChange={(e) => handleMenuChange(e.target.value)}>
                {renderGroupedMenuOptions(form.viewKey ?? '', menuOptions)}
              </Select>
              <KeyHint value={form.viewKey ?? ''} prefix="Ekran" />
            </Field>
            <Field label="Menü Kodu" hint="Sistem tarafından otomatik doldurulur.">
              <TextInput value={form.menuKey ?? ''} disabled />
            </Field>
          </>
        )}

        {form.target === 'resource' && (
          <>
            <Field label="Kayıt / Kaynak" required hint="Hangi veri tipi üzerinde işlem yapılacak?">
              <Select
                value={form.resourceKey ?? ''}
                onChange={(e) => handleResourceChange(e.target.value)}
              >
                {renderGroupedResourceOptions(form.resourceKey ?? '', resourceOptions)}
              </Select>
              <KeyHint value={form.resourceKey ?? ''} />
            </Field>
            <Field label="İşlem" required hint="Bu kaynak için izin verilecek veya engellenecek işlem.">
              <Select value={form.action ?? ''} onChange={(e) => patch({ action: e.target.value })}>
                {renderOptionsWithCurrent(resourceActionOptions, form.action ?? '')}
              </Select>
              <KeyHint value={form.action ?? ''} />
            </Field>
          </>
        )}

        {form.target === 'field' && (
          <>
            <Field label="Ekran / Bölüm" required hint="Alan hangi form veya bölümde yönetilecek?">
              <Select value={form.scope ?? ''} onChange={(e) => handleFieldScopeChange(e.target.value)}>
                {renderOptionsWithCurrent(FIELD_SCOPE_OPTIONS, form.scope ?? '')}
              </Select>
              <KeyHint value={form.scope ?? ''} />
            </Field>
            <Field label="Alan" required hint="Zorunlu, gizli, maskeli veya düzenlenebilir yapılacak alan.">
              <Select value={form.fieldKey ?? ''} onChange={(e) => patch({ fieldKey: e.target.value })}>
                {renderOptionsWithCurrent(fieldOptions, form.fieldKey ?? '')}
              </Select>
              <KeyHint value={form.fieldKey ?? ''} />
            </Field>
            <Field label="Alan Davranışı" required hint="Bu alan kullanıcıya nasıl davranacak?">
              <Select value={form.action ?? ''} onChange={(e) => patch({ action: e.target.value })}>
                {renderOptionsWithCurrent(FIELD_ACTION_OPTIONS, form.action ?? '')}
              </Select>
              <KeyHint value={form.action ?? ''} />
            </Field>
            <Field label="Kayıt/Kaynak Anahtarı" hint="Genellikle case.">
              <TextInput value={form.resourceKey ?? ''} disabled />
            </Field>
          </>
        )}

        {form.target === 'securityFilter' && (
          <>
            <Field label="Kayıt / Kaynak" required hint="Hangi kayıtlar bu güvenlik filtresinden geçecek?">
              <Select
                value={form.resourceKey ?? ''}
                onChange={(e) => patch({ resourceKey: e.target.value })}
              >
                {renderGroupedResourceOptions(form.resourceKey ?? '', resourceOptions)}
              </Select>
              <KeyHint value={form.resourceKey ?? ''} />
            </Field>
            <Field
              label="Hazır Filtre"
              hint="Sık kullanılan kayıt erişim kurallarından birini seçin; alttaki JSON otomatik dolar."
            >
              <Select defaultValue="" onChange={(e) => applySecurityFilterPreset(e.target.value)}>
                <option value="">Şablon seç…</option>
                {SECURITY_FILTER_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </Select>
              <div className="mt-2 space-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                {SECURITY_FILTER_PRESETS.map((preset) => (
                  <div key={preset.value}>
                    <span className="font-medium text-slate-700">{preset.label}:</span> {preset.description}
                  </div>
                ))}
              </div>
            </Field>
            <Field label="Güvenlik Filtresi JSON" required className="md:col-span-2">
              <TextArea
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="min-h-[150px] font-mono text-xs"
              />
            </Field>
          </>
        )}

        <Field label="Not" className="md:col-span-2">
          <TextArea
            value={form.notes ?? ''}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Bu yetki kuralı neden var, hangi ekip veya akış için tanımlandı?"
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive ?? true}
            onChange={(e) => patch({ isActive: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Aktif
        </label>

        {error && (
          <p className="md:col-span-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function emptyPolicy(companyId: string): AuthorizationPolicyInput {
  return {
    companyId,
    target: 'menu',
    principalType: 'systemRole',
    principalKey: 'Agent',
    effect: 'allow',
    menuKey: 'main.cases',
    viewKey: 'cases',
    priority: 100,
    isActive: true,
    notes: '',
  };
}

function resetTargetSpecific(target: AuthorizationPolicyTarget): Partial<AuthorizationPolicyInput> {
  const base = {
    target,
    menuKey: null,
    viewKey: null,
    resourceKey: null,
    action: null,
    scope: null,
    fieldKey: null,
    filterJson: null,
  };
  if (target === 'menu') return { ...base, viewKey: 'cases', menuKey: 'main.cases' };
  if (target === 'resource') return { ...base, resourceKey: 'case', action: 'read' };
  if (target === 'field') {
    return { ...base, resourceKey: 'case', scope: 'case.detail', fieldKey: 'priority', action: 'editable' };
  }
  return { ...base, resourceKey: 'case', filterJson: DEFAULT_FILTER_JSON };
}

function buildPayload(
  form: AuthorizationPolicyInput,
  filterText: string,
): { value: AuthorizationPolicyInput } | { error: string } {
  const payload: AuthorizationPolicyInput = {
    ...form,
    principalKey: form.principalKey.trim(),
    menuKey: trimOrNull(form.menuKey),
    viewKey: trimOrNull(form.viewKey),
    resourceKey: trimOrNull(form.resourceKey),
    action: trimOrNull(form.action),
    scope: trimOrNull(form.scope),
    fieldKey: trimOrNull(form.fieldKey),
    notes: trimOrNull(form.notes),
    priority: Number.isFinite(form.priority) ? Number(form.priority) : 100,
    isActive: form.isActive ?? true,
  };

  if (!payload.principalKey) return { error: 'Hedef seçimi zorunlu.' };

  if (payload.target === 'securityFilter') {
    try {
      payload.filterJson = JSON.parse(filterText);
    } catch {
      return { error: 'Güvenlik filtresi geçerli JSON olmalı.' };
    }
  } else {
    payload.filterJson = null;
  }

  return { value: payload };
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function prettyJson(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function Td({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 align-top ${align === 'right' ? 'text-right' : ''} ${className}`}>
      {children}
    </td>
  );
}
