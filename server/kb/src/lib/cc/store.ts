/*
 * CC ticket store — CRUD + ticket_no üretimi + event log.
 *
 * Ticket no formatı: CC-YYYY-NNNNNN (atomik counter, transaction'da güvenli).
 *
 * Status durumları:
 *   open         — yeni açılmış, henüz kimseye atanmamış
 *   in_progress  — bir agent üstlendi
 *   escalated    — L2 havuzuna gönderildi (assigned_to null, escalated_to_role='L2')
 *   resolved     — çözüldü ama henüz kapatılmadı (opsiyonel ara durum)
 *   closed       — kapatıldı, üzerinde değişiklik yapılamaz
 */

import { getCcDb } from "./db";

export type TicketStatus =
  | "open"
  | "in_progress"
  | "escalated"
  | "resolved"
  | "closed";

export type CcTicket = {
  id: number;
  ticket_no: string;
  status: TicketStatus;
  channel: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  project: string | null;
  description: string;
  category_id: string | null;
  category_sub: string | null;
  root_cause_id: string | null;
  root_cause_sub: string | null;
  category_reason: string | null;
  analysis_id: string | null;
  ai_ran: number;
  ai_root_cause: string | null;
  ai_steps: string | null;
  ai_customer_reply: string | null;
  ai_handoff: string | null;
  ai_n4b_guidance: string | null;
  ai_other_docs_guidance: string | null;
  ai_input_tokens: number | null;
  ai_output_tokens: number | null;
  ai_cost_usd: number | null;
  ai_model: string | null;
  // Yeni 2-fazlı taksonomi (cc-taxonomy-v2.json)
  open_urun: string | null;
  open_platform: string | null;
  open_is_sureci: string | null;
  open_islem_tipi: string | null;
  open_etkilenen_nesne: string | null;
  open_etki: string | null;
  close_kok_neden_grubu: string | null;
  close_kok_neden_detayi: string | null;
  close_cozum_tipi: string | null;
  close_kalici_onlem: string | null;
  kb_citations: string | null;
  agent_resolution: string | null;
  opened_by: number | null;
  assigned_to: number | null;
  escalated_to_role: string | null;
  escalated_at: string | null;
  resolved_at: string | null;
  resolved_by: number | null;
  closed_at: string | null;
  opened_at: string;
  updated_at: string;
};

export type CcTicketEvent = {
  id: number;
  ticket_id: number;
  actor_id: number | null;
  event_type: string;
  payload_json: string | null;
  created_at: string;
};

// ─── ticket_no üretimi ───────────────────────────────────────────────────

/**
 * CC-YYYY-NNNNNN formatında, yıl bazlı atomik counter.
 */
export function nextTicketNo(): string {
  const db = getCcDb();
  const year = new Date().getFullYear();
  const key = `ticket_seq_${year}`;
  const result = db.transaction(() => {
    db.prepare(
      `INSERT INTO cc_counters (key, value) VALUES (?, 0)
       ON CONFLICT(key) DO NOTHING`,
    ).run(key);
    db.prepare(
      `UPDATE cc_counters SET value = value + 1, updated_at = datetime('now')
       WHERE key = ?`,
    ).run(key);
    const row = db
      .prepare(`SELECT value FROM cc_counters WHERE key = ?`)
      .get(key) as { value: number };
    return row.value;
  })();
  return `CC-${year}-${String(result).padStart(6, "0")}`;
}

// ─── CRUD ────────────────────────────────────────────────────────────────

export type CreateTicketInput = {
  channel?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  project?: string | null;
  description: string;
  opened_by: number;
  // Kategorizer sonuçları (opsiyonel — hızlı kayıtta categorize sonradan yapılabilir)
  category_id?: string | null;
  category_sub?: string | null;
  root_cause_id?: string | null;
  root_cause_sub?: string | null;
  category_reason?: string | null;
  // AI sonuçları (opsiyonel — analyze edildiyse)
  analysis_id?: string | null;
  ai_root_cause?: string | null;
  ai_steps?: string | null;
  ai_customer_reply?: string | null;
  ai_handoff?: string | null;
  ai_n4b_guidance?: string | null;
  ai_other_docs_guidance?: string | null;
  ai_input_tokens?: number | null;
  ai_output_tokens?: number | null;
  ai_cost_usd?: number | null;
  ai_model?: string | null;
  // v2 sınıflandırma — açılış alanları
  open_urun?: string | null;
  open_platform?: string | null;
  open_is_sureci?: string | null;
  open_islem_tipi?: string | null;
  open_etkilenen_nesne?: string | null;
  open_etki?: string | null;
  kb_citations?: string | null;
  ai_ran?: boolean;
};

export function createTicket(input: CreateTicketInput): CcTicket {
  const db = getCcDb();
  const ticket_no = nextTicketNo();
  const stmt = db.prepare(
    `INSERT INTO cc_tickets (
       ticket_no, status, channel, customer_name, customer_phone,
       customer_email, project, description, category_id, category_sub,
       root_cause_id, root_cause_sub, category_reason, analysis_id, ai_ran,
       ai_root_cause, ai_steps, ai_customer_reply, ai_handoff,
       ai_n4b_guidance, ai_other_docs_guidance,
       ai_input_tokens, ai_output_tokens, ai_cost_usd, ai_model,
       open_urun, open_platform, open_is_sureci, open_islem_tipi, open_etkilenen_nesne, open_etki,
       kb_citations,
       opened_by
     ) VALUES (
       @ticket_no, 'open', @channel, @customer_name, @customer_phone,
       @customer_email, @project, @description, @category_id, @category_sub,
       @root_cause_id, @root_cause_sub, @category_reason, @analysis_id, @ai_ran,
       @ai_root_cause, @ai_steps, @ai_customer_reply, @ai_handoff,
       @ai_n4b_guidance, @ai_other_docs_guidance,
       @ai_input_tokens, @ai_output_tokens, @ai_cost_usd, @ai_model,
       @open_urun, @open_platform, @open_is_sureci, @open_islem_tipi, @open_etkilenen_nesne, @open_etki,
       @kb_citations,
       @opened_by
     )`,
  );
  const info = stmt.run({
    ticket_no,
    channel: input.channel ?? null,
    customer_name: input.customer_name ?? null,
    customer_phone: input.customer_phone ?? null,
    customer_email: input.customer_email ?? null,
    project: input.project ?? null,
    description: input.description,
    category_id: input.category_id ?? null,
    category_sub: input.category_sub ?? null,
    root_cause_id: input.root_cause_id ?? null,
    root_cause_sub: input.root_cause_sub ?? null,
    category_reason: input.category_reason ?? null,
    analysis_id: input.analysis_id ?? null,
    ai_ran: input.ai_ran ? 1 : 0,
    ai_root_cause: input.ai_root_cause ?? null,
    ai_steps: input.ai_steps ?? null,
    ai_customer_reply: input.ai_customer_reply ?? null,
    ai_handoff: input.ai_handoff ?? null,
    ai_n4b_guidance: input.ai_n4b_guidance ?? null,
    ai_other_docs_guidance: input.ai_other_docs_guidance ?? null,
    ai_input_tokens: input.ai_input_tokens ?? null,
    ai_output_tokens: input.ai_output_tokens ?? null,
    ai_cost_usd: input.ai_cost_usd ?? null,
    ai_model: input.ai_model ?? null,
    open_urun: input.open_urun ?? null,
    open_platform: input.open_platform ?? null,
    open_is_sureci: input.open_is_sureci ?? null,
    open_islem_tipi: input.open_islem_tipi ?? null,
    open_etkilenen_nesne: input.open_etkilenen_nesne ?? null,
    open_etki: input.open_etki ?? null,
    kb_citations: input.kb_citations ?? null,
    opened_by: input.opened_by,
  });
  const id = Number(info.lastInsertRowid);

  logEvent({
    ticket_id: id,
    actor_id: input.opened_by,
    event_type: "created",
    payload: { ticket_no, ai_ran: input.ai_ran ?? false },
  });

  return getTicketById(id) as CcTicket;
}

export function getTicketById(id: number): CcTicket | null {
  const row = getCcDb()
    .prepare(`SELECT * FROM cc_tickets WHERE id = ?`)
    .get(id) as CcTicket | undefined;
  return row ?? null;
}

export function getTicketByNo(ticket_no: string): CcTicket | null {
  const row = getCcDb()
    .prepare(`SELECT * FROM cc_tickets WHERE ticket_no = ?`)
    .get(ticket_no) as CcTicket | undefined;
  return row ?? null;
}

/** Status değişimi + opsiyonel resolution güncelleme. */
export function updateTicket(
  id: number,
  patch: {
    status?: TicketStatus;
    agent_resolution?: string | null;
    assigned_to?: number | null;
    escalated_to_role?: string | null;
    escalated_at?: string | null;
    resolved_at?: string | null;
    resolved_by?: number | null;
    closed_at?: string | null;
    category_id?: string | null;
    category_sub?: string | null;
    root_cause_id?: string | null;
    root_cause_sub?: string | null;
    ai_ran?: boolean;
    ai_root_cause?: string | null;
    ai_steps?: string | null;
    ai_customer_reply?: string | null;
    ai_handoff?: string | null;
    ai_n4b_guidance?: string | null;
    ai_other_docs_guidance?: string | null;
    ai_input_tokens?: number | null;
    ai_output_tokens?: number | null;
    ai_cost_usd?: number | null;
    ai_model?: string | null;
    // v2 sınıflandırma
    open_urun?: string | null;
    open_platform?: string | null;
    open_is_sureci?: string | null;
    open_islem_tipi?: string | null;
    open_etkilenen_nesne?: string | null;
    open_etki?: string | null;
    close_kok_neden_grubu?: string | null;
    close_kok_neden_detayi?: string | null;
    close_cozum_tipi?: string | null;
    close_kalici_onlem?: string | null;
    kb_citations?: string | null;
    analysis_id?: string | null;
  },
): CcTicket | null {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };

  const allowed: Array<[string, keyof typeof patch, "raw" | "bool"]> = [
    ["status", "status", "raw"],
    ["agent_resolution", "agent_resolution", "raw"],
    ["assigned_to", "assigned_to", "raw"],
    ["escalated_to_role", "escalated_to_role", "raw"],
    ["escalated_at", "escalated_at", "raw"],
    ["resolved_at", "resolved_at", "raw"],
    ["resolved_by", "resolved_by", "raw"],
    ["closed_at", "closed_at", "raw"],
    ["category_id", "category_id", "raw"],
    ["category_sub", "category_sub", "raw"],
    ["root_cause_id", "root_cause_id", "raw"],
    ["root_cause_sub", "root_cause_sub", "raw"],
    ["ai_ran", "ai_ran", "bool"],
    ["ai_root_cause", "ai_root_cause", "raw"],
    ["ai_steps", "ai_steps", "raw"],
    ["ai_customer_reply", "ai_customer_reply", "raw"],
    ["ai_handoff", "ai_handoff", "raw"],
    ["ai_n4b_guidance", "ai_n4b_guidance", "raw"],
    ["ai_other_docs_guidance", "ai_other_docs_guidance", "raw"],
    ["ai_input_tokens", "ai_input_tokens", "raw"],
    ["ai_output_tokens", "ai_output_tokens", "raw"],
    ["ai_cost_usd", "ai_cost_usd", "raw"],
    ["ai_model", "ai_model", "raw"],
    ["open_urun", "open_urun", "raw"],
    ["open_platform", "open_platform", "raw"],
    ["open_is_sureci", "open_is_sureci", "raw"],
    ["open_islem_tipi", "open_islem_tipi", "raw"],
    ["open_etkilenen_nesne", "open_etkilenen_nesne", "raw"],
    ["open_etki", "open_etki", "raw"],
    ["close_kok_neden_grubu", "close_kok_neden_grubu", "raw"],
    ["close_kok_neden_detayi", "close_kok_neden_detayi", "raw"],
    ["close_cozum_tipi", "close_cozum_tipi", "raw"],
    ["close_kalici_onlem", "close_kalici_onlem", "raw"],
    ["kb_citations", "kb_citations", "raw"],
    ["analysis_id", "analysis_id", "raw"],
  ];

  for (const [col, key, kind] of allowed) {
    if (patch[key] === undefined) continue;
    fields.push(`${col} = @${col}`);
    params[col] = kind === "bool" ? (patch[key] ? 1 : 0) : patch[key];
  }

  if (fields.length === 0) return getTicketById(id);
  fields.push(`updated_at = datetime('now')`);

  getCcDb()
    .prepare(`UPDATE cc_tickets SET ${fields.join(", ")} WHERE id = @id`)
    .run(params);

  return getTicketById(id);
}

// ─── Listeleme ───────────────────────────────────────────────────────────

export type ListOpts = {
  /** SQL WHERE clause parça parça — visibility.ts üretir. */
  whereSql?: string;
  whereParams?: Record<string, unknown>;
  status?: TicketStatus | TicketStatus[];
  limit?: number;
  offset?: number;
};

export function listTickets(opts: ListOpts = {}): {
  rows: CcTicket[];
  total: number;
} {
  const db = getCcDb();
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts.status) {
    const arr = Array.isArray(opts.status) ? opts.status : [opts.status];
    where.push(
      `status IN (${arr.map((_, i) => `@status_${i}`).join(",")})`,
    );
    arr.forEach((s, i) => {
      params[`status_${i}`] = s;
    });
  }
  if (opts.whereSql) where.push(`(${opts.whereSql})`);
  if (opts.whereParams) Object.assign(params, opts.whereParams);

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT * FROM cc_tickets ${whereClause}
       ORDER BY opened_at DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset }) as CcTicket[];

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM cc_tickets ${whereClause}`)
      .get(params) as { n: number }
  ).n;

  return { rows, total };
}

// ─── Eventler ────────────────────────────────────────────────────────────

export type EventType =
  | "created"
  | "ai_ran"
  | "categorized"
  | "assigned"
  | "unassigned"
  | "escalated"
  | "deescalated"
  | "resolution_updated"
  | "status_changed"
  | "resolved"
  | "closed";

export function logEvent(input: {
  ticket_id: number;
  actor_id: number | null;
  event_type: EventType | string;
  payload?: Record<string, unknown> | null;
}): void {
  getCcDb()
    .prepare(
      `INSERT INTO cc_ticket_events (ticket_id, actor_id, event_type, payload_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      input.ticket_id,
      input.actor_id ?? null,
      input.event_type,
      input.payload ? JSON.stringify(input.payload) : null,
    );
}

export function listTicketEvents(ticket_id: number): CcTicketEvent[] {
  return getCcDb()
    .prepare(
      `SELECT * FROM cc_ticket_events WHERE ticket_id = ? ORDER BY id ASC`,
    )
    .all(ticket_id) as CcTicketEvent[];
}

// ─── İş aksiyonları ──────────────────────────────────────────────────────

/** Bir agent ticket'ı üstlenir (open → in_progress). */
export function takeTicket(
  ticket_id: number,
  user_id: number,
): CcTicket | null {
  const t = getTicketById(ticket_id);
  if (!t) return null;
  if (t.status === "closed") return t;

  const updated = updateTicket(ticket_id, {
    assigned_to: user_id,
    status: t.status === "open" || t.status === "escalated"
      ? "in_progress"
      : t.status,
    escalated_to_role: null,
  });
  logEvent({
    ticket_id,
    actor_id: user_id,
    event_type: "assigned",
    payload: { assigned_to: user_id, previous_status: t.status },
  });
  return updated;
}

/** Cross-role atama (super_admin veya herkes herkese). */
export function assignTicketTo(
  ticket_id: number,
  to_user_id: number,
  actor_id: number,
): CcTicket | null {
  const t = getTicketById(ticket_id);
  if (!t) return null;
  if (t.status === "closed") return t;

  const updated = updateTicket(ticket_id, {
    assigned_to: to_user_id,
    status: "in_progress",
    escalated_to_role: null,
  });
  logEvent({
    ticket_id,
    actor_id,
    event_type: "assigned",
    payload: { assigned_to: to_user_id, by: actor_id },
  });
  return updated;
}

/** L2 havuzuna escalate et (assigned_to=null, status=escalated). */
export function escalateToL2(
  ticket_id: number,
  actor_id: number,
  note?: string,
): CcTicket | null {
  const updated = updateTicket(ticket_id, {
    status: "escalated",
    assigned_to: null,
    escalated_to_role: "L2",
    escalated_at: new Date().toISOString(),
  });
  if (updated)
    logEvent({
      ticket_id,
      actor_id,
      event_type: "escalated",
      payload: { to_role: "L2", note: note ?? null },
    });
  return updated;
}

/** L2 → L1 havuzuna geri gönder. */
export function deescalateToL1(
  ticket_id: number,
  actor_id: number,
  note?: string,
): CcTicket | null {
  const updated = updateTicket(ticket_id, {
    status: "open",
    assigned_to: null,
    escalated_to_role: null,
  });
  if (updated)
    logEvent({
      ticket_id,
      actor_id,
      event_type: "deescalated",
      payload: { to_role: "L1", note: note ?? null },
    });
  return updated;
}

/** Çöz ve kapat (tek atışta). */
export type CloseTicketInput = {
  resolution: string;
  close_kok_neden_grubu?: string | null;
  close_kok_neden_detayi?: string | null;
  close_cozum_tipi?: string | null;
  close_kalici_onlem?: string | null;
};

export function closeTicket(
  ticket_id: number,
  actor_id: number,
  input: CloseTicketInput,
): CcTicket | null {
  const now = new Date().toISOString();
  const updated = updateTicket(ticket_id, {
    status: "closed",
    agent_resolution: input.resolution,
    resolved_at: now,
    resolved_by: actor_id,
    closed_at: now,
    close_kok_neden_grubu: input.close_kok_neden_grubu ?? null,
    close_kok_neden_detayi: input.close_kok_neden_detayi ?? null,
    close_cozum_tipi: input.close_cozum_tipi ?? null,
    close_kalici_onlem: input.close_kalici_onlem ?? null,
  });
  if (updated)
    logEvent({
      ticket_id,
      actor_id,
      event_type: "closed",
      payload: {
        resolution_length: input.resolution.length,
        kok_neden_grubu: input.close_kok_neden_grubu,
        cozum_tipi: input.close_cozum_tipi,
      },
    });
  return updated;
}

/** Çözüm metnini güncelle (kapatmadan). */
export function updateResolution(
  ticket_id: number,
  actor_id: number,
  resolution: string,
): CcTicket | null {
  const updated = updateTicket(ticket_id, { agent_resolution: resolution });
  if (updated)
    logEvent({
      ticket_id,
      actor_id,
      event_type: "resolution_updated",
      payload: { length: resolution.length },
    });
  return updated;
}
