/**
 * Authorization Registry MVP-0.
 *
 * This file is intentionally static and side-effect free. It does not enforce
 * permissions yet; it defines the vocabulary that future menu visibility,
 * resource CRUD, field policy, and row-security phases will share.
 *
 * Guardrail: do not import Prisma, Express, auth middleware, or UI modules here.
 */

export const PRINCIPAL_TYPES = Object.freeze([
  'systemRole',
  'companyRole',
  'team',
  'user',
]);

export const RESOURCE_ACTIONS = Object.freeze([
  'create',
  'read',
  'update',
  'delete',
  'export',
  'approve',
  'assign',
  'transfer',
  'close',
  'archive',
  'restore',
]);

export const FIELD_ACTIONS = Object.freeze([
  'visible',
  'readable',
  'editable',
  'required',
  'masked',
]);

export const SECURITY_FILTER_OPERATORS = Object.freeze([
  'eq',
  'ne',
  'in',
  'notIn',
  'contains',
  'exists',
  'and',
  'or',
]);

export const SECURITY_FILTER_TOKENS = Object.freeze([
  '@user.id',
  '@user.personId',
  '@user.role',
  '@user.allowedCompanyIds',
  '@user.teamId',
  '@record.companyId',
  '@record.assignedPersonId',
  '@record.assignedTeamId',
  '@record.createdByUserId',
]);

export const MENU_REGISTRY = Object.freeze([
  { key: 'main.myHome', label: 'Anasayfa', viewKey: 'my-home', group: 'main', defaultRoles: ['Agent', 'Supervisor', 'Backoffice', 'CSM'] },
  { key: 'main.cases', label: 'Vakalar', viewKey: 'cases', group: 'main', defaultRoles: ['Agent', 'Backoffice', 'CSM', 'Supervisor', 'Admin', 'SystemAdmin'] },
  { key: 'main.dashboard', label: 'Vaka Raporları', viewKey: 'dashboard', group: 'main', defaultRoles: ['Agent', 'Backoffice', 'CSM', 'Supervisor', 'Admin', 'SystemAdmin'] },
  { key: 'main.accounts', label: 'Müşteriler', viewKey: 'accounts', group: 'main', defaultRoles: ['Supervisor', 'CSM', 'Admin', 'SystemAdmin'] },
  { key: 'workspace.calendar', label: 'Takvimim', viewKey: 'my-calendar', group: 'workspace', defaultRoles: ['Agent', 'Backoffice', 'CSM', 'Supervisor', 'Admin', 'SystemAdmin'] },
  { key: 'workspace.watching', label: 'İzleyici Inbox', viewKey: 'watching', group: 'workspace', defaultRoles: ['Agent', 'Backoffice', 'CSM', 'Supervisor', 'Admin', 'SystemAdmin'] },
  { key: 'workspace.knowledgeBase', label: 'Bilgi Bankası', viewKey: 'kb-viewer', group: 'workspace', defaultRoles: ['Agent', 'Backoffice', 'CSM', 'Supervisor', 'Admin', 'SystemAdmin'] },
  { key: 'reports.aiUsage', label: 'AI Kullanımı', viewKey: 'analytics-ai-usage', group: 'reports', defaultRoles: ['Supervisor', 'Admin', 'SystemAdmin'] },
  { key: 'reports.qaScores', label: 'QA Skorları', viewKey: 'analytics-qa-scores', group: 'reports', defaultRoles: ['Supervisor', 'Admin', 'SystemAdmin'] },
  { key: 'reports.patterns', label: 'Örüntü Alarmları', viewKey: 'analytics-patterns', group: 'reports', defaultRoles: ['Supervisor', 'Admin', 'SystemAdmin'] },
  { key: 'reports.caseStudio', label: 'Rapor Stüdyosu', viewKey: 'case-report-studio', group: 'reports', defaultRoles: ['Supervisor', 'Admin', 'SystemAdmin'] },
  { key: 'reports.rootCause', label: 'Kök Neden Analiz Raporu', viewKey: 'root-cause-report', group: 'reports', defaultRoles: ['Supervisor', 'Admin', 'SystemAdmin'] },
  { key: 'reports.taggingReview', label: 'Etiket Doğrulama', viewKey: 'tagging-review', group: 'reports', defaultRoles: ['Supervisor', 'Admin', 'SystemAdmin'] },
  { key: 'smartTicket.intake', label: 'Akıllı Ticket', viewKey: 'smart-ticket-new', group: 'case', defaultRoles: ['Agent', 'Backoffice', 'CSM', 'Supervisor', 'Admin', 'SystemAdmin'], featureFlag: 'smartTicketIntakeEnabled', entryPointOnly: true },
  { key: 'admin.categories', label: 'Kategori & Alt Kategori', viewKey: 'admin-categories', group: 'admin.definitions', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.sla', label: 'SLA Kuralları', viewKey: 'admin-sla', group: 'admin.definitions', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.checklist', label: 'Kontrol Listesi', viewKey: 'admin-checklist', group: 'admin.definitions', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.thirdParty', label: '3. Parti Tanımları', viewKey: 'admin-thirdparty', group: 'admin.definitions', defaultRoles: ['SystemAdmin'] },
  { key: 'admin.documents', label: 'Belge Türleri', viewKey: 'admin-documents', group: 'admin.definitions', defaultRoles: ['SystemAdmin'] },
  { key: 'admin.offeredSolutions', label: 'Teklif Tanımları', viewKey: 'admin-offered-solutions', group: 'admin.definitions', defaultRoles: ['SystemAdmin'] },
  { key: 'admin.productCatalog', label: 'Ürün Kataloğu', viewKey: 'admin-product-catalog', group: 'admin.definitions', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.teams', label: 'Takımlar & Üyeler', viewKey: 'admin-teams', group: 'admin.definitions', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.taxonomyDefs', label: 'Akıllı Ticket Tanımları', viewKey: 'admin-taxonomy-defs', group: 'admin.definitions', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.fields', label: 'Dinamik Alanlar', viewKey: 'admin-fields', group: 'admin.configuration', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.knowledgeSources', label: 'Bilgi Kaynakları', viewKey: 'admin-knowledge', group: 'admin.configuration', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.externalKb', label: 'Bilgi Bankası Entegrasyonu', viewKey: 'admin-external-kb', group: 'admin.configuration', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.externalDevOps', label: 'DevOps / TFS Entegrasyonu', viewKey: 'admin-external-devops', group: 'admin.configuration', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.dataImport', label: 'Veri Aktarım Stüdyosu', viewKey: 'admin-data-import', group: 'admin.configuration', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.resolutionApproval', label: 'Çözüm Onayı Politikaları', viewKey: 'admin-resolution-approval', group: 'admin.configuration', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.notificationTemplates', label: 'Bildirim Şablonları', viewKey: 'admin-notification-templates', group: 'admin.configuration', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.notificationRules', label: 'Bildirim Kuralları', viewKey: 'admin-notification-rules', group: 'admin.configuration', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.notificationDispatches', label: 'Bildirim Kayıtları', viewKey: 'admin-notification-dispatches', group: 'admin.configuration', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.authorizationPolicies', label: 'Yetkilendirme Yönetimi', viewKey: 'admin-authorization-policies', group: 'admin.configuration', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.companies', label: 'Şirketler', viewKey: 'admin-companies', group: 'admin.company', defaultRoles: ['Admin', 'SystemAdmin'] },
  { key: 'admin.users', label: 'Kullanıcılar', viewKey: 'admin-users', group: 'admin.company', defaultRoles: ['Admin', 'SystemAdmin'] },
]);

export const RESOURCE_REGISTRY = Object.freeze([
  { key: 'case', label: 'Vaka', category: 'case', actions: ['create', 'read', 'update', 'assign', 'transfer', 'close', 'archive', 'restore'], currentEnforcement: 'server/routes/cases.js + server/db/caseRepository.js' },
  { key: 'case.note', label: 'Vaka Notu', category: 'case', actions: ['create', 'read', 'update', 'delete'], currentEnforcement: 'server/routes/cases.js note endpoints' },
  { key: 'case.attachment', label: 'Vaka Dosyası', category: 'case', actions: ['create', 'read', 'delete'], currentEnforcement: 'server/routes/cases.js file endpoints' },
  { key: 'case.solutionStep', label: 'Çözüm Adımı', category: 'case', actions: ['create', 'read', 'update'], currentEnforcement: 'server/routes/cases.js solution-step endpoints' },
  { key: 'case.watcher', label: 'Vaka İzleyicisi', category: 'case', actions: ['create', 'read', 'delete'], currentEnforcement: 'watcherRepo + owner/elevated route checks' },
  { key: 'case.link', label: 'Vaka Bağlantısı', category: 'case', actions: ['create', 'read', 'delete'], currentEnforcement: 'linkRepo + owner/elevated route checks' },
  { key: 'account', label: 'Müşteri', category: 'customer360', actions: ['create', 'read', 'update', 'delete'], currentEnforcement: 'server/routes/accounts.js role gates + repository scope' },
  { key: 'account.contact', label: 'Müşteri Kontağı', category: 'customer360', actions: ['create', 'read', 'update', 'delete'], currentEnforcement: 'server/routes/accounts.js' },
  { key: 'account.project', label: 'Müşteri Projesi', category: 'customer360', actions: ['create', 'read', 'update', 'delete'], currentEnforcement: 'server/routes/accounts.js' },
  { key: 'report.caseStudio', label: 'Vaka Rapor Stüdyosu', category: 'reporting', actions: ['read', 'export'], currentEnforcement: 'server/routes/reports.js role + column gates' },
  { key: 'report.view', label: 'Kayıtlı Rapor Görünümü', category: 'reporting', actions: ['create', 'read', 'update', 'delete'], currentEnforcement: 'server/routes/reportViews.js owner/shared gates' },
  { key: 'admin.team', label: 'Takım', category: 'admin', actions: ['create', 'read', 'update', 'delete'], currentEnforcement: 'assertCompanyAdmin' },
  { key: 'admin.category', label: 'Kategori', category: 'admin', actions: ['create', 'read', 'update', 'delete'], currentEnforcement: 'assertCompanyAdmin / requireSystemAdminOnly' },
  { key: 'admin.slaPolicy', label: 'SLA Politikası', category: 'admin', actions: ['create', 'read', 'update', 'delete'], currentEnforcement: 'assertCompanyAdmin' },
  { key: 'admin.fieldDefinition', label: 'Dinamik Alan', category: 'admin', actions: ['create', 'read', 'update', 'delete'], currentEnforcement: 'assertCompanyAdmin' },
  { key: 'admin.taxonomyDef', label: 'Akıllı Ticket Tanımı', category: 'admin', actions: ['create', 'read', 'update', 'delete'], currentEnforcement: 'assertCompanyAdmin' },
  { key: 'admin.notificationRule', label: 'Bildirim Kuralı', category: 'admin', actions: ['create', 'read', 'update', 'delete'], currentEnforcement: 'notification admin routes' },
  { key: 'admin.user', label: 'Kullanıcı', category: 'admin', actions: ['create', 'read', 'update', 'delete'], currentEnforcement: 'server/routes/admin.js user endpoints' },
]);

export const FIELD_POLICY_SCOPES = Object.freeze([
  'case.open',
  'case.detail',
  'case.update',
  'case.close',
  'case.transfer',
  'smartTicket.stage1',
  'smartTicket.stage3Closure',
  'smartTicket.stage3Transfer',
]);

export function getAuthorizationRegistry() {
  return {
    principalTypes: PRINCIPAL_TYPES,
    resourceActions: RESOURCE_ACTIONS,
    fieldActions: FIELD_ACTIONS,
    securityFilterOperators: SECURITY_FILTER_OPERATORS,
    securityFilterTokens: SECURITY_FILTER_TOKENS,
    menus: MENU_REGISTRY,
    resources: RESOURCE_REGISTRY,
    fieldPolicyScopes: FIELD_POLICY_SCOPES,
  };
}

export function findMenuByViewKey(viewKey) {
  return MENU_REGISTRY.find((m) => m.viewKey === viewKey) ?? null;
}

export function findResource(resourceKey) {
  return RESOURCE_REGISTRY.find((r) => r.key === resourceKey) ?? null;
}
