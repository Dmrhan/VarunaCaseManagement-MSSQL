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
  smart_ticket_solution_steps: 'Smart Ticket — Çözüm Adımları',
  performance_flow: 'Performans / Akış',
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

  // ── Smart Ticket — Çözüm Adımları (Phase 2A aggregate) ───────────
  // Bu kategori CaseSolutionStep aggregate'leri. Tek bir batch fetch'le
  // tüm caseId'ler için hesaplanır (server/lib/caseReport/aggregates.js).
  // Hiç aggregate kolon seçilmediğinde fetch ATLANIR — perf garantisi.
  { id: 'solutionSteps.total',           label: 'Çözüm Adımı Sayısı',     category: 'smart_ticket_solution_steps', type: 'number', source: 'aggregate', aggregateKey: 'solutionSteps', aggregateField: 'total' },
  { id: 'solutionSteps.suggestedCount',  label: 'Önerilen Adım Sayısı',   category: 'smart_ticket_solution_steps', type: 'number', source: 'aggregate', aggregateKey: 'solutionSteps', aggregateField: 'suggestedCount' },
  { id: 'solutionSteps.triedCount',      label: 'Denenen Adım Sayısı',    category: 'smart_ticket_solution_steps', type: 'number', source: 'aggregate', aggregateKey: 'solutionSteps', aggregateField: 'triedCount' },
  { id: 'solutionSteps.workedCount',     label: 'İşe Yarayan Adım Sayısı', category: 'smart_ticket_solution_steps', type: 'number', source: 'aggregate', aggregateKey: 'solutionSteps', aggregateField: 'workedCount' },
  { id: 'solutionSteps.notWorkedCount',  label: 'İşe Yaramayan Adım Sayısı', category: 'smart_ticket_solution_steps', type: 'number', source: 'aggregate', aggregateKey: 'solutionSteps', aggregateField: 'notWorkedCount' },
  { id: 'solutionSteps.skippedCount',    label: 'Atlanan Adım Sayısı',    category: 'smart_ticket_solution_steps', type: 'number', source: 'aggregate', aggregateKey: 'solutionSteps', aggregateField: 'skippedCount' },
  { id: 'solutionSteps.firstWorkedTitle', label: 'İlk Başarılı Çözüm Adımı', category: 'smart_ticket_solution_steps', type: 'string', source: 'aggregate', aggregateKey: 'solutionSteps', aggregateField: 'firstWorkedTitle', excelWidth: 40 },
  { id: 'solutionSteps.lastTriedTitle',   label: 'Son Denenen Çözüm Adımı',  category: 'smart_ticket_solution_steps', type: 'string', source: 'aggregate', aggregateKey: 'solutionSteps', aggregateField: 'lastTriedTitle', excelWidth: 40 },
  { id: 'solutionSteps.workedSource',     label: 'Başarılı Adım Kaynağı',    category: 'smart_ticket_solution_steps', type: 'string', source: 'aggregate', aggregateKey: 'solutionSteps', aggregateField: 'workedSource', format: 'solutionStepSource' },
  { id: 'solutionSteps.outcomeSummary',   label: 'Çözüm Adımı Özeti',       category: 'smart_ticket_solution_steps', type: 'string', source: 'aggregate', aggregateKey: 'solutionSteps', aggregateField: 'outcomeSummary', excelWidth: 50 },

  // ── Performans / Akış (Phase 2B.1 — CaseActivity + CaseNote aggregate) ──
  // CaseActivity (history) ve CaseNote satırlarının her vaka için
  // ön-aggregate edilmiş özetleri. Smart Ticket / klasik vaka ayrımı YOK.
  // Hiç aktivite/not olmayan vakalarda 0 ve '' (formatter) — rapor kırılmaz.
  { id: 'activity.firstActor',      label: 'İlk Aksiyon Yapan',     category: 'performance_flow', type: 'string',   source: 'aggregate', aggregateKey: 'caseActivity', aggregateField: 'firstActor' },
  { id: 'activity.lastActor',       label: 'Son Aksiyon Yapan',     category: 'performance_flow', type: 'string',   source: 'aggregate', aggregateKey: 'caseActivity', aggregateField: 'lastActor' },
  { id: 'activity.lastActivityAt',  label: 'Son Aktivite Zamanı',   category: 'performance_flow', type: 'datetime', source: 'aggregate', aggregateKey: 'caseActivity', aggregateField: 'lastActivityAt', format: 'datetimeTr', excelWidth: 18 },
  { id: 'activity.activityCount',   label: 'Aktivite Sayısı',       category: 'performance_flow', type: 'number',   source: 'aggregate', aggregateKey: 'caseActivity', aggregateField: 'activityCount' },
  { id: 'activity.lastStatusChange', label: 'Son Statü Değişikliği', category: 'performance_flow', type: 'string',   source: 'aggregate', aggregateKey: 'caseActivity', aggregateField: 'lastStatusChange', excelWidth: 32 },
  { id: 'note.noteCount',           label: 'Not Sayısı',            category: 'performance_flow', type: 'number',   source: 'aggregate', aggregateKey: 'caseNote', aggregateField: 'noteCount' },
  { id: 'note.lastNoteAt',          label: 'Son Not Tarihi',         category: 'performance_flow', type: 'datetime', source: 'aggregate', aggregateKey: 'caseNote', aggregateField: 'lastNoteAt', format: 'datetimeTr', excelWidth: 18 },
  { id: 'note.lastNoteAuthor',      label: 'Son Not Yazarı',         category: 'performance_flow', type: 'string',   source: 'aggregate', aggregateKey: 'caseNote', aggregateField: 'lastNoteAuthor' },
  { id: 'note.internalNoteCount',   label: 'İç Not Sayısı',         category: 'performance_flow', type: 'number',   source: 'aggregate', aggregateKey: 'caseNote', aggregateField: 'internalNoteCount' },
  { id: 'note.externalNoteCount',   label: 'Dış Not Sayısı',        category: 'performance_flow', type: 'number',   source: 'aggregate', aggregateKey: 'caseNote', aggregateField: 'externalNoteCount' },
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
 * Aggregate source'lar (Phase 2A) select'e yeni alan EKLEMEZ; ayrı bir
 * batch fetch ile çalışırlar (server/lib/caseReport/aggregates.js).
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
    // aggregate → ek select gerekmiyor
  }
  if (needsCustomFields) select.customFields = true;
  return select;
}

/**
 * Phase 2A: Seçili kolonlardan en az biri aggregate ve aggregateKey ===
 * 'solutionSteps' ise true. reports.js bu sinyalle ek bir
 * `loadSolutionStepAggregates(prisma, caseIds)` batch fetch'i tetikler.
 * Hiç aggregate kolon yoksa fetch ATLANIR (perf).
 */
export function needsSolutionStepAggregates(columns) {
  for (const col of columns) {
    if (col.source === 'aggregate' && col.aggregateKey === 'solutionSteps') return true;
  }
  return false;
}

/** Phase 2B.1: en az bir CaseActivity aggregate kolonu seçili mi? */
export function needsCaseActivityAggregates(columns) {
  for (const col of columns) {
    if (col.source === 'aggregate' && col.aggregateKey === 'caseActivity') return true;
  }
  return false;
}

/** Phase 2B.1: en az bir CaseNote aggregate kolonu seçili mi? */
export function needsCaseNoteAggregates(columns) {
  for (const col of columns) {
    if (col.source === 'aggregate' && col.aggregateKey === 'caseNote') return true;
  }
  return false;
}
