/**
 * Case Report Studio — Phase 1 column registry.
 *
 * Tek truth source: hem GET /api/reports/cases/columns endpoint'i (UI
 * column picker) hem POST /preview ve /export endpoint'leri burada
 * tanımlanan kolonları okur ve şekillendirir.
 *
 * Sözleşme:
 *   - id   : stable identifier, "ana.alt" formatı (örn. 'st.platformLabel').
 *   - label: TR kullanıcı etiketi. Excel'de header ve UI'da picker label.
 *   - category: UI'da gruplama.
 *   - type : 'string' | 'text' | 'number' | 'datetime' | 'boolean'.
 *   - source:
 *       'scalar'    → Case.<field> doğrudan select edilir (prismaField zorunlu).
 *       'json_path' → Case.customFields JSON parse + nested path okunur
 *                     (jsonPath zorunlu). Yoksa boş string döner.
 *   - prismaField: scalar source için Prisma Case alanı.
 *   - jsonPath  : json_path source için path dizisi (string[]).
 *   - privacyTag: 'public' default. 'pii' / 'sensitive' işaretli kolonlar
 *                 Phase 1'de registry'ye konmadı (KVKK guard).
 *   - excelWidth: Excel kolon genişliği (karakter), opsiyonel.
 *
 * Phase 1 kapsamı:
 *   - 27 Core Case scalar field
 *   - 5 Smart Ticket opening label
 *   - 4 Smart Ticket closure label
 *   - 1 closure suggestion confidence
 *   - 2 KB aiDrafts text (engineeringHandoff, customerReplyDraft)
 *
 * Phase 2 backlog (BURAYA EKLENMEYECEK):
 *   - Account.vkn, tcknHash, phone* (KVKK — Phase 2 ayrı role guard ile)
 *   - Case.customerContact*, customerCompanyName (privacy)
 *   - CaseActivity / CaseNote / CaseTransfer aggregate columns
 *   - CaseSolutionStep aggregate (worked count, ilk worked başlık)
 *   - Tenant FieldDefinition'dan dinamik custom field column'ları
 *
 * Yeni column eklerken: aynı (id, source, …) sözleşmesini koru. UI ve
 * route handler değişikliğe ihtiyaç duymaz — bu dosya tek kontrol noktası.
 */

export const REPORT_COLUMN_CATEGORIES = {
  core: 'Temel',
  classification: 'Sınıflandırma',
  assignment: 'Atama',
  sla: 'SLA',
  timeline: 'Zaman / Akış',
  resolution: 'Çözüm / İptal',
  smart_ticket_opening: 'Smart Ticket — Açılış',
  smart_ticket_closure: 'Smart Ticket — Kapanış',
  smart_ticket_drafts: 'Smart Ticket — KB Taslakları',
};

/** @type {ReportColumnDef[]} */
export const REPORT_COLUMNS = [
  // ── Temel ────────────────────────────────────────────────────────
  { id: 'caseNumber',     label: 'Vaka No',     category: 'core', type: 'string', source: 'scalar', prismaField: 'caseNumber', excelWidth: 16 },
  { id: 'title',          label: 'Başlık',      category: 'core', type: 'string', source: 'scalar', prismaField: 'title',      excelWidth: 50 },
  { id: 'description',    label: 'Açıklama',    category: 'core', type: 'text',   source: 'scalar', prismaField: 'description', excelWidth: 60 },
  { id: 'caseType',       label: 'Vaka Tipi',   category: 'core', type: 'string', source: 'scalar', prismaField: 'caseType', format: 'caseType' },
  { id: 'status',         label: 'Statü',       category: 'core', type: 'string', source: 'scalar', prismaField: 'status', format: 'caseStatus' },
  { id: 'priority',       label: 'Öncelik',     category: 'core', type: 'string', source: 'scalar', prismaField: 'priority', format: 'casePriority' },
  { id: 'companyName',    label: 'Şirket',      category: 'core', type: 'string', source: 'scalar', prismaField: 'companyName', excelWidth: 20 },
  { id: 'accountName',    label: 'Müşteri',     category: 'core', type: 'string', source: 'scalar', prismaField: 'accountName', excelWidth: 24 },
  { id: 'accountProjectName', label: 'Proje',   category: 'core', type: 'string', source: 'scalar', prismaField: 'accountProjectName', excelWidth: 20 },

  // ── Sınıflandırma ────────────────────────────────────────────────
  { id: 'category',     label: 'Kategori',     category: 'classification', type: 'string', source: 'scalar', prismaField: 'category' },
  { id: 'subCategory',  label: 'Alt Kategori', category: 'classification', type: 'string', source: 'scalar', prismaField: 'subCategory' },
  { id: 'requestType',  label: 'Talep Türü',   category: 'classification', type: 'string', source: 'scalar', prismaField: 'requestType' },
  { id: 'productName',  label: 'Ürün',         category: 'classification', type: 'string', source: 'scalar', prismaField: 'productName' },
  { id: 'packageName',  label: 'Paket',        category: 'classification', type: 'string', source: 'scalar', prismaField: 'packageName' },

  // ── Atama ────────────────────────────────────────────────────────
  { id: 'assignedTeamName',   label: 'Atanan Takım', category: 'assignment', type: 'string', source: 'scalar', prismaField: 'assignedTeamName' },
  { id: 'assignedPersonName', label: 'Atanan Kişi',  category: 'assignment', type: 'string', source: 'scalar', prismaField: 'assignedPersonName' },
  { id: 'supportLevel',       label: 'Destek Seviyesi', category: 'assignment', type: 'string', source: 'scalar', prismaField: 'supportLevel' },
  { id: 'escalationLevel',    label: 'Eskalasyon Seviyesi', category: 'assignment', type: 'string', source: 'scalar', prismaField: 'escalationLevel', format: 'escalationLevel' },

  // ── SLA ──────────────────────────────────────────────────────────
  { id: 'slaResponseDueAt',   label: 'SLA Yanıt Bitiş',      category: 'sla', type: 'datetime', source: 'scalar', prismaField: 'slaResponseDueAt',   format: 'datetimeTr', excelWidth: 18 },
  { id: 'slaResolutionDueAt', label: 'SLA Çözüm Bitiş',      category: 'sla', type: 'datetime', source: 'scalar', prismaField: 'slaResolutionDueAt', format: 'datetimeTr', excelWidth: 18 },
  { id: 'slaViolation',       label: 'SLA İhlal',            category: 'sla', type: 'boolean', source: 'scalar', prismaField: 'slaViolation',         format: 'boolean' },

  // ── Zaman / Akış ─────────────────────────────────────────────────
  { id: 'createdAt',     label: 'Açılış Zamanı',  category: 'timeline', type: 'datetime', source: 'scalar', prismaField: 'createdAt',  format: 'datetimeTr', excelWidth: 18 },
  { id: 'updatedAt',     label: 'Son Güncelleme', category: 'timeline', type: 'datetime', source: 'scalar', prismaField: 'updatedAt',  format: 'datetimeTr', excelWidth: 18 },
  { id: 'resolvedAt',    label: 'Çözüm Zamanı',   category: 'timeline', type: 'datetime', source: 'scalar', prismaField: 'resolvedAt', format: 'datetimeTr', excelWidth: 18 },
  { id: 'transferCount', label: 'Transfer Sayısı', category: 'timeline', type: 'number',  source: 'scalar', prismaField: 'transferCount' },

  // ── Çözüm / İptal ────────────────────────────────────────────────
  { id: 'resolutionNote',     label: 'Çözüm Açıklaması', category: 'resolution', type: 'text', source: 'scalar', prismaField: 'resolutionNote',     excelWidth: 60 },
  { id: 'cancellationReason', label: 'İptal Sebebi',     category: 'resolution', type: 'text', source: 'scalar', prismaField: 'cancellationReason', excelWidth: 60 },

  // ── Smart Ticket — Açılış ────────────────────────────────────────
  { id: 'st.platformLabel',         label: 'Platform',        category: 'smart_ticket_opening', type: 'string', source: 'json_path', jsonPath: ['smartTicket', 'platformLabel'] },
  { id: 'st.businessProcessLabel',  label: 'İş Süreci',       category: 'smart_ticket_opening', type: 'string', source: 'json_path', jsonPath: ['smartTicket', 'businessProcessLabel'] },
  { id: 'st.operationTypeLabel',    label: 'İşlem Tipi',      category: 'smart_ticket_opening', type: 'string', source: 'json_path', jsonPath: ['smartTicket', 'operationTypeLabel'] },
  { id: 'st.affectedObjectLabel',   label: 'Etkilenen Nesne', category: 'smart_ticket_opening', type: 'string', source: 'json_path', jsonPath: ['smartTicket', 'affectedObjectLabel'] },
  { id: 'st.impactLabel',           label: 'Etki',            category: 'smart_ticket_opening', type: 'string', source: 'json_path', jsonPath: ['smartTicket', 'impactLabel'] },

  // ── Smart Ticket — Kapanış ───────────────────────────────────────
  { id: 'st.closure.rootCauseGroupLabel',     label: 'Kök Neden Grubu',   category: 'smart_ticket_closure', type: 'string', source: 'json_path', jsonPath: ['smartTicket', 'closure', 'rootCauseGroupLabel'] },
  { id: 'st.closure.rootCauseDetailLabel',    label: 'Kök Neden Detayı',  category: 'smart_ticket_closure', type: 'string', source: 'json_path', jsonPath: ['smartTicket', 'closure', 'rootCauseDetailLabel'] },
  { id: 'st.closure.resolutionTypeLabel',     label: 'Çözüm Tipi',        category: 'smart_ticket_closure', type: 'string', source: 'json_path', jsonPath: ['smartTicket', 'closure', 'resolutionTypeLabel'] },
  { id: 'st.closure.permanentPreventionLabel', label: 'Kalıcı Önlem',     category: 'smart_ticket_closure', type: 'string', source: 'json_path', jsonPath: ['smartTicket', 'closure', 'permanentPreventionLabel'] },
  { id: 'st.closure.closureSuggestion.confidence', label: 'KB Güven Skoru', category: 'smart_ticket_closure', type: 'number', source: 'json_path', jsonPath: ['smartTicket', 'closure', 'closureSuggestion', 'confidence'], format: 'confidencePercent' },

  // ── Smart Ticket — KB Taslakları ─────────────────────────────────
  { id: 'st.aiDrafts.engineeringHandoff',  label: 'Teknik Devir Notu (KB)',     category: 'smart_ticket_drafts', type: 'text', source: 'json_path', jsonPath: ['smartTicket', 'aiDrafts', 'engineeringHandoff'],  excelWidth: 60 },
  { id: 'st.aiDrafts.customerReplyDraft',  label: 'Müşteri Yanıt Taslağı (KB)', category: 'smart_ticket_drafts', type: 'text', source: 'json_path', jsonPath: ['smartTicket', 'aiDrafts', 'customerReplyDraft'], excelWidth: 60 },
];

const COLUMN_BY_ID = new Map(REPORT_COLUMNS.map((c) => [c.id, c]));

export function getColumnById(id) {
  return COLUMN_BY_ID.get(id) ?? null;
}

/**
 * Verilen column id listesini doğrular. Sıralama caller'ın istediğine uyar
 * (UI'daki seçim sırası korunur).
 *
 * Phase 1.5: bilinmeyen id'ler artık SESSİZ DROP edilmiyor — caller'ın 400
 * dönmesi için ayrı bir `invalidIds` listesi de döner. Eski sessiz davranış
 * Codex review benzeri "yanlış UI ↔ backend kontrat" sızıntılarını maskeliyordu.
 *
 * @param {unknown[]} ids
 * @returns {{ columns: ReportColumnDef[], invalidIds: unknown[] }}
 */
export function resolveColumns(ids) {
  if (!Array.isArray(ids)) return { columns: [], invalidIds: [] };
  const columns = [];
  const invalidIds = [];
  for (const id of ids) {
    if (typeof id !== 'string') {
      invalidIds.push(id);
      continue;
    }
    const col = COLUMN_BY_ID.get(id);
    if (col) columns.push(col);
    else invalidIds.push(id);
  }
  return { columns, invalidIds };
}

/**
 * Verilen seçili ColumnDef[]'ten Prisma `select` objesi çıkarır. Scalar
 * column'lar doğrudan prismaField ile select'e eklenir. json_path
 * source'lu column'lar için customFields tek seferde select'e eklenir
 * (her json_path ayrı parse değil — buildRows.js'te tek parse).
 *
 * Her zaman { id, companyId } eklenir (multi-tenant guard + tablo key).
 */
export function buildPrismaSelect(columns) {
  const select = { id: true, companyId: true };
  let needsCustomFields = false;
  for (const col of columns) {
    if (col.source === 'scalar' && col.prismaField) {
      select[col.prismaField] = true;
    } else if (col.source === 'json_path') {
      needsCustomFields = true;
    }
  }
  if (needsCustomFields) select.customFields = true;
  return select;
}
