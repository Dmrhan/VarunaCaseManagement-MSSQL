import Database, { type Database as DB } from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

/*
 * Lokal sqlite snapshot — `data/embeddings.sqlite`.
 *
 * Neden var: VIEW_BILDIRIM_AI_ANALIZ_DATA tek-kayıt çekiminde bile
 * ~15-25s sürüyor. Analiz pipeline'ı runtime'da hızlı olmalı; bu yüzden
 * geçmiş ticket içeriklerini ve embedding'lerini yerel olarak tutuyoruz.
 *
 * İki tablo:
 *   - tickets    : view'dan alınan kanonik kayıt (artımlı sync)
 *   - embeddings : ticket başına vektör + model + içerik hash'i
 *
 * Veri akışı: scripts/sync-and-embed.ts → view'dan son N gün → upsert ticket
 *             → eksik veya text_hash değişmiş kayıtlar için embedding üret.
 */

function defaultDbPath(): string {
  // Runtime'da çözüyoruz; testler chdir ile farklı tmp dizinine geçtiğinde
  // singleton modül-level const yerine güncel cwd'yi alalım.
  return path.resolve(process.cwd(), "data/embeddings.sqlite");
}

let dbInstance: DB | null = null;

export function getDb(dbPath?: string): DB {
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
    CREATE TABLE IF NOT EXISTS tickets (
      bildirim_no       INTEGER PRIMARY KEY,
      bildirim_tarihi   TEXT,
      bildirim_tipi     TEXT,
      oncelik           TEXT,
      katman            TEXT,
      proje             TEXT,
      urun              TEXT,
      ana_kategori      TEXT,
      alt_kategori      TEXT,
      kategori_kisa     TEXT,
      kategori_uzun     TEXT,
      kok_neden         TEXT,
      acil_ticket       TEXT,
      support_seviye    TEXT,
      aciklama          TEXT,
      cozum             TEXT,
      musteri_notu      TEXT,
      tfs_no            INTEGER,
      tfs_durum         TEXT,
      tfs_tip           TEXT,
      bug_group         TEXT,
      text_hash         TEXT NOT NULL,
      synced_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_proje ON tickets(proje);
    CREATE INDEX IF NOT EXISTS idx_tickets_tarih ON tickets(bildirim_tarihi);
    CREATE INDEX IF NOT EXISTS idx_tickets_tipi ON tickets(bildirim_tipi);

    CREATE TABLE IF NOT EXISTS embeddings (
      bildirim_no  INTEGER PRIMARY KEY REFERENCES tickets(bildirim_no) ON DELETE CASCADE,
      model        TEXT NOT NULL,
      dim          INTEGER NOT NULL,
      vector       BLOB NOT NULL,
      text_hash    TEXT NOT NULL,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key          TEXT PRIMARY KEY,
      value        TEXT NOT NULL,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export type LocalTicket = {
  bildirim_no: number;
  bildirim_tarihi: string | null;
  bildirim_tipi: string | null;
  oncelik: string | null;
  katman: string | null;
  proje: string | null;
  urun: string | null;
  ana_kategori: string | null;
  alt_kategori: string | null;
  kategori_kisa: string | null;
  kategori_uzun: string | null;
  kok_neden: string | null;
  acil_ticket: string | null;
  support_seviye: string | null;
  aciklama: string | null;
  cozum: string | null;
  musteri_notu: string | null;
  tfs_no: number | null;
  tfs_durum: string | null;
  tfs_tip: string | null;
  bug_group: string | null;
  text_hash: string;
};

const TICKET_COLS = [
  "bildirim_no",
  "bildirim_tarihi",
  "bildirim_tipi",
  "oncelik",
  "katman",
  "proje",
  "urun",
  "ana_kategori",
  "alt_kategori",
  "kategori_kisa",
  "kategori_uzun",
  "kok_neden",
  "acil_ticket",
  "support_seviye",
  "aciklama",
  "cozum",
  "musteri_notu",
  "tfs_no",
  "tfs_durum",
  "tfs_tip",
  "bug_group",
  "text_hash",
] as const;

const UPSERT_TICKET_SQL = `
  INSERT INTO tickets (${TICKET_COLS.join(", ")}, synced_at)
  VALUES (${TICKET_COLS.map((c) => `@${c}`).join(", ")}, datetime('now'))
  ON CONFLICT(bildirim_no) DO UPDATE SET
    ${TICKET_COLS.filter((c) => c !== "bildirim_no")
      .map((c) => `${c} = excluded.${c}`)
      .join(",\n    ")},
    synced_at = datetime('now')
`;

/**
 * Embedding girdisi olacak kanonik metin. Aynı ticket için içerik
 * değişmediği sürece aynı kalır — `text_hash` bunun hash'idir.
 */
export function ticketEmbeddingText(t: {
  kategori_uzun: string | null;
  kok_neden: string | null;
  aciklama: string | null;
  cozum: string | null;
}): string {
  const parts = [
    t.kategori_uzun ? `KATEGORI: ${t.kategori_uzun}` : null,
    t.kok_neden ? `KOK_NEDEN: ${t.kok_neden}` : null,
    t.aciklama ? `ACIKLAMA: ${t.aciklama}` : null,
    t.cozum ? `COZUM: ${t.cozum}` : null,
  ].filter((s): s is string => s !== null);
  return parts.join("\n\n").slice(0, 6000);
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

export function upsertTickets(rows: LocalTicket[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(UPSERT_TICKET_SQL);
  const tx = db.transaction((batch: LocalTicket[]) => {
    for (const r of batch) stmt.run(r);
  });
  tx(rows);
  return rows.length;
}

export function getTicket(bildirimNo: number): LocalTicket | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM tickets WHERE bildirim_no = ?`)
    .get(bildirimNo) as LocalTicket | undefined;
  return row ?? null;
}

export function ticketCount(): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS n FROM tickets`).get() as { n: number };
  return row.n;
}

/** Embedding karşılığı eksik ya da text_hash değişmiş kayıtların id'leri. */
export function ticketsNeedingEmbedding(model: string, limit = 1000): Array<{
  bildirim_no: number;
  text: string;
  text_hash: string;
}> {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT t.bildirim_no, t.kategori_uzun, t.kok_neden, t.aciklama, t.cozum, t.text_hash
      FROM tickets t
      LEFT JOIN embeddings e
        ON e.bildirim_no = t.bildirim_no
       AND e.model = @model
      WHERE e.bildirim_no IS NULL
         OR e.text_hash <> t.text_hash
      ORDER BY t.bildirim_tarihi DESC, t.bildirim_no DESC
      LIMIT @limit
    `,
    )
    .all({ model, limit }) as Array<{
    bildirim_no: number;
    kategori_uzun: string | null;
    kok_neden: string | null;
    aciklama: string | null;
    cozum: string | null;
    text_hash: string;
  }>;
  return rows.map((r) => ({
    bildirim_no: r.bildirim_no,
    text: ticketEmbeddingText(r),
    text_hash: r.text_hash,
  }));
}

export function saveEmbeddings(
  items: Array<{ bildirim_no: number; text_hash: string; vector: number[] }>,
  model: string,
): number {
  if (items.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO embeddings (bildirim_no, model, dim, vector, text_hash, updated_at)
    VALUES (@bildirim_no, @model, @dim, @vector, @text_hash, datetime('now'))
    ON CONFLICT(bildirim_no) DO UPDATE SET
      model = excluded.model,
      dim = excluded.dim,
      vector = excluded.vector,
      text_hash = excluded.text_hash,
      updated_at = datetime('now')
  `);
  const tx = db.transaction((batch: typeof items) => {
    for (const it of batch) {
      const buf = Buffer.from(new Float32Array(it.vector).buffer);
      stmt.run({
        bildirim_no: it.bildirim_no,
        model,
        dim: it.vector.length,
        vector: buf,
        text_hash: it.text_hash,
      });
    }
  });
  tx(items);
  return items.length;
}

export type LoadedVector = {
  bildirim_no: number;
  vector: Float32Array;
};

/**
 * Tüm embedding'leri belleğe yükler. Faz 2 ölçeği için yeterli
 * (30k × 768 dim ≈ 90MB). Daha sonra ANN index'e geçebiliriz.
 */
export function loadAllVectors(model: string): LoadedVector[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT bildirim_no, vector FROM embeddings WHERE model = ?`)
    .all(model) as Array<{ bildirim_no: number; vector: Buffer }>;
  return rows.map((r) => ({
    bildirim_no: r.bildirim_no,
    vector: new Float32Array(
      r.vector.buffer,
      r.vector.byteOffset,
      r.vector.byteLength / 4,
    ),
  }));
}

export function setSyncState(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO sync_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(key, value);
}

export function getSyncState(key: string): string | null {
  const row = getDb()
    .prepare(`SELECT value FROM sync_state WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
