/*
 * Call Center DB katmanı — `data/embeddings.sqlite` üzerine `cc_*` tabloları
 * ekler. Mevcut tickets/embeddings/kb tablolarına dokunmaz.
 *
 * Tablolar:
 *   cc_users           — kullanıcı + rol + parola hash
 *   cc_sessions        — aktif login session'ları (iron-session cookie ile
 *                        eşleşen server-side kayıt; revocation için)
 *   cc_tickets         — ticket kayıtları (sonraki adımda)
 *   cc_ticket_events   — audit log (sonraki adımda)
 *
 * Roller: 'super_admin' | 'L1_agent' | 'L1_lead' | 'L2_agent' | 'L2_lead'
 */

import Database, { type Database as DB } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type CcRole =
  | "super_admin"
  | "L1_agent"
  | "L1_lead"
  | "L2_agent"
  | "L2_lead";

export const ALL_ROLES: CcRole[] = [
  "super_admin",
  "L1_agent",
  "L1_lead",
  "L2_agent",
  "L2_lead",
];

export function isCcRole(s: string): s is CcRole {
  return (ALL_ROLES as readonly string[]).includes(s);
}

export type CcUser = {
  id: number;
  email: string;
  name: string;
  role: CcRole;
  active: number; // 0 | 1
  created_at: string;
  created_by: number | null;
};

export type CcUserWithHash = CcUser & {
  password_hash: string;
};

function defaultDbPath(): string {
  return path.resolve(process.cwd(), "data/embeddings.sqlite");
}

let dbInstance: DB | null = null;

export function getCcDb(dbPath?: string): DB {
  if (dbInstance) return dbInstance;
  const finalPath = dbPath ?? defaultDbPath();
  mkdirSync(path.dirname(finalPath), { recursive: true });
  const db = new Database(finalPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  dbInstance = db;
  return db;
}

function initSchema(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cc_users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      email           TEXT UNIQUE NOT NULL,
      name            TEXT NOT NULL,
      role            TEXT NOT NULL,
      password_hash   TEXT NOT NULL,
      active          INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      created_by      INTEGER REFERENCES cc_users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_cc_users_role ON cc_users(role);
    CREATE INDEX IF NOT EXISTS idx_cc_users_active ON cc_users(active);

    CREATE TABLE IF NOT EXISTS cc_sessions (
      token_hash    TEXT PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES cc_users(id) ON DELETE CASCADE,
      expires_at    TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      user_agent    TEXT,
      ip            TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_cc_sessions_user ON cc_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_cc_sessions_expires ON cc_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS cc_tickets (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_no         TEXT UNIQUE NOT NULL,
      status            TEXT NOT NULL,
      channel           TEXT,
      customer_name     TEXT,
      customer_phone    TEXT,
      customer_email    TEXT,
      project           TEXT,
      description       TEXT NOT NULL,
      category_id       TEXT,
      category_sub      TEXT,
      root_cause_id     TEXT,
      root_cause_sub    TEXT,
      category_reason   TEXT,
      analysis_id       TEXT,
      ai_ran            INTEGER NOT NULL DEFAULT 0,
      ai_root_cause     TEXT,
      ai_steps          TEXT,
      ai_customer_reply TEXT,
      ai_handoff        TEXT,
      kb_citations      TEXT,
      agent_resolution  TEXT,
      opened_by         INTEGER REFERENCES cc_users(id),
      assigned_to       INTEGER REFERENCES cc_users(id),
      escalated_to_role TEXT,
      escalated_at      TEXT,
      resolved_at       TEXT,
      resolved_by       INTEGER REFERENCES cc_users(id),
      closed_at         TEXT,
      opened_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cc_tickets_status ON cc_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_cc_tickets_assigned ON cc_tickets(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_cc_tickets_opened_at ON cc_tickets(opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cc_tickets_escalated ON cc_tickets(escalated_to_role);

    CREATE TABLE IF NOT EXISTS cc_ticket_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id     INTEGER NOT NULL REFERENCES cc_tickets(id) ON DELETE CASCADE,
      actor_id      INTEGER REFERENCES cc_users(id),
      event_type    TEXT NOT NULL,
      payload_json  TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cc_events_ticket ON cc_ticket_events(ticket_id);

    CREATE TABLE IF NOT EXISTS cc_counters (
      key           TEXT PRIMARY KEY,
      value         INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Kaynak-ayrımlı analyst rehberlik alanları — sonradan eklendiği için
  // idempotent migration ile var olan tablolara da uygulanır.
  addColumnIfMissing(db, "cc_tickets", "ai_n4b_guidance", "TEXT");
  addColumnIfMissing(db, "cc_tickets", "ai_other_docs_guidance", "TEXT");

  // AI maliyet metrikleri — modele göre token tabanlı tahmini USD.
  addColumnIfMissing(db, "cc_tickets", "ai_input_tokens", "INTEGER");
  addColumnIfMissing(db, "cc_tickets", "ai_output_tokens", "INTEGER");
  addColumnIfMissing(db, "cc_tickets", "ai_cost_usd", "REAL");
  addColumnIfMissing(db, "cc_tickets", "ai_model", "TEXT");

  // Yeni iki-fazlı sınıflandırma — kategori-agaci.html taksonomisi.
  // AÇILIŞ alanları (müşteri dili, ticket açılırken doldurulur):
  addColumnIfMissing(db, "cc_tickets", "open_urun", "TEXT");
  addColumnIfMissing(db, "cc_tickets", "open_platform", "TEXT");
  addColumnIfMissing(db, "cc_tickets", "open_is_sureci", "TEXT");
  addColumnIfMissing(db, "cc_tickets", "open_islem_tipi", "TEXT");
  addColumnIfMissing(db, "cc_tickets", "open_etkilenen_nesne", "TEXT");
  addColumnIfMissing(db, "cc_tickets", "open_etki", "TEXT");
  // KAPANIŞ alanları (destek dili, ticket kapatılırken doldurulur):
  addColumnIfMissing(db, "cc_tickets", "close_kok_neden_grubu", "TEXT");
  addColumnIfMissing(db, "cc_tickets", "close_kok_neden_detayi", "TEXT");
  addColumnIfMissing(db, "cc_tickets", "close_cozum_tipi", "TEXT");
  addColumnIfMissing(db, "cc_tickets", "close_kalici_onlem", "TEXT");
}

function addColumnIfMissing(
  db: DB,
  table: string,
  column: string,
  spec: string,
): void {
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec};`);
  console.log(`[cc] migration: ${table}.${column} eklendi`);
}

// ─── Users ──────────────────────────────────────────────────────────────

function mapUser(row: Record<string, unknown>): CcUser {
  return {
    id: row.id as number,
    email: row.email as string,
    name: row.name as string,
    role: row.role as CcRole,
    active: row.active as number,
    created_at: row.created_at as string,
    created_by: (row.created_by as number) ?? null,
  };
}

export function createUser(input: {
  email: string;
  name: string;
  role: CcRole;
  password_hash: string;
  created_by?: number | null;
}): CcUser {
  const db = getCcDb();
  const stmt = db.prepare(
    `INSERT INTO cc_users (email, name, role, password_hash, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const info = stmt.run(
    input.email.toLowerCase().trim(),
    input.name.trim(),
    input.role,
    input.password_hash,
    input.created_by ?? null,
  );
  return getUserById(Number(info.lastInsertRowid)) as CcUser;
}

export function getUserById(id: number): CcUser | null {
  const db = getCcDb();
  const row = db
    .prepare(
      `SELECT id, email, name, role, active, created_at, created_by
       FROM cc_users WHERE id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapUser(row) : null;
}

export function getUserByEmail(email: string): CcUserWithHash | null {
  const db = getCcDb();
  const row = db
    .prepare(
      `SELECT id, email, name, role, password_hash, active, created_at, created_by
       FROM cc_users WHERE email = ?`,
    )
    .get(email.toLowerCase().trim()) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...mapUser(row),
    password_hash: row.password_hash as string,
  };
}

export function listUsers(opts: { activeOnly?: boolean } = {}): CcUser[] {
  const db = getCcDb();
  const where = opts.activeOnly ? "WHERE active = 1" : "";
  const rows = db
    .prepare(
      `SELECT id, email, name, role, active, created_at, created_by
       FROM cc_users ${where} ORDER BY id ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapUser);
}

export function updateUser(
  id: number,
  patch: { name?: string; role?: CcRole; active?: 0 | 1 },
): CcUser | null {
  const db = getCcDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    fields.push("name = ?");
    values.push(patch.name.trim());
  }
  if (patch.role !== undefined) {
    fields.push("role = ?");
    values.push(patch.role);
  }
  if (patch.active !== undefined) {
    fields.push("active = ?");
    values.push(patch.active);
  }
  if (fields.length === 0) return getUserById(id);
  values.push(id);
  db.prepare(`UPDATE cc_users SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
  );
  return getUserById(id);
}

export function setUserPasswordHash(id: number, password_hash: string): void {
  getCcDb()
    .prepare(`UPDATE cc_users SET password_hash = ? WHERE id = ?`)
    .run(password_hash, id);
}

export function deactivateUser(id: number): void {
  getCcDb().prepare(`UPDATE cc_users SET active = 0 WHERE id = ?`).run(id);
}

export function countSuperAdmins(): number {
  const row = getCcDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM cc_users WHERE role = 'super_admin' AND active = 1`,
    )
    .get() as { n: number };
  return row.n;
}

// ─── Sessions ───────────────────────────────────────────────────────────

export function createSession(input: {
  token_hash: string;
  user_id: number;
  expires_at: string;
  user_agent?: string | null;
  ip?: string | null;
}): void {
  getCcDb()
    .prepare(
      `INSERT INTO cc_sessions (token_hash, user_id, expires_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.token_hash,
      input.user_id,
      input.expires_at,
      input.user_agent ?? null,
      input.ip ?? null,
    );
}

export function getSession(
  token_hash: string,
): { user_id: number; expires_at: string } | null {
  const row = getCcDb()
    .prepare(
      `SELECT user_id, expires_at FROM cc_sessions WHERE token_hash = ?`,
    )
    .get(token_hash) as
    | { user_id: number; expires_at: string }
    | undefined;
  return row ?? null;
}

export function deleteSession(token_hash: string): void {
  getCcDb()
    .prepare(`DELETE FROM cc_sessions WHERE token_hash = ?`)
    .run(token_hash);
}

export function deleteSessionsForUser(user_id: number): void {
  getCcDb()
    .prepare(`DELETE FROM cc_sessions WHERE user_id = ?`)
    .run(user_id);
}

export function purgeExpiredSessions(): number {
  const r = getCcDb()
    .prepare(`DELETE FROM cc_sessions WHERE expires_at < datetime('now')`)
    .run();
  return Number(r.changes);
}

/** Test/cleanup için DB singleton'ı kapat. */
export function closeCcDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
