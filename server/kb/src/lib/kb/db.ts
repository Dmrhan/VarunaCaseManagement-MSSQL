/*
 * KB (Knowledge Base) DB katmanı — `data/embeddings.sqlite` üzerine
 * `kb_*` tablolarını ekler. Mevcut `tickets` / `embeddings` tablolarına
 * dokunmaz; aynı DB dosyasında yan yana yaşarlar.
 *
 * Tablolar:
 *   kb_documents   — mantıksal kaynak birimi (PDF dosyası, ekran, ticket)
 *   kb_chunks      — chunk metni + heading_path + token_count
 *   kb_embeddings  — chunk başına Gemini embedding (3072 dim, float32 BLOB)
 *   kb_chunks_fts  — FTS5 virtual table (keyword search için)
 *   kb_vec         — sqlite-vec virtual table (vector search için)
 *   kb_sync_state  — incremental sync için per-source watermark
 *
 * loadExtension üzerinden sqlite-vec dinamik olarak yüklenir; eğer
 * extension yüklenemezse vector tablosu kurulmaz ama keyword search
 * çalışmaya devam eder (graceful degradation).
 */

import Database, { type Database as DB } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

function defaultDbPath(): string {
  return path.resolve(process.cwd(), "data/embeddings.sqlite");
}

let dbInstance: DB | null = null;
let vecLoaded = false;

export function getKbDb(dbPath?: string): DB {
  if (dbInstance) return dbInstance;
  const finalPath = dbPath ?? defaultDbPath();
  mkdirSync(path.dirname(finalPath), { recursive: true });
  const db = new Database(finalPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  vecLoaded = tryLoadVec(db);
  initSchema(db);
  dbInstance = db;
  return db;
}

/**
 * Platform-spesifik sqlite-vec dylib/so yolunu manuel olarak hesapla.
 * Bu, Next.js Turbopack `import.meta.resolve` desteklemediğinde fallback.
 */
function resolveVecLoadablePathManually(): string | null {
  const platform = process.platform; // darwin | linux | win32
  const arch = process.arch; // arm64 | x64
  const ext = platform === "win32" ? "dll" : platform === "darwin" ? "dylib" : "so";
  const pkgName = `sqlite-vec-${platform === "win32" ? "windows" : platform}-${arch}`;
  const candidates = [
    path.resolve(process.cwd(), "node_modules", pkgName, `vec0.${ext}`),
    // pnpm/yarn workspaces için ek yollar gerekirse buraya eklenebilir
  ];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").accessSync(p);
      return p;
    } catch {
      // dosya yok, sonrakini dene
    }
  }
  return null;
}

function tryLoadVec(db: DB): boolean {
  // Önce standard sqlite-vec API'yi dene
  try {
    sqliteVec.load(db);
    return true;
  } catch (err) {
    const msg = (err as Error).message;
    // Turbopack import.meta.resolve hatası ise manuel path ile dene
    if (msg.includes("import.meta.resolve") || msg.includes("TURBOPACK")) {
      const manualPath = resolveVecLoadablePathManually();
      if (manualPath) {
        try {
          db.loadExtension(manualPath);
          return true;
        } catch (e2) {
          console.warn(
            "[kb] sqlite-vec manuel yükleme de başarısız:",
            (e2 as Error).message,
          );
          return false;
        }
      }
    }
    console.warn("[kb] sqlite-vec yüklenemedi, vector search devre dışı:", msg);
    return false;
  }
}

export function isVecAvailable(): boolean {
  return vecLoaded;
}

/**
 * Embedding dim — Gemini embedding-001 default 3072. Çıktı dim 768/1536/3072'den
 * biri olabiliyor (truncation/MRL); env üzerinden override edilebilir.
 */
export const KB_EMBED_DIM = Number(
  process.env.KB_EMBED_DIM ??
    process.env.LOCAL_EMBEDDING_DIM ??
    process.env.GEMINI_EMBEDDING_DIM ??
    768, // Lokal multilingual-e5-base default (env.ts ile uyumlu)
);

function initSchema(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_documents (
      doc_id         TEXT PRIMARY KEY,
      tenant_id      TEXT NOT NULL DEFAULT 'varuna',
      source_type    TEXT NOT NULL,
      source_uri     TEXT,
      title          TEXT,
      metadata_json  TEXT,
      content_hash   TEXT NOT NULL,
      chunk_count    INTEGER NOT NULL DEFAULT 0,
      token_count    INTEGER NOT NULL DEFAULT 0,
      ingested_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- tenant_id index addColumnIfMissing'den sonra oluşturulur (alt blokta)

    CREATE INDEX IF NOT EXISTS idx_kb_documents_type ON kb_documents(source_type);

    CREATE TABLE IF NOT EXISTS kb_chunks (
      chunk_id       INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id         TEXT NOT NULL REFERENCES kb_documents(doc_id) ON DELETE CASCADE,
      tenant_id      TEXT NOT NULL DEFAULT 'varuna',
      ord            INTEGER NOT NULL,
      heading_path   TEXT,
      content        TEXT NOT NULL,
      token_count    INTEGER NOT NULL,
      content_hash   TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (doc_id, ord)
    );

    CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(doc_id);
    -- tenant_id index addColumnIfMissing'den sonra oluşturulur

    CREATE TABLE IF NOT EXISTS kb_embeddings (
      chunk_id     INTEGER PRIMARY KEY REFERENCES kb_chunks(chunk_id) ON DELETE CASCADE,
      model        TEXT NOT NULL,
      dim          INTEGER NOT NULL,
      vector       BLOB NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
      content,
      heading_path,
      content='kb_chunks',
      content_rowid='chunk_id',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN
      INSERT INTO kb_chunks_fts(rowid, content, heading_path)
        VALUES (new.chunk_id, new.content, new.heading_path);
    END;
    CREATE TRIGGER IF NOT EXISTS kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN
      INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, content, heading_path)
        VALUES ('delete', old.chunk_id, old.content, old.heading_path);
    END;
    CREATE TRIGGER IF NOT EXISTS kb_chunks_au AFTER UPDATE ON kb_chunks BEGIN
      INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, content, heading_path)
        VALUES ('delete', old.chunk_id, old.content, old.heading_path);
      INSERT INTO kb_chunks_fts(rowid, content, heading_path)
        VALUES (new.chunk_id, new.content, new.heading_path);
    END;

    CREATE TABLE IF NOT EXISTS kb_sync_state (
      key          TEXT PRIMARY KEY,
      value        TEXT NOT NULL,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Idempotent migration: mevcut DB'lere tenant_id ekle (yeni kolon, default 'varuna')
  addColumnIfMissing(db, "kb_documents", "tenant_id", "TEXT NOT NULL DEFAULT 'varuna'");
  addColumnIfMissing(db, "kb_chunks", "tenant_id", "TEXT NOT NULL DEFAULT 'varuna'");
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_kb_documents_tenant ON kb_documents(tenant_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_kb_chunks_tenant ON kb_chunks(tenant_id);`);
  } catch (err) {
    console.warn("[kb] index oluşturma uyarısı:", (err as Error).message);
  }

  // sqlite-vec virtual table — sadece extension yüklendiyse
  if (vecLoaded) {
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS kb_vec USING vec0(
          chunk_id INTEGER PRIMARY KEY,
          embedding FLOAT[${KB_EMBED_DIM}]
        );
      `);
    } catch (err) {
      console.warn(
        "[kb] vec0 virtual table oluşturulamadı:",
        (err as Error).message,
      );
    }
  }
}

export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * sqlite ALTER TABLE ADD COLUMN — idempotent.
 * better-sqlite3 ile yapılan basit migration: PRAGMA table_info ile var mı bak,
 * yoksa ekle.
 */
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
  console.log(`[kb] migration: ${table}.${column} eklendi`);
}

// ─── Document API ────────────────────────────────────────────────────────

export type SourceType =
  | "pdf"
  | "panorama_screen"
  | "ticket_resolution"
  | "operator_resolution";

export type KbDocument = {
  doc_id: string;
  tenant_id: string;
  source_type: SourceType;
  source_uri: string | null;
  title: string | null;
  metadata: Record<string, unknown> | null;
  content_hash: string;
  chunk_count: number;
  token_count: number;
  ingested_at: string;
};

export type KbChunkInput = {
  ord: number;
  heading_path: string | null;
  content: string;
  token_count: number;
};

/** Default tenant — tek tenant deployment'ta kullanılır. */
export const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? "varuna";

/**
 * Atomik upsert: document + tüm chunk'ları tek transaction'da değiştir.
 * Aynı doc_id varsa eski chunk'lar silinir (CASCADE), yenileri eklenir.
 * Eski embeddings de cascade ile temizlenir; yeniden embed üretilmeli.
 */
export function upsertDocument(input: {
  doc_id: string;
  tenant_id?: string;
  source_type: SourceType;
  source_uri: string | null;
  title: string | null;
  metadata: Record<string, unknown> | null;
  content_hash: string;
  chunks: KbChunkInput[];
}): { changed: boolean; chunkIds: number[] } {
  const db = getKbDb();
  const tenantId = input.tenant_id ?? DEFAULT_TENANT;

  const existing = db
    .prepare(`SELECT content_hash FROM kb_documents WHERE doc_id = ?`)
    .get(input.doc_id) as { content_hash: string } | undefined;

  if (existing && existing.content_hash === input.content_hash) {
    // Değişmemiş — chunk_id'leri toplayıp dön
    const ids = db
      .prepare(
        `SELECT chunk_id FROM kb_chunks WHERE doc_id = ? ORDER BY ord`,
      )
      .all(input.doc_id) as Array<{ chunk_id: number }>;
    return { changed: false, chunkIds: ids.map((r) => r.chunk_id) };
  }

  const tx = db.transaction(() => {
    // Eski document varsa CASCADE temizler (FK + ON DELETE CASCADE)
    db.prepare(`DELETE FROM kb_documents WHERE doc_id = ?`).run(input.doc_id);

    const totalTokens = input.chunks.reduce((s, c) => s + c.token_count, 0);
    db.prepare(
      `INSERT INTO kb_documents
        (doc_id, tenant_id, source_type, source_uri, title, metadata_json, content_hash,
         chunk_count, token_count, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      input.doc_id,
      tenantId,
      input.source_type,
      input.source_uri,
      input.title,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.content_hash,
      input.chunks.length,
      totalTokens,
    );

    const insertChunk = db.prepare(
      `INSERT INTO kb_chunks (doc_id, tenant_id, ord, heading_path, content, token_count, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const ids: number[] = [];
    for (const c of input.chunks) {
      const info = insertChunk.run(
        input.doc_id,
        tenantId,
        c.ord,
        c.heading_path,
        c.content,
        c.token_count,
        hashContent(c.content),
      );
      ids.push(Number(info.lastInsertRowid));
    }
    return ids;
  });

  const chunkIds = tx();
  return { changed: true, chunkIds };
}

// ─── Embedding API ───────────────────────────────────────────────────────

export type KbChunkPending = {
  chunk_id: number;
  doc_id: string;
  content: string;
  content_hash: string;
  heading_path: string | null;
};

/**
 * Embedding'i eksik veya content_hash değişmiş chunk'ları listele.
 */
export function chunksNeedingEmbedding(model: string, limit = 500): KbChunkPending[] {
  const db = getKbDb();
  return db
    .prepare(
      `
      SELECT c.chunk_id, c.doc_id, c.content, c.content_hash, c.heading_path
      FROM kb_chunks c
      LEFT JOIN kb_embeddings e
        ON e.chunk_id = c.chunk_id
       AND e.model = @model
      WHERE e.chunk_id IS NULL
         OR e.content_hash <> c.content_hash
      ORDER BY c.chunk_id ASC
      LIMIT @limit
      `,
    )
    .all({ model, limit }) as KbChunkPending[];
}

export function saveChunkEmbeddings(
  items: Array<{ chunk_id: number; content_hash: string; vector: number[] }>,
  model: string,
): number {
  if (items.length === 0) return 0;
  const db = getKbDb();
  const insertEmbed = db.prepare(`
    INSERT INTO kb_embeddings (chunk_id, model, dim, vector, content_hash, updated_at)
    VALUES (@chunk_id, @model, @dim, @vector, @content_hash, datetime('now'))
    ON CONFLICT(chunk_id) DO UPDATE SET
      model = excluded.model,
      dim = excluded.dim,
      vector = excluded.vector,
      content_hash = excluded.content_hash,
      updated_at = datetime('now')
  `);

  // sqlite-vec vec0 virtual table UPSERT (ON CONFLICT DO UPDATE) desteklemiyor.
  // Yöntem: önce DELETE varsa (idempotent), sonra INSERT. Aynı transaction'da.
  const deleteVec = vecLoaded
    ? db.prepare(`DELETE FROM kb_vec WHERE chunk_id = ?`)
    : null;
  const insertVec = vecLoaded
    ? db.prepare(`INSERT INTO kb_vec(chunk_id, embedding) VALUES (?, ?)`)
    : null;

  const tx = db.transaction((batch: typeof items) => {
    for (const it of batch) {
      const buf = Buffer.from(new Float32Array(it.vector).buffer);
      insertEmbed.run({
        chunk_id: it.chunk_id,
        model,
        dim: it.vector.length,
        vector: buf,
        content_hash: it.content_hash,
      });
      if (insertVec && deleteVec) {
        // sqlite-vec vec0 virtual table chunk_id'yi BigInt olarak bekler;
        // better-sqlite3 default Number gönderiyor ve "Only integers are
        // allowed" hatasını üretiyor.
        const idBig = BigInt(it.chunk_id);
        // Idempotent: önce varolan kaydı sil (yoksa no-op), sonra ekle.
        deleteVec.run(idBig);
        insertVec.run(idBig, buf);
      }
    }
  });
  tx(items);
  return items.length;
}

// ─── Sync state ──────────────────────────────────────────────────────────

export function setSyncState(key: string, value: string): void {
  getKbDb()
    .prepare(
      `INSERT INTO kb_sync_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(key, value);
}

export function getSyncState(key: string): string | null {
  const row = getKbDb()
    .prepare(`SELECT value FROM kb_sync_state WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

// ─── Stats ───────────────────────────────────────────────────────────────

export function kbStats(): {
  documents: number;
  chunks: number;
  embeddings: number;
  byType: Record<string, number>;
  vecAvailable: boolean;
} {
  const db = getKbDb();
  const docs = (db.prepare(`SELECT COUNT(*) AS n FROM kb_documents`).get() as {
    n: number;
  }).n;
  const chunks = (db.prepare(`SELECT COUNT(*) AS n FROM kb_chunks`).get() as {
    n: number;
  }).n;
  const embeds = (db.prepare(`SELECT COUNT(*) AS n FROM kb_embeddings`).get() as {
    n: number;
  }).n;
  const byType = db
    .prepare(
      `SELECT source_type, COUNT(*) AS n FROM kb_documents GROUP BY source_type`,
    )
    .all() as Array<{ source_type: string; n: number }>;
  const map: Record<string, number> = {};
  for (const r of byType) map[r.source_type] = r.n;
  return {
    documents: docs,
    chunks,
    embeddings: embeds,
    byType: map,
    vecAvailable: vecLoaded,
  };
}

export function closeKbDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
