// OTOMATİK ÜRETİLDİ — elle düzenlemeyin. Kaynak: server/kb/src/lib (repo-içi)
// Yeniden üretmek için: node scripts/build-kb-core.mjs
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/kb/src/lib/env.ts
import { z } from "zod";
function env() {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`
    );
    throw new Error(
      `Ortam de\u011Fi\u015Fkenleri eksik/hatal\u0131:
${lines.join("\n")}
.env dosyas\u0131n\u0131 .env.example referans al\u0131p doldur.`
    );
  }
  cached = parsed.data;
  return cached;
}
var Schema, cached;
var init_env = __esm({
  "server/kb/src/lib/env.ts"() {
    "use strict";
    Schema = z.object({
      TICKET_MSSQL_SERVER: z.string().min(1),
      TICKET_MSSQL_INSTANCE: z.string().optional(),
      TICKET_MSSQL_PORT: z.coerce.number().int().positive().default(1433),
      TICKET_MSSQL_DATABASE: z.string().min(1),
      TICKET_MSSQL_USER: z.string().min(1),
      TICKET_MSSQL_PASSWORD: z.string().min(1),
      TICKET_MSSQL_ENCRYPT: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
      TICKET_MSSQL_TRUST_SERVER_CERT: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
      // LLM provider: artık Claude (generation) + OpenAI (embedding).
      // GEMINI_API_KEY geriye uyumluluk için kalıyor ama kullanılmıyor.
      GEMINI_API_KEY: z.string().optional().transform((v) => v && v.length > 0 ? v : void 0),
      GEMINI_EMBEDDING_MODEL: z.string().default("text-embedding-004"),
      GEMINI_GENERATION_MODEL: z.string().default("gemini-2.5-flash"),
      GEMINI_GENERATION_FALLBACK_MODEL: z.string().default("gemini-2.5-flash-lite"),
      // Anthropic Claude (generation)
      ANTHROPIC_API_KEY: z.string().optional().transform((v) => v && v.length > 0 ? v : void 0),
      ANTHROPIC_PRIMARY_MODEL: z.string().default("claude-sonnet-4-5"),
      ANTHROPIC_FAST_MODEL: z.string().default("claude-haiku-4-5"),
      ANTHROPIC_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
      // Lokal embedding (transformers.js)
      // multilingual-e5-base: 278M param, 768 dim, Türkçe çok iyi, CPU'da hızlı.
      // Daha kaliteli istersen multilingual-e5-large (560M, 1024 dim) — yavaş.
      LOCAL_EMBEDDING_MODEL: z.string().default("Xenova/multilingual-e5-base"),
      LOCAL_EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
      // Public API (v1) — Varuna gibi dış servislerin çağıracağı endpoint'ler için.
      // Format: "key1:tenant1,key2:tenant2"
      // Örnek:  "sk-varuna-abc123:varuna,sk-other-xyz789:other"
      API_KEYS: z.string().optional().transform((v) => {
        if (!v) return {};
        const map = {};
        for (const pair of v.split(",")) {
          const [key, tenant] = pair.trim().split(":");
          if (key && tenant) map[key.trim()] = tenant.trim();
        }
        return map;
      }),
      // CORS izinli origin'ler (virgülle ayrılmış). "*" tüm origin'lere izin verir
      // (geliştirme için; production'da özel domain listele).
      CORS_ALLOWED_ORIGINS: z.string().default("*"),
      // Rate limit: tenant başına dakikada max istek (default 60 = 1 saniyede 1)
      API_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
      TICKET_QUERY_ROW_LIMIT: z.coerce.number().int().positive().default(200),
      TICKET_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(15e3),
      TICKET_ANALYSIS_LOOKBACK_DAYS: z.coerce.number().int().positive().default(180),
      TICKET_SIMILARITY_TOPK: z.coerce.number().int().positive().default(10),
      // Auth — iron-session için cookie imzalama anahtarı. EN AZ 32 karakter.
      // Üretmek için: `openssl rand -hex 32`
      CC_SESSION_SECRET: z.string().min(32, "CC_SESSION_SECRET en az 32 karakter olmal\u0131"),
      CC_SESSION_COOKIE_NAME: z.string().default("cc_session"),
      CC_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),
      // 7 gün
      // NotebookLM (Univera iç dökümantasyonu) — opsiyonel.
      // Boş bırakılırsa NotebookLM consult özelliği devre dışıdır.
      NOTEBOOKLM_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
      // Library'e kayıtlı notebook id (örn. "univera-panorama-d-k-manlar").
      // Boşsa direkt URL kullanılır; ikisi de boşsa consult fail eder.
      NOTEBOOKLM_NOTEBOOK_ID: z.string().optional(),
      NOTEBOOKLM_NOTEBOOK_URL: z.string().optional(),
      // notebooklm-mcp paketini stdio ile spawn ederken kullanılacak komut + args.
      // Default: `npx -y notebooklm-mcp@latest`.
      NOTEBOOKLM_MCP_COMMAND: z.string().default("npx"),
      NOTEBOOKLM_MCP_ARGS: z.string().default("-y notebooklm-mcp@latest").transform(
        (v) => v.split(/\s+/).map((s) => s.trim()).filter(Boolean)
      ),
      // Tek bir ask_question çağrısı için timeout (ms). NotebookLM ~15-30s.
      NOTEBOOKLM_TIMEOUT_MS: z.coerce.number().int().positive().default(6e4),
      // runAnalysis pipeline'ında her ticket için otomatik consult yapılsın mı?
      // Default kapalı — UI'dan opt-in. Açılırsa her analiz 25-40s daha sürer.
      NOTEBOOKLM_AUTO_CONSULT: z.enum(["true", "false"]).default("false").transform((v) => v === "true")
    });
    cached = null;
  }
});

// server/kb/src/lib/gemini.ts
var gemini_exports = {};
__export(gemini_exports, {
  embed: () => embed,
  embedBatch: () => embedBatch,
  estimateCostUsd: () => estimateCostUsd,
  generate: () => generate,
  isTransientGeminiError: () => isTransientGeminiError
});
import Anthropic from "@anthropic-ai/sdk";
function getAnthropic() {
  if (anthropicClient) return anthropicClient;
  const apiKey = env().ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY eksik (.env dosyas\u0131na ekle).");
  }
  anthropicClient = new Anthropic({
    apiKey,
    maxRetries: env().ANTHROPIC_MAX_RETRIES
  });
  return anthropicClient;
}
function getEmbedder() {
  if (embedderPromise) return embedderPromise;
  embedderPromise = (async () => {
    const mod = await import("@xenova/transformers");
    if (mod.env) {
      mod.env.allowLocalModels = true;
    }
    const modelName = env().LOCAL_EMBEDDING_MODEL;
    const pipe = await mod.pipeline("feature-extraction", modelName, {
      quantized: true
    });
    return pipe;
  })();
  return embedderPromise;
}
function isE5Model() {
  return /e5/i.test(env().LOCAL_EMBEDDING_MODEL);
}
function prefixForQuery(text) {
  return isE5Model() ? `query: ${text}` : text;
}
function prefixForPassage(text) {
  return isE5Model() ? `passage: ${text}` : text;
}
function toArray(d) {
  if (Array.isArray(d)) return d;
  return Array.from(d);
}
async function embed(text) {
  const dim = DIM();
  const trimmed = text.trim();
  if (!trimmed) return new Array(dim).fill(0);
  const embedder = await getEmbedder();
  const result = await embedder(prefixForQuery(trimmed.slice(0, 4e3)), {
    pooling: "mean",
    normalize: true
  });
  return toArray(result.data).slice(0, dim);
}
async function embedBatch(texts) {
  if (texts.length === 0) return [];
  const dim = DIM();
  const embedder = await getEmbedder();
  const placeholders = [];
  const inputs = [];
  texts.forEach((t, i) => {
    const trimmed = t.trim();
    if (!trimmed) placeholders.push(i);
    inputs.push(prefixForPassage((trimmed || ".").slice(0, 4e3)));
  });
  const result = await embedder(inputs, {
    pooling: "mean",
    normalize: true
  });
  const flat = result.data;
  const hidden = result.dims[result.dims.length - 1] ?? dim;
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    if (placeholders.includes(i)) {
      out.push(new Array(dim).fill(0));
      continue;
    }
    const start = i * hidden;
    const slice = flat instanceof Float32Array ? Array.from(flat.subarray(start, start + hidden)) : flat.slice(start, start + hidden);
    out.push(slice.slice(0, dim));
  }
  return out;
}
function isTransientGeminiError(err) {
  const e = err;
  if (!e) return false;
  if (e.status === 429 || e.status === 503 || e.status === 502 || e.status === 504) {
    return true;
  }
  const msg = e.message ?? "";
  return /\b(503|429|502|504)\b|rate.?limit|overloaded|timeout|fetch failed|ECONNRESET|EAI_AGAIN|socket hang up/i.test(
    msg
  );
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function* claudeAttempts(tier) {
  const e = env();
  if (tier === "fast") {
    yield { model: e.ANTHROPIC_FAST_MODEL, delayMs: 0, label: "fast-primary" };
    yield { model: e.ANTHROPIC_FAST_MODEL, delayMs: 1500, label: "fast-retry" };
    yield {
      model: e.ANTHROPIC_PRIMARY_MODEL,
      delayMs: 3e3,
      label: "fast-fallback-to-primary"
    };
    return;
  }
  yield { model: e.ANTHROPIC_PRIMARY_MODEL, delayMs: 0, label: "primary" };
  yield {
    model: e.ANTHROPIC_PRIMARY_MODEL,
    delayMs: 1500,
    label: "primary-retry"
  };
  yield {
    model: e.ANTHROPIC_FAST_MODEL,
    delayMs: 3e3,
    label: "primary-fallback-to-fast"
  };
}
function estimateCostUsd(model, inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0) {
  let p = CLAUDE_PRICING[model];
  if (!p) {
    console.warn(`[gemini] bilinmeyen model fiyat\u0131: ${model} \u2192 Sonnet rate kullan\u0131l\u0131yor`);
    p = { inputPerMTok: 3, outputPerMTok: 15 };
  }
  return (inputTokens * p.inputPerMTok + cacheReadTokens * p.inputPerMTok * 0.1 + cacheWriteTokens * p.inputPerMTok * 1.25 + outputTokens * p.outputPerMTok) / 1e6;
}
async function generate(systemInstruction, userPrompt, options = {}) {
  const tier = options.tier ?? "primary";
  const effectiveSystem = options.responseMimeType === "application/json" ? `${systemInstruction}

\xD6NEML\u0130 \xC7IKI\u015E FORMATI: Yan\u0131t SADECE ge\xE7erli bir JSON nesnesi olmal\u0131. A\xE7\u0131klama, kod blo\u011Fu (\xFC\xE7 t\u0131rnak), \xF6n/son metin EKLEME. Direkt { ile ba\u015Flat, } ile bitir.` : systemInstruction;
  let lastErr = null;
  for await (const { model, delayMs } of claudeAttempts(tier)) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      const start = Date.now();
      const userContent = options.cachePrefix ? [
        {
          type: "text",
          text: options.cachePrefix,
          cache_control: { type: "ephemeral" }
        },
        { type: "text", text: userPrompt }
      ] : userPrompt;
      const resp = await getAnthropic().messages.create({
        model,
        max_tokens: options.maxOutputTokens ?? 2048,
        temperature: options.temperature ?? 0.2,
        system: effectiveSystem,
        messages: [{ role: "user", content: userContent }]
      });
      const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const inputTokens = resp.usage?.input_tokens ?? 0;
      const outputTokens = resp.usage?.output_tokens ?? 0;
      const cacheReadTokens = resp.usage?.cache_read_input_tokens ?? 0;
      const cacheWriteTokens = resp.usage?.cache_creation_input_tokens ?? 0;
      return {
        text,
        modelUsed: model,
        latencyMs: Date.now() - start,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        costUsd: estimateCostUsd(
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens
        )
      };
    } catch (err) {
      lastErr = err;
      if (!isTransientGeminiError(err)) throw err;
    }
  }
  throw lastErr ?? new Error("Claude generate ba\u015Far\u0131s\u0131z (bilinmeyen).");
}
var anthropicClient, embedderPromise, DIM, CLAUDE_PRICING;
var init_gemini = __esm({
  "server/kb/src/lib/gemini.ts"() {
    "use strict";
    init_env();
    anthropicClient = null;
    embedderPromise = null;
    DIM = () => env().LOCAL_EMBEDDING_DIM;
    CLAUDE_PRICING = {
      // Sonnet 4.x ailesi
      "claude-sonnet-4-5": { inputPerMTok: 3, outputPerMTok: 15 },
      "claude-sonnet-4-5-20251022": { inputPerMTok: 3, outputPerMTok: 15 },
      "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
      "claude-sonnet-4-7": { inputPerMTok: 3, outputPerMTok: 15 },
      // Haiku 4.x ailesi (fast tier)
      "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
      "claude-haiku-4-5-20251022": { inputPerMTok: 1, outputPerMTok: 5 },
      // Opus 4.x ailesi
      "claude-opus-4-5": { inputPerMTok: 15, outputPerMTok: 75 }
    };
  }
});

// server/kb/src/lib/kb/ask.ts
init_gemini();
import { z as z2 } from "zod";

// server/kb/src/lib/kb/db.ts
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import path from "node:path";
function defaultDbPath() {
  return path.resolve(process.cwd(), "data/embeddings.sqlite");
}
var dbInstance = null;
var vecLoaded = false;
function getKbDb(dbPath) {
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
function resolveVecLoadablePathManually() {
  const platform = process.platform;
  const arch = process.arch;
  const ext = platform === "win32" ? "dll" : platform === "darwin" ? "dylib" : "so";
  const pkgName = `sqlite-vec-${platform === "win32" ? "windows" : platform}-${arch}`;
  const candidates = [
    path.resolve(process.cwd(), "node_modules", pkgName, `vec0.${ext}`)
    // pnpm/yarn workspaces için ek yollar gerekirse buraya eklenebilir
  ];
  for (const p of candidates) {
    try {
      __require("node:fs").accessSync(p);
      return p;
    } catch {
    }
  }
  return null;
}
function tryLoadVec(db) {
  try {
    sqliteVec.load(db);
    return true;
  } catch (err) {
    const msg = err.message;
    if (msg.includes("import.meta.resolve") || msg.includes("TURBOPACK")) {
      const manualPath = resolveVecLoadablePathManually();
      if (manualPath) {
        try {
          db.loadExtension(manualPath);
          return true;
        } catch (e2) {
          console.warn(
            "[kb] sqlite-vec manuel y\xFCkleme de ba\u015Far\u0131s\u0131z:",
            e2.message
          );
          return false;
        }
      }
    }
    console.warn("[kb] sqlite-vec y\xFCklenemedi, vector search devre d\u0131\u015F\u0131:", msg);
    return false;
  }
}
function isVecAvailable() {
  return vecLoaded;
}
var KB_EMBED_DIM = Number(
  process.env.KB_EMBED_DIM ?? process.env.LOCAL_EMBEDDING_DIM ?? process.env.GEMINI_EMBEDDING_DIM ?? 768
  // Lokal multilingual-e5-base default (env.ts ile uyumlu)
);
function initSchema(db) {
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
    -- tenant_id index addColumnIfMissing'den sonra olu\u015Fturulur (alt blokta)

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
    -- tenant_id index addColumnIfMissing'den sonra olu\u015Fturulur

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
  addColumnIfMissing(db, "kb_documents", "tenant_id", "TEXT NOT NULL DEFAULT 'varuna'");
  addColumnIfMissing(db, "kb_chunks", "tenant_id", "TEXT NOT NULL DEFAULT 'varuna'");
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_kb_documents_tenant ON kb_documents(tenant_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_kb_chunks_tenant ON kb_chunks(tenant_id);`);
  } catch (err) {
    console.warn("[kb] index olu\u015Fturma uyar\u0131s\u0131:", err.message);
  }
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
        "[kb] vec0 virtual table olu\u015Fturulamad\u0131:",
        err.message
      );
    }
  }
}
function addColumnIfMissing(db, table, column, spec) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec};`);
  console.log(`[kb] migration: ${table}.${column} eklendi`);
}
var DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? "varuna";
function chunksNeedingEmbedding(model, limit = 500) {
  const db = getKbDb();
  return db.prepare(
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
      `
  ).all({ model, limit });
}
function saveChunkEmbeddings(items, model) {
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
  const deleteVec = vecLoaded ? db.prepare(`DELETE FROM kb_vec WHERE chunk_id = ?`) : null;
  const insertVec = vecLoaded ? db.prepare(`INSERT INTO kb_vec(chunk_id, embedding) VALUES (?, ?)`) : null;
  const tx = db.transaction((batch) => {
    for (const it of batch) {
      const buf = Buffer.from(new Float32Array(it.vector).buffer);
      insertEmbed.run({
        chunk_id: it.chunk_id,
        model,
        dim: it.vector.length,
        vector: buf,
        content_hash: it.content_hash
      });
      if (insertVec && deleteVec) {
        const idBig = BigInt(it.chunk_id);
        deleteVec.run(idBig);
        insertVec.run(idBig, buf);
      }
    }
  });
  tx(items);
  return items.length;
}
function kbStats() {
  const db = getKbDb();
  const docs = db.prepare(`SELECT COUNT(*) AS n FROM kb_documents`).get().n;
  const chunks = db.prepare(`SELECT COUNT(*) AS n FROM kb_chunks`).get().n;
  const embeds = db.prepare(`SELECT COUNT(*) AS n FROM kb_embeddings`).get().n;
  const byType = db.prepare(
    `SELECT source_type, COUNT(*) AS n FROM kb_documents GROUP BY source_type`
  ).all();
  const map = {};
  for (const r of byType) map[r.source_type] = r.n;
  return {
    documents: docs,
    chunks,
    embeddings: embeds,
    byType: map,
    vecAvailable: vecLoaded
  };
}

// server/kb/src/lib/kb/embedder.ts
init_gemini();
init_env();
async function embedPendingChunks(opts = {}) {
  const model = env().GEMINI_EMBEDDING_MODEL;
  const batchSize = opts.batchSize ?? 16;
  const maxChunks = opts.maxChunks ?? 5e3;
  const startedAt = Date.now();
  let totalEmbedded = 0;
  let totalSkipped = 0;
  const isRetryable = (err) => {
    if (isTransientGeminiError(err)) return true;
    const m = String(err?.message ?? "");
    return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|aborted/i.test(
      m
    );
  };
  const embedWithRetry = async (texts) => {
    const delays = [0, 2e3, 5e3, 15e3];
    let lastErr = null;
    for (const delay of delays) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      try {
        return await embedBatch(texts);
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err)) throw err;
        const msg = err.message.slice(0, 100);
        console.warn(`[kb/embed] batch retry (delay ${delay}ms): ${msg}`);
      }
    }
    throw lastErr;
  };
  let consecutiveBatchFails = 0;
  for (; ; ) {
    const remaining = maxChunks - totalEmbedded;
    if (remaining <= 0) break;
    const pending = chunksNeedingEmbedding(
      model,
      Math.min(batchSize, remaining)
    );
    if (pending.length === 0) break;
    let vectors;
    try {
      vectors = await embedWithRetry(pending.map((c) => c.content));
      consecutiveBatchFails = 0;
    } catch (err) {
      consecutiveBatchFails++;
      console.warn(
        `[kb/embed] batch tamamen fail (${consecutiveBatchFails}. ard\u0131\u015F\u0131k): ${err.message.slice(0, 150)}`
      );
      if (consecutiveBatchFails >= 5) {
        throw new Error(
          `[kb/embed] 5 ard\u0131\u015F\u0131k batch hatas\u0131 \u2014 durduruluyor. Sonra tekrar ba\u015Flatabilirsiniz (resumable). Son hata: ${err.message}`
        );
      }
      console.warn(`[kb/embed] 30s bekleyip tekrar denenecek...`);
      await new Promise((r) => setTimeout(r, 3e4));
      continue;
    }
    const items = pending.map((c, i) => {
      const vec = vectors[i];
      if (!vec || vec.length === 0) {
        totalSkipped++;
        return null;
      }
      return {
        chunk_id: c.chunk_id,
        content_hash: c.content_hash,
        vector: vec
      };
    }).filter((x) => x !== null);
    const written = saveChunkEmbeddings(items, model);
    totalEmbedded += written;
    if (opts.onProgress) {
      opts.onProgress({ done: totalEmbedded, total: maxChunks });
    }
  }
  return {
    embedded: totalEmbedded,
    skipped: totalSkipped,
    durationMs: Date.now() - startedAt
  };
}
async function embedQuery(text) {
  const { embed: embed2 } = await Promise.resolve().then(() => (init_gemini(), gemini_exports));
  return embed2(text);
}

// server/kb/src/lib/kb/retrieve.ts
init_env();
init_gemini();
var DEFAULTS = {
  topK: 8,
  rawK: 50,
  // fusedK = LLM rerank'e giren aday sayısı. Rerank prompt'u her adayın
  // ~600 karakterini içerir → bu sayı doğrudan rerank input maliyetidir.
  // 20 → 12: topK (6-8) zaten daha düşük; 12 aday rerank kalitesini korur,
  // rerank input'unu ~%40 azaltır (analyze başına 2 rerank çağrısı var).
  fusedK: 12,
  rrfK: 60
};
function buildFtsQuery(text) {
  const tokens = text.toLowerCase().normalize("NFKC").replace(/["()*]/g, " ").split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}
function ftsSearch(query, limit, sourceTypes, tenantId) {
  const db = getKbDb();
  const q = buildFtsQuery(query);
  if (!q) return [];
  try {
    const params = {
      q,
      limit,
      tenant: tenantId ?? DEFAULT_TENANT
    };
    let filterClause = "";
    if (sourceTypes && sourceTypes.length > 0) {
      const placeholders = sourceTypes.map((_, i) => `@type${i}`).join(", ");
      filterClause = `AND d.source_type IN (${placeholders})`;
      sourceTypes.forEach((t, i) => {
        params[`type${i}`] = t;
      });
    }
    const rows = db.prepare(
      `
        SELECT c.chunk_id, bm25(kb_chunks_fts) AS score
        FROM kb_chunks_fts
        JOIN kb_chunks c ON c.chunk_id = kb_chunks_fts.rowid
        JOIN kb_documents d ON d.doc_id = c.doc_id
        WHERE kb_chunks_fts MATCH @q
          AND c.tenant_id = @tenant
          ${filterClause}
        ORDER BY score ASC
        LIMIT @limit
        `
    ).all(params);
    return rows.map((r, i) => ({ chunk_id: r.chunk_id, rank: i + 1 }));
  } catch (err) {
    console.warn("[kb/retrieve] FTS arama hatas\u0131:", err.message);
    return [];
  }
}
function vecSearch(queryVec, limit, sourceTypes, tenantId) {
  if (!isVecAvailable()) return [];
  const db = getKbDb();
  try {
    const buf = Buffer.from(new Float32Array(queryVec).buffer);
    const params = {
      v: buf,
      limit,
      tenant: tenantId ?? DEFAULT_TENANT
    };
    let filterClause = "";
    if (sourceTypes && sourceTypes.length > 0) {
      const placeholders = sourceTypes.map((_, i) => `@type${i}`).join(", ");
      filterClause = `AND d.source_type IN (${placeholders})`;
      sourceTypes.forEach((t, i) => {
        params[`type${i}`] = t;
      });
    }
    const rows = db.prepare(
      `
        SELECT v.chunk_id, v.distance
        FROM kb_vec v
        JOIN kb_chunks c ON c.chunk_id = v.chunk_id
        JOIN kb_documents d ON d.doc_id = c.doc_id
        WHERE v.embedding MATCH @v
          AND k = @limit
          AND c.tenant_id = @tenant
          ${filterClause}
        ORDER BY v.distance
        `
    ).all(params);
    return rows.map((r, i) => ({
      chunk_id: r.chunk_id,
      distance: r.distance,
      rank: i + 1
    }));
  } catch (err) {
    console.warn("[kb/retrieve] vec arama hatas\u0131:", err.message);
    return [];
  }
}
function rrf(lists, k) {
  const fused = /* @__PURE__ */ new Map();
  for (const list of lists) {
    for (const hit of list) {
      const prev = fused.get(hit.chunk_id) ?? 0;
      fused.set(hit.chunk_id, prev + 1 / (k + hit.rank));
    }
  }
  return fused;
}
function fetchChunksByIds(ids) {
  if (ids.length === 0) return /* @__PURE__ */ new Map();
  const db = getKbDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(
    `
      SELECT c.chunk_id, c.doc_id, c.heading_path, c.content,
             d.source_type, d.title, d.metadata_json
      FROM kb_chunks c
      JOIN kb_documents d ON d.doc_id = c.doc_id
      WHERE c.chunk_id IN (${placeholders})
      `
  ).all(...ids);
  const map = /* @__PURE__ */ new Map();
  for (const r of rows) {
    map.set(r.chunk_id, {
      chunk_id: r.chunk_id,
      doc_id: r.doc_id,
      source_type: r.source_type,
      title: r.title,
      heading_path: r.heading_path,
      content: r.content,
      metadata: r.metadata_json ? safeJsonParse(r.metadata_json) : null,
      bm25Score: null,
      vecScore: null,
      rrfScore: 0,
      rerankScore: null
    });
  }
  return map;
}
function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
async function retrieve(query, opts = {}) {
  if (opts.priorityTypes && opts.priorityTypes.length > 0) {
    const priorityHits = await retrieveCore(query, {
      ...opts,
      sourceTypes: opts.priorityTypes,
      priorityTypes: void 0
      // recursion'ı kır
    });
    if (priorityTierSufficient(priorityHits, opts)) {
      return priorityHits;
    }
  }
  return retrieveCore(query, opts);
}
function priorityTierSufficient(hits, opts) {
  const minResults = opts.priorityMinResults ?? 2;
  if (hits.length < minResults) return false;
  if (opts.rerank) {
    const rerankApplied = hits.some((h) => h.rerankScore !== null);
    if (rerankApplied) {
      const minScore = opts.priorityMinRerankScore ?? 5;
      return hits.some((h) => (h.rerankScore ?? 0) >= minScore);
    }
  }
  return true;
}
async function retrieveCore(query, opts = {}) {
  const topK = opts.topK ?? DEFAULTS.topK;
  const rawK = opts.rawK ?? DEFAULTS.rawK;
  const fusedK = opts.fusedK ?? DEFAULTS.fusedK;
  const rrfK = opts.rrfK ?? DEFAULTS.rrfK;
  const tenantId = opts.tenantId ?? DEFAULT_TENANT;
  const [vec, fts] = await Promise.all([
    (async () => {
      try {
        const vec2 = await embedQuery(query);
        return vecSearch(vec2, rawK, opts.sourceTypes, tenantId);
      } catch (err) {
        console.warn("[kb/retrieve] embed query hatas\u0131:", err.message);
        return [];
      }
    })(),
    Promise.resolve(ftsSearch(query, rawK, opts.sourceTypes, tenantId))
  ]);
  const fused = rrf(
    [
      vec.map((h) => ({ chunk_id: h.chunk_id, rank: h.rank })),
      fts.map((h) => ({ chunk_id: h.chunk_id, rank: h.rank }))
    ],
    rrfK
  );
  const top = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, fusedK);
  if (top.length === 0) return [];
  const chunks = fetchChunksByIds(top.map(([id]) => id));
  const vecMap = new Map(vec.map((h) => [h.chunk_id, h.distance]));
  const ftsRanks = new Map(fts.map((h) => [h.chunk_id, h.rank]));
  const result = top.map(([id, score]) => {
    const c = chunks.get(id);
    if (!c) return null;
    c.rrfScore = score;
    c.vecScore = vecMap.get(id) ?? null;
    const ftsRank = ftsRanks.get(id);
    c.bm25Score = ftsRank ? 1 / ftsRank : null;
    return c;
  }).filter((x) => x !== null);
  let final = result;
  if (opts.rerank && result.length > topK) {
    try {
      final = await geminiRerank(query, result, topK);
    } catch (err) {
      console.warn("[kb/retrieve] rerank hatas\u0131:", err.message);
      final = result.slice(0, topK);
    }
  } else {
    final = result.slice(0, topK);
  }
  return final;
}
async function geminiRerank(query, chunks, topK) {
  const _ = env();
  void _;
  const system = "Sen bir Retrieval reranker's\u0131n. Verilen soruya HER bir par\xE7an\u0131n do\u011Frudan ne kadar cevap verdi\u011Fini 0-10 aras\u0131 puanla. Anlamca yak\u0131n ama soruya cevap vermeyenlere d\xFC\u015F\xFCk puan ver. Sadece JSON array d\xF6nd\xFCr.";
  const list = chunks.map(
    (c, i) => `[${i}] (${c.source_type}) ${c.title ?? c.heading_path ?? ""}
${c.content.slice(0, 600)}`
  ).join("\n\n---\n\n");
  const userPrompt = [
    `SORU: ${query}`,
    "",
    "PAR\xC7ALAR:",
    list,
    "",
    `Yan\u0131t format\u0131: [{"i":<index>,"score":<0-10>},...]  (sadece JSON, a\xE7\u0131klama yok)`
  ].join("\n");
  const res = await generate(system, userPrompt, {
    temperature: 0,
    maxOutputTokens: 1024,
    responseMimeType: "application/json",
    tier: "fast"
    // rerank basit task, Haiku yeterli
  });
  let parsed = [];
  try {
    parsed = JSON.parse(res.text);
  } catch {
    return chunks.slice(0, topK);
  }
  const scoreByIdx = /* @__PURE__ */ new Map();
  for (const p of parsed) scoreByIdx.set(p.i, p.score);
  return [...chunks].map((c, i) => {
    c.rerankScore = scoreByIdx.get(i) ?? 0;
    return c;
  }).sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0)).slice(0, topK);
}

// server/kb/src/lib/kb/ask.ts
var MIN_RRF_SCORE = 5e-3;
var MIN_HIGH_CONFIDENCE_CHUNKS = 1;
var AskOutputSchema = z2.object({
  answer: z2.string(),
  citations: z2.array(z2.number().int().min(1)).default([]),
  refused: z2.boolean().default(false),
  reason: z2.string().nullable().optional()
});
var SYSTEM = `
Sen Univera Panorama destek bilgi bankas\u0131na bakan k\u0131demli bir destek analistsin.

KURALLAR (mutlak):
- SADECE a\u015Fa\u011F\u0131daki <KAYNAKLAR> b\xF6l\xFCm\xFCnde verilen al\u0131nt\u0131lara dayanarak cevap ver.
- Kaynaklardaki bilgi yoksa veya yetersizse, "refused": true, "answer": "" ve "reason" alan\u0131nda neden oldu\u011Funu a\xE7\u0131kla.
- Yan\u0131ttaki teknik iddialar\u0131n yan\u0131na kaynak numaras\u0131n\u0131 k\xF6\u015Feli parantezde ekle: [1], [2]. Birden fazla kaynak destekliyorsa: [1][3] gibi.
- Kaynak DI\u015EI bilgi (genel k\xFClt\xFCr, ba\u015Fka \xFCr\xFCn, tahmin) KULLANMA. Uydurma.

CEVAP ST\u0130L\u0130 \u2014 DETAYLI ve \u0130\u015ELEMSEL ol:
- Sorulan konunun T\xDCM ilgili ad\u0131mlar\u0131n\u0131 ve detaylar\u0131n\u0131 ver. Generic \xF6zet yapma.
- **Men\xFC ad\u0131mlar\u0131n\u0131 TAM yaz**: "Sat\u0131\u015F Ekibi \u2192 Tan\u0131mlamalar \u2192 Sat\u0131\u015F Temsilcisi" gibi.
- **Buton/sekme adlar\u0131n\u0131 AYNEN kullan**: kaynakta "Rut Bilgileri" yaz\u0131yorsa \xF6yle yaz, "Rut sekmesi" diye genelleme yapma.
- **Alan adlar\u0131n\u0131 (saha adlar\u0131n\u0131) ekle**: hangi alanlar doldurulacak \u2014 Rut Kodu, Ba\u015Flang\u0131\xE7 Tarihi, Frekans vb.
- **Ko\u015Fullu davran\u0131\u015Flar\u0131 A\xC7IKLA**: parametre veya yetki etkili oluyorsa belirt (\xF6rn. "Merkez Onayl\u0131 Rut \u0130\u015Flemleri Kullan\u0131ls\u0131n M\u0131? parametresi aktifse y\xF6neticinin i\u015F ak\u0131\u015F onay\u0131na d\xFC\u015Fer").
- **Ad\u0131mlar\u0131 numaraland\u0131r\u0131lm\u0131\u015F liste yap** (1, 2, 3...).
- **Markdown KULLAN**: bold (**...**), liste (-), code (\`...\`) i\u015Faretleri okunabilirli\u011Fi artt\u0131r\u0131r.
- T\xFCrk\xE7e yaz.

\xC7IKTI:
- Yaln\u0131zca a\u015Fa\u011F\u0131daki JSON \u015Femas\u0131nda ver, ba\u015Fka metin EKLEME.

JSON \u015Femas\u0131:
{
  "answer": string,         // Detayl\u0131 markdown, [N] al\u0131nt\u0131l\u0131. refused=true ise "".
  "citations": number[],    // Yan\u0131tta kulland\u0131\u011F\u0131n kaynak numaralar\u0131 (1-tabanl\u0131)
  "refused": boolean,       // Kaynaklar yetersizse true
  "reason": string | null   // refused=true ise neden, yoksa null
}
`.trim();
function buildPrompt(query, chunks) {
  const sourcesBlock = chunks.map((c, i) => {
    const header = [
      `[${i + 1}] ${c.title ?? c.heading_path ?? "(ba\u015Fl\u0131ks\u0131z)"} \xB7 ${c.source_type}`,
      c.heading_path && c.heading_path !== c.title ? `Path: ${c.heading_path}` : null
    ].filter(Boolean).join("\n");
    return `${header}
---
${c.content}`;
  }).join("\n\n=== SONRAK\u0130 KAYNAK ===\n\n");
  return [
    `SORU:
${query}`,
    "",
    `<KAYNAKLAR>`,
    sourcesBlock,
    `</KAYNAKLAR>`,
    "",
    "G\xF6rev: JSON \u015Femas\u0131nda cevap \xFCret."
  ].join("\n");
}
function extractJson(raw) {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s.trim();
}
function extractCitedNumbers(text) {
  const set = /* @__PURE__ */ new Set();
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}
async function verifyGrounding(answer, citations, chunks) {
  const sentences = answer.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 5);
  if (sentences.length === 0) {
    return {
      verified: true,
      problemSentences: [],
      modelUsed: "n/a",
      latencyMs: 0
    };
  }
  const usedChunks = citations.map((n) => chunks[n - 1]).filter((c) => Boolean(c));
  if (usedChunks.length === 0) {
    return {
      verified: false,
      problemSentences: sentences,
      modelUsed: "n/a",
      latencyMs: 0
    };
  }
  const system = "Sen bir grounding verifier's\u0131n. Verilen yan\u0131ttaki HER c\xFCmlenin a\u015Fa\u011F\u0131daki kaynaklardan birinde desteklendi\u011Fini kontrol et. Birebir kelime e\u015Fle\u015Fmesi \u015Fart de\u011Fil \u2014 kaynaktaki bilginin **anlamca ayn\u0131** (parafraze, \xF6zetleme, yeniden yap\u0131land\u0131rma) olmas\u0131 yeterli. Ad\u0131mlar\u0131 farkl\u0131 s\u0131rada yazmak veya ba\u015Fl\u0131k de\u011Fi\u015Ftirmek 'desteklenmiyor' demek de\u011Fildir. Sadece kaynaklara bak; genel bilgi kullanma. JSON d\xF6nd\xFCr.";
  const sourcesBlock = usedChunks.map((c, i) => `[KAYNAK ${i + 1}]
${c.content.slice(0, 2e3)}`).join("\n\n");
  const sentBlock = sentences.map((s, i) => `[C${i + 1}] ${s}`).join("\n");
  const userPrompt = [
    "KAYNAKLAR:",
    sourcesBlock,
    "",
    "YANIT C\xDCMLELER\u0130:",
    sentBlock,
    "",
    "Her c\xFCmle i\xE7in kaynaklarca destekleniyor mu? Anlamca e\u015Fle\u015Fme yeterli \u2014 birebir kelime gerekmez. Cevap format\u0131 (sadece JSON):",
    '{"results":[{"id":"C1","supported":true|false}, ...]}'
  ].join("\n");
  const start = Date.now();
  const res = await generate(system, userPrompt, {
    temperature: 0,
    maxOutputTokens: 1024,
    responseMimeType: "application/json",
    tier: "fast"
    // verifier basit task, Haiku yeterli
  });
  let parsed = {};
  try {
    parsed = JSON.parse(extractJson(res.text));
  } catch {
    return {
      verified: true,
      problemSentences: [],
      modelUsed: res.modelUsed,
      latencyMs: Date.now() - start
    };
  }
  const unsupported = (parsed.results ?? []).filter((r) => r.supported === false).map((r) => {
    const idx = Number(r.id.replace("C", "")) - 1;
    return sentences[idx] ?? "";
  }).filter(Boolean);
  return {
    verified: unsupported.length === 0,
    problemSentences: unsupported,
    modelUsed: res.modelUsed,
    latencyMs: Date.now() - start
  };
}
async function ask(query, opts = {}) {
  const strictness = opts.strictness ?? "normal";
  const verify = opts.verify ?? true;
  const totalStart = Date.now();
  const retrievalStart = Date.now();
  const chunks = await retrieve(query, opts);
  const retrievalLatencyMs = Date.now() - retrievalStart;
  const minScore = strictness === "strict" ? MIN_RRF_SCORE * 2 : strictness === "lenient" ? MIN_RRF_SCORE / 2 : MIN_RRF_SCORE;
  const strong = chunks.filter((c) => c.rrfScore >= minScore);
  if (chunks.length === 0 || strong.length < MIN_HIGH_CONFIDENCE_CHUNKS) {
    return {
      query,
      answer: "",
      citations: [],
      refused: true,
      reason: chunks.length === 0 ? "Bilgi bankas\u0131nda ilgili kaynak bulunamad\u0131." : "Bulunan kaynaklar yeterince g\xFCvenilir de\u011Fil.",
      retrieved: chunks,
      meta: {
        retrievalLatencyMs,
        generationLatencyMs: 0,
        verifierLatencyMs: 0,
        totalLatencyMs: Date.now() - totalStart,
        modelUsed: "n/a",
        rerankUsed: Boolean(opts.rerank),
        verifierUsed: false
      }
    };
  }
  const userPrompt = buildPrompt(query, chunks);
  const genStart = Date.now();
  const res = await generate(SYSTEM, userPrompt, {
    temperature: 0.1,
    maxOutputTokens: 4096,
    responseMimeType: "application/json"
  });
  const generationLatencyMs = Date.now() - genStart;
  let parsed;
  try {
    parsed = AskOutputSchema.parse(JSON.parse(extractJson(res.text)));
  } catch (err) {
    return {
      query,
      answer: "",
      citations: [],
      refused: true,
      reason: `LLM yan\u0131t\u0131 \u015Femaya uymad\u0131: ${err.message}`,
      retrieved: chunks,
      meta: {
        retrievalLatencyMs,
        generationLatencyMs,
        verifierLatencyMs: 0,
        totalLatencyMs: Date.now() - totalStart,
        modelUsed: res.modelUsed,
        rerankUsed: Boolean(opts.rerank),
        verifierUsed: false
      }
    };
  }
  if (parsed.refused || !parsed.answer) {
    return {
      query,
      answer: parsed.answer ?? "",
      citations: [],
      refused: true,
      reason: parsed.reason ?? "LLM cevap \xFCretmedi.",
      retrieved: chunks,
      meta: {
        retrievalLatencyMs,
        generationLatencyMs,
        verifierLatencyMs: 0,
        totalLatencyMs: Date.now() - totalStart,
        modelUsed: res.modelUsed,
        rerankUsed: Boolean(opts.rerank),
        verifierUsed: false
      }
    };
  }
  const fromText = extractCitedNumbers(parsed.answer);
  const declared = parsed.citations ?? [];
  const allCitations = [.../* @__PURE__ */ new Set([...fromText, ...declared])].filter(
    (n) => n >= 1 && n <= chunks.length
  );
  let verifierLatencyMs = 0;
  let verifierUsed = false;
  let finalAnswer = parsed.answer;
  let finalRefused = false;
  let finalReason = null;
  if (verify && allCitations.length > 0) {
    verifierUsed = true;
    const v = await verifyGrounding(parsed.answer, allCitations, chunks);
    verifierLatencyMs = v.latencyMs;
    if (!v.verified) {
      if (strictness === "strict") {
        finalRefused = true;
        finalAnswer = "";
        finalReason = `Verifier: ${v.problemSentences.length} c\xFCmle kaynaklarca desteklenmiyor.`;
      } else {
        let stripped = parsed.answer;
        for (const s of v.problemSentences) {
          stripped = stripped.replace(s, "");
        }
        stripped = stripped.replace(/\s{2,}/g, " ").trim();
        if (stripped.length < 20) {
          finalRefused = true;
          finalAnswer = "";
          finalReason = `Do\u011Frulanabilir bilgi az: ${v.problemSentences.length} c\xFCmle kald\u0131r\u0131ld\u0131, kalan yetersiz.`;
        } else {
          finalAnswer = stripped;
          finalReason = `Verifier: ${v.problemSentences.length} c\xFCmle desteklenmedi\u011Fi i\xE7in kald\u0131r\u0131ld\u0131.`;
        }
      }
    }
  }
  const citationPayloads = allCitations.map((n) => {
    const c = chunks[n - 1];
    if (!c) return null;
    return {
      number: n,
      chunk_id: c.chunk_id,
      doc_id: c.doc_id,
      source_type: c.source_type,
      title: c.title,
      heading_path: c.heading_path,
      excerpt: c.content.slice(0, 300)
    };
  }).filter((x) => x !== null);
  return {
    query,
    answer: finalAnswer,
    citations: citationPayloads,
    refused: finalRefused,
    reason: finalReason,
    retrieved: chunks,
    meta: {
      retrievalLatencyMs,
      generationLatencyMs,
      verifierLatencyMs,
      totalLatencyMs: Date.now() - totalStart,
      modelUsed: res.modelUsed,
      rerankUsed: Boolean(opts.rerank),
      verifierUsed
    }
  };
}

// server/kb/kb-bundle-entry.ts
init_gemini();

// server/kb/src/lib/cc/categorizer.ts
init_gemini();
import { z as z3 } from "zod";

// server/kb/src/lib/cc/taxonomy.ts
import { readFileSync } from "node:fs";
import path2 from "node:path";
var cachedCategories = null;
var cachedRootCauses = null;
function loadCategories() {
  if (cachedCategories) return cachedCategories;
  const p = path2.resolve(process.cwd(), "data/cc-taxonomy.json");
  const data = JSON.parse(readFileSync(p, "utf8"));
  cachedCategories = data.categories;
  return cachedCategories;
}
function loadRootCauses() {
  if (cachedRootCauses) return cachedRootCauses;
  const p = path2.resolve(process.cwd(), "data/cc-root-causes.json");
  const data = JSON.parse(readFileSync(p, "utf8"));
  cachedRootCauses = data.root_causes;
  return cachedRootCauses;
}
function getCategoryById(id) {
  return loadCategories().find((c) => c.id === id) ?? null;
}
function getRootCauseById(id) {
  return loadRootCauses().find((r) => r.id === id) ?? null;
}
function formatCategoriesForPrompt() {
  return loadCategories().map(
    (c) => `- ${c.id}: ${c.name} \u2014 ${c.description}
    Alt: ${c.subs.join(" | ")}`
  ).join("\n");
}
function formatRootCausesForPrompt() {
  return loadRootCauses().map(
    (r) => `- ${r.id}: ${r.name} (genelde ${r.typical_owner}) \u2014 ${r.description}
    Alt: ${r.subs.join(" | ")}`
  ).join("\n");
}
function isValidCategory(id, sub) {
  const cat = getCategoryById(id);
  if (!cat) return false;
  if (!sub) return true;
  return cat.subs.includes(sub);
}
function isValidRootCause(id, sub) {
  const rc = getRootCauseById(id);
  if (!rc) return false;
  if (!sub) return true;
  return rc.subs.includes(sub);
}

// server/kb/src/lib/cc/categorizer.ts
var SYSTEM2 = `
Sen bir \xE7a\u011Fr\u0131 merkezi ticket s\u0131n\u0131fland\u0131r\u0131c\u0131s\u0131n. G\xF6revin: gelen sorun metnini
verilen taksonomi i\xE7inden TEK B\u0130R ana kategori + alt + TEK B\u0130R k\xF6k neden + alt
ile etiketlemektir.

Kurallar (mutlak):
- ASLA yeni kategori veya k\xF6k neden uydurma.
- SADECE a\u015Fa\u011F\u0131daki listede ge\xE7en id'leri kullan.
- E\u011Fer hi\xE7biri tam uymuyorsa, kategori i\xE7in "diger", k\xF6k neden i\xE7in "other"
  kullan.
- Confidence de\u011Ferini 0-1 aras\u0131nda ver; emin de\u011Filsen d\xFC\u015F\xFCr.
- 1 c\xFCmlelik "reason" alan\u0131 ekle (neden bu se\xE7im).
- Yan\u0131t\u0131 KES\u0130NL\u0130KLE JSON ver, ba\u015Fka metin EKLEME.
`.trim();
var Output = z3.object({
  category_id: z3.string(),
  category_sub: z3.string().nullable(),
  root_cause_id: z3.string(),
  root_cause_sub: z3.string().nullable(),
  confidence: z3.number().min(0).max(1),
  reason: z3.string()
});
function extractJson2(raw) {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s.trim();
}
async function categorize(input) {
  const userPrompt = [
    "TAKSONOM\u0130 \u2014 KATEGOR\u0130LER:",
    formatCategoriesForPrompt(),
    "",
    "TAKSONOM\u0130 \u2014 K\xD6K NEDENLER:",
    formatRootCausesForPrompt(),
    "",
    "SORUN B\u0130LG\u0130S\u0130:",
    input.project ? `Proje: ${input.project}` : null,
    input.customerName ? `M\xFC\u015Fteri: ${input.customerName}` : null,
    `A\xE7\u0131klama: ${input.description.slice(0, 4e3)}`,
    "",
    `\xC7\u0131kt\u0131 JSON \u015Femas\u0131 (sadece JSON):`,
    `{`,
    `  "category_id": string,         // taksonomideki id'lerden biri (\xF6rn. "ebelge")`,
    `  "category_sub": string | null, // alt kategori, listede ge\xE7enlerden`,
    `  "root_cause_id": string,       // \xF6rn. "configuration"`,
    `  "root_cause_sub": string | null,`,
    `  "confidence": number,          // 0..1`,
    `  "reason": string               // 1 c\xFCmle gerek\xE7e`,
    `}`
  ].filter(Boolean).join("\n");
  const res = await generate(SYSTEM2, userPrompt, {
    temperature: 0,
    maxOutputTokens: 600,
    responseMimeType: "application/json",
    tier: "fast"
    // kategorize tek-shot, Haiku yeterli ve ucuz
  });
  let parsed;
  try {
    parsed = JSON.parse(extractJson2(res.text));
  } catch {
    return fallback("LLM JSON parse edilemedi");
  }
  const v = Output.safeParse(parsed);
  if (!v.success) {
    return fallback("LLM \xE7\u0131kt\u0131s\u0131 \u015Femaya uymad\u0131");
  }
  const out = v.data;
  if (!isValidCategory(out.category_id, out.category_sub)) {
    return fallback(`Ge\xE7ersiz kategori: ${out.category_id}/${out.category_sub}`);
  }
  if (!isValidRootCause(out.root_cause_id, out.root_cause_sub)) {
    return fallback(
      `Ge\xE7ersiz k\xF6k neden: ${out.root_cause_id}/${out.root_cause_sub}`
    );
  }
  return out;
}
function fallback(reason) {
  return {
    category_id: "diger",
    category_sub: "Bilinmeyen",
    root_cause_id: "other",
    root_cause_sub: "S\u0131n\u0131fland\u0131r\u0131lamad\u0131",
    confidence: 0,
    reason: `Otomatik s\u0131n\u0131fland\u0131rma ba\u015Far\u0131s\u0131z: ${reason}`
  };
}

// server/kb/src/lib/cc/categorizer-v2.ts
init_gemini();
import { z as z4 } from "zod";

// server/kb/src/lib/cc/taxonomy-v2.ts
import { readFileSync as readFileSync2 } from "node:fs";
import path3 from "node:path";
var OPEN_FIELD_ORDER = [
  "urun",
  "platform",
  "is_sureci",
  "islem_tipi",
  "etkilenen_nesne",
  "etki"
];
var cache = null;
function loadTaxonomyV2() {
  if (cache) return cache;
  const p = path3.resolve(process.cwd(), "data/cc-taxonomy-v2.json");
  cache = JSON.parse(readFileSync2(p, "utf8"));
  return cache;
}
var hintsCache = null;
function loadHints() {
  if (hintsCache) return hintsCache;
  const p = path3.resolve(process.cwd(), "data/cc-taxonomy-hints.json");
  hintsCache = JSON.parse(readFileSync2(p, "utf8"));
  return hintsCache;
}
function formatHintsForPrompt() {
  const h = loadHints();
  const ph = h.platform_hints;
  const lines = [];
  lines.push("## DOMAIN \u0130PU\xC7LARI \u2014 PANORAMA \xD6ZEL\u0130NDE KESIN KURALLAR");
  lines.push("");
  lines.push("### Temel Prensipler:");
  for (const p of h.principles) lines.push(`  \u2022 ${p}`);
  lines.push("");
  lines.push("### Platform = 'Mobil' OLMASI ZORUNLU (a\u015Fa\u011F\u0131daki terimlerden biri etkilenen_nesne veya islem_tipi olursa):");
  for (const v of ph.mobil_kesin.etkilenen_nesne) {
    lines.push(`  \u2022 etkilenen_nesne = "${v}"`);
  }
  for (const v of ph.mobil_kesin.islem_tipi) {
    lines.push(`  \u2022 islem_tipi = "${v}"`);
  }
  lines.push("");
  lines.push("### Platform = 'Backoffice' OLMASI ZORUNLU (a\u015Fa\u011F\u0131daki terimlerden biri etkilenen_nesne veya islem_tipi olursa):");
  for (const v of ph.backoffice_kesin.etkilenen_nesne) {
    lines.push(`  \u2022 etkilenen_nesne = "${v}"`);
  }
  for (const v of ph.backoffice_kesin.islem_tipi) {
    lines.push(`  \u2022 islem_tipi = "${v}"`);
  }
  lines.push("");
  lines.push("### Platform BEL\u0130RS\u0130Z (bu terimler tek ba\u015F\u0131na platform belirtmez, a\xE7\u0131klamadaki ba\u011Flama bak):");
  for (const v of ph.belirsiz_ipucu_yok.etkilenen_nesne) {
    lines.push(`  \u2022 etkilenen_nesne = "${v}"`);
  }
  for (const v of ph.belirsiz_ipucu_yok.islem_tipi) {
    lines.push(`  \u2022 islem_tipi = "${v}"`);
  }
  if (h.text_keyword_hints?.keywords?.length) {
    lines.push("");
    lines.push("### A\xC7IKLAMA METN\u0130NDE KEYWORD \u2192 PLATFORM/\xDCR\xDCN ZORLAMA:");
    for (const k of h.text_keyword_hints.keywords) {
      const parts = [];
      if (k.platform) parts.push(`platform = "${k.platform}"`);
      if (k.urun) parts.push(`urun = "${k.urun}"`);
      lines.push(
        `  \u2022 "${k.keyword}" ge\xE7erse \u2192 ${parts.join(", ")} (${k.reason})`
      );
    }
  }
  return lines.join("\n");
}
var goldCache = null;
function loadGoldExamples() {
  if (goldCache) return goldCache;
  try {
    const p = path3.resolve(process.cwd(), "data/cc-gold-examples.json");
    goldCache = JSON.parse(readFileSync2(p, "utf8"));
  } catch {
    goldCache = [];
  }
  return goldCache;
}
function formatGoldForPrompt(mode) {
  const gold = loadGoldExamples();
  if (!gold.length) return "";
  if (mode === "open") {
    const byGroup2 = {};
    const picked2 = [];
    for (const g of gold) {
      const k = g.kokNedenGrubu || "?";
      byGroup2[k] = (byGroup2[k] || 0) + 1;
      if (byGroup2[k] <= 2) picked2.push(g);
    }
    return picked2.map(
      (g) => `- "${(g.sorun || "").slice(0, 110)}" => platform=${g.platform}; is_sureci=${g.isSureci}; islem_tipi=${g.islemTipi}; etkilenen_nesne=${g.etkilenenNesne}; etki=${g.etki}`
    ).join("\n");
  }
  const byGroup = {};
  const picked = [];
  for (const g of gold) {
    const grup = g.kokNedenGrubu;
    const detay = g.kokNedenDetayi;
    if (!grup || !isValidKokNedenGrubu(grup)) continue;
    if (!detay || !isValidKokNedenDetay(detay, grup)) continue;
    if (!g.cozumTipi || !isValidCozumTipi(g.cozumTipi, grup, detay)) continue;
    if (g.kaliciOnlem && !isValidKaliciOnlem(g.kaliciOnlem)) continue;
    byGroup[grup] = (byGroup[grup] || 0) + 1;
    if (byGroup[grup] <= 2) picked.push(g);
  }
  return picked.map(
    (g) => `- Sorun: "${(g.sorun || "").slice(0, 90)}" \xC7\xF6z\xFCm: "${(g.cozum || "").slice(0, 90)}" => kok_neden_grubu=${g.kokNedenGrubu}; kok_neden_detayi=${g.kokNedenDetayi}; cozum_tipi=${g.cozumTipi}; kalici_onlem=${g.kaliciOnlem}`
  ).join("\n");
}
function detectTextKeywordHints(description) {
  if (!description) return [];
  const h = loadHints();
  const keywords = h.text_keyword_hints?.keywords ?? [];
  if (keywords.length === 0) return [];
  const norm = description.replaceAll("\u0130", "I").replaceAll("\u0131", "i").replaceAll("\u011E", "G").replaceAll("\u011F", "g").replaceAll("\xDC", "U").replaceAll("\xFC", "u").replaceAll("\u015E", "S").replaceAll("\u015F", "s").replaceAll("\xD6", "O").replaceAll("\xF6", "o").replaceAll("\xC7", "C").replaceAll("\xE7", "c").toLowerCase();
  const matched = [];
  for (const k of keywords) {
    const kw = k.keyword.replaceAll("\u0130", "I").replaceAll("\u0131", "i").replaceAll("\u011E", "G").replaceAll("\u011F", "g").replaceAll("\xDC", "U").replaceAll("\xFC", "u").replaceAll("\u015E", "S").replaceAll("\u015F", "s").replaceAll("\xD6", "O").replaceAll("\xF6", "o").replaceAll("\xC7", "C").replaceAll("\xE7", "c").toLowerCase();
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    if (re.test(norm)) {
      matched.push({
        keyword: k.keyword,
        platform: k.platform ?? null,
        urun: k.urun ?? null,
        reason: k.reason
      });
    }
  }
  return matched;
}
function applyKeywordHints(description, currentPlatform, currentUrun) {
  const hits = detectTextKeywordHints(description);
  if (hits.length === 0) {
    return { platform: currentPlatform, urun: currentUrun, appliedReasons: [] };
  }
  let platform = currentPlatform;
  let urun = currentUrun;
  const reasons = [];
  for (const h of hits) {
    if (h.platform && platform !== h.platform) {
      platform = h.platform;
      reasons.push(`'${h.keyword}' \u2192 platform=${h.platform} (${h.reason})`);
    }
    if (h.urun && urun !== h.urun) {
      urun = h.urun;
      reasons.push(`'${h.keyword}' \u2192 urun=${h.urun} (${h.reason})`);
    }
  }
  return { platform, urun, appliedReasons: reasons };
}
function enforcePlatformFromHints(current, etkilenenNesne, islemTipi) {
  const h = loadHints();
  const ph = h.platform_hints;
  const checkSet = (arrEN, arrIT) => {
    if (etkilenenNesne && arrEN.includes(etkilenenNesne)) return true;
    if (islemTipi && arrIT.includes(islemTipi)) return true;
    return false;
  };
  if (checkSet(ph.mobil_kesin.etkilenen_nesne, ph.mobil_kesin.islem_tipi)) {
    if (current !== "Mobil") {
      return {
        platform: "Mobil",
        overridden: true,
        reason: `Hint kural\u0131: "${etkilenenNesne ?? islemTipi}" mobil platforma kesin i\u015Faret eder.`
      };
    }
    return { platform: "Mobil", overridden: false, reason: null };
  }
  if (checkSet(ph.backoffice_kesin.etkilenen_nesne, ph.backoffice_kesin.islem_tipi)) {
    if (current !== "Backoffice") {
      return {
        platform: "Backoffice",
        overridden: true,
        reason: `Hint kural\u0131: "${etkilenenNesne ?? islemTipi}" backoffice platforma kesin i\u015Faret eder.`
      };
    }
    return { platform: "Backoffice", overridden: false, reason: null };
  }
  return { platform: current, overridden: false, reason: null };
}
function getOpenField(field) {
  return loadTaxonomyV2().open[field];
}
function isValidOpenValue(field, value) {
  if (value == null) return true;
  return getOpenField(field).values.includes(value);
}
function getKokNedenGroups(override) {
  return override?.groups ?? loadTaxonomyV2().close.kok_neden.groups;
}
function getCozumTipi(override) {
  return override?.cozum_tipi ?? loadTaxonomyV2().close.cozum_tipi;
}
function getKaliciOnlem(override) {
  return override?.kalici_onlem ?? loadTaxonomyV2().close.kalici_onlem;
}
function isValidKokNedenGrubu(group, override) {
  if (group == null) return true;
  return getKokNedenGroups(override).some((g) => g.group === group);
}
function isValidKokNedenDetay(detail, group, override) {
  if (detail == null) return true;
  const groups = getKokNedenGroups(override);
  const scope = group ? groups.filter((g) => g.group === group) : groups;
  return scope.some((g) => g.details.some((d) => d.label === detail));
}
function getAllowedCozumTipleri(group, detail, override) {
  if (!group || !detail) return getCozumTipi(override).values;
  const g = getKokNedenGroups(override).find((x) => x.group === group);
  const d = g?.details.find((x) => x.label === detail);
  return d?.cozum_tipleri ?? [];
}
function isValidCozumTipi(value, group, detail, override) {
  if (value == null) return true;
  if (group && detail) return getAllowedCozumTipleri(group, detail, override).includes(value);
  return getCozumTipi(override).values.includes(value);
}
function isValidKaliciOnlem(value, override) {
  if (value == null) return true;
  return getKaliciOnlem(override).values.includes(value);
}
function formatOpenForPrompt() {
  const t = loadTaxonomyV2();
  return OPEN_FIELD_ORDER.map((f) => {
    const spec = t.open[f];
    return [
      `## ${spec.label} (${f})`,
      spec.description,
      ...spec.values.map((v) => `  \u2022 ${v}`)
    ].join("\n");
  }).join("\n\n");
}

// server/kb/src/lib/cc/categorizer-v2.ts
var SYSTEM3 = `
Sen bir \xE7a\u011Fr\u0131 merkezi a\xE7\u0131l\u0131\u015F s\u0131n\u0131fland\u0131r\u0131c\u0131s\u0131s\u0131n. G\xF6revin: gelen sorun metnini
verilen 5 alanl\u0131 taksonomi i\xE7inden se\xE7imlerle etiketlemektir.

Kurallar (mutlak):
- ASLA yeni de\u011Fer uydurma; SADECE listede ge\xE7en string'leri kullan.
- Bir alan i\xE7in uygun de\u011Fer yoksa null b\u0131rak (bo\u015F string de\u011Fil).
- 5 alan ZORUNLU s\u0131ralamada: urun, is_sureci, islem_tipi, etkilenen_nesne, etki.
- Confidence 0-1 \u2014 emin de\u011Filsen d\xFC\u015F\xFCr ve ilgili alan\u0131 null b\u0131rak.
- 1 c\xFCmlelik "reason" alan\u0131 (T\xFCrk\xE7e, neden bu se\xE7im).
- Yan\u0131t\u0131 KES\u0130NL\u0130KLE JSON ver, ba\u015Fka metin EKLEME.
`.trim();
var Output2 = z4.object({
  urun: z4.string().nullable(),
  platform: z4.string().nullable(),
  is_sureci: z4.string().nullable(),
  islem_tipi: z4.string().nullable(),
  etkilenen_nesne: z4.string().nullable(),
  etki: z4.string().nullable(),
  confidence: z4.number().min(0).max(1),
  reason: z4.string()
});
function extractJson3(raw) {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s.trim();
}
async function categorizeV2(input) {
  const fullPrompt = [
    "TAKSONOM\u0130 \u2014 6 A\xC7ILI\u015E ALANI:",
    formatOpenForPrompt(),
    "",
    formatHintsForPrompt(),
    "",
    "GER\xC7EK ET\u0130KETLENM\u0130\u015E \xD6RNEKLER (insan uzman do\u011Frulad\u0131 \u2014 ayn\u0131 mant\u0131kla etiketle):",
    formatGoldForPrompt("open"),
    "",
    "SORUN B\u0130LG\u0130S\u0130:",
    input.project ? `Proje: ${input.project}` : null,
    input.customerName ? `M\xFC\u015Fteri: ${input.customerName}` : null,
    `A\xE7\u0131klama: ${input.description.slice(0, 4e3)}`,
    "",
    `\xC7\u0131kt\u0131 JSON \u015Femas\u0131 (sadece JSON):`,
    `{`,
    `  "urun": string | null,            // taksonomideki \xDCr\xFCn de\u011Ferlerinden biri`,
    `  "platform": string | null,        // Platform de\u011Ferlerinden biri (Backoffice/Mobil)`,
    `  "is_sureci": string | null,       // \u0130\u015F S\xFCreci de\u011Ferlerinden biri`,
    `  "islem_tipi": string | null,      // \u0130\u015Flem Tipi de\u011Ferlerinden biri`,
    `  "etkilenen_nesne": string | null, // Etkilenen Nesne de\u011Ferlerinden biri (ekran ad\u0131 olabilir)`,
    `  "etki": string | null,            // Etki de\u011Ferlerinden biri`,
    `  "confidence": number,             // 0..1`,
    `  "reason": string                  // 1 c\xFCmle T\xFCrk\xE7e gerek\xE7e`,
    `}`
  ].filter(Boolean).join("\n");
  const splitAt = fullPrompt.indexOf("SORUN B\u0130LG\u0130S\u0130:");
  const cachePrefix = splitAt > 0 ? fullPrompt.slice(0, splitAt) : void 0;
  const userPrompt = splitAt > 0 ? fullPrompt.slice(splitAt) : fullPrompt;
  const res = await generate(SYSTEM3, userPrompt, {
    temperature: 0,
    maxOutputTokens: 600,
    responseMimeType: "application/json",
    tier: "fast",
    // sınıflandırma tek-shot, Haiku yeterli ve ucuz
    cachePrefix
  });
  let parsed;
  try {
    parsed = JSON.parse(extractJson3(res.text));
  } catch {
    return emptyResult(res, "LLM JSON parse edilemedi");
  }
  const v = Output2.safeParse(parsed);
  if (!v.success) {
    return emptyResult(res, "LLM \xE7\u0131kt\u0131s\u0131 \u015Femaya uymad\u0131");
  }
  const out = v.data;
  let urun = isValidOpenValue("urun", out.urun) ? out.urun : null;
  let platform = isValidOpenValue("platform", out.platform) ? out.platform : null;
  const is_sureci = isValidOpenValue("is_sureci", out.is_sureci) ? out.is_sureci : null;
  const islem_tipi = isValidOpenValue("islem_tipi", out.islem_tipi) ? out.islem_tipi : null;
  const etkilenen_nesne = isValidOpenValue("etkilenen_nesne", out.etkilenen_nesne) ? out.etkilenen_nesne : null;
  const etki = isValidOpenValue("etki", out.etki) ? out.etki : null;
  const hintReasons = [];
  const enforced = enforcePlatformFromHints(platform, etkilenen_nesne, islem_tipi);
  if (enforced.overridden) {
    platform = enforced.platform;
    if (enforced.reason) hintReasons.push(enforced.reason);
  }
  const kwApplied = applyKeywordHints(input.description, platform, urun);
  if (kwApplied.appliedReasons.length > 0) {
    platform = kwApplied.platform;
    urun = kwApplied.urun;
    hintReasons.push(...kwApplied.appliedReasons);
  }
  return {
    urun,
    platform,
    is_sureci,
    islem_tipi,
    etkilenen_nesne,
    etki,
    confidence: out.confidence,
    reason: hintReasons.length > 0 ? `${out.reason} [Hint: ${hintReasons.join("; ")}]` : out.reason,
    modelUsed: res.modelUsed,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: res.costUsd
  };
}
function emptyResult(res, reason) {
  return {
    urun: null,
    platform: null,
    is_sureci: null,
    islem_tipi: null,
    etkilenen_nesne: null,
    etki: null,
    confidence: 0,
    reason: `Otomatik s\u0131n\u0131fland\u0131rma ba\u015Far\u0131s\u0131z: ${reason}`,
    modelUsed: res.modelUsed,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: res.costUsd
  };
}
var CLOSE_SYSTEM = `
Sen bir \xE7a\u011Fr\u0131 merkezi KAPANI\u015E s\u0131n\u0131fland\u0131r\u0131c\u0131s\u0131s\u0131n. G\xF6revin: \xE7\xF6z\xFCm yap\u0131lm\u0131\u015F
ticket i\xE7in destek dilinde 4 kapan\u0131\u015F alan\u0131n\u0131 se\xE7mek.

Kurallar (mutlak):
- ASLA yeni de\u011Fer uydurma; SADECE verilen taksonomide ge\xE7en string'leri kullan.
- "kok_neden_grubu" ve "kok_neden_detayi" BA\u011EIMSIZ se\xE7ilir; detay herhangi bir gruba ait olabilir \u2014 t\xFCm detay listesinden uygun olan\u0131 se\xE7.
- Uygun de\u011Fer yoksa null b\u0131rak (bo\u015F string de\u011Fil).
- kalici_onlem opsiyonel \u2014 emin de\u011Filsen veya gereksizse null b\u0131rak.
- Confidence 0-1 \u2014 karars\u0131zsan d\xFC\u015F\xFCr.
- 1 c\xFCmlelik T\xFCrk\xE7e "reason" alan\u0131 yaz.
- Yan\u0131t\u0131 KES\u0130NL\u0130KLE JSON ver, ba\u015Fka metin EKLEME.
`.trim();
var CloseOutput = z4.object({
  kok_neden_grubu: z4.string().nullable(),
  kok_neden_detayi: z4.string().nullable(),
  cozum_tipi: z4.string().nullable(),
  kalici_onlem: z4.string().nullable(),
  confidence: z4.number().min(0).max(1),
  reason: z4.string()
});
var CLOSE_CLARIFY_QUESTIONS = [
  "Sorunun K\xD6K NEDEN\u0130 neydi? (\xF6r. yanl\u0131\u015F/eksik parametre \xB7 eksik veri/kart \xB7 yetki \xB7 entegrat\xF6r servisi \xB7 donan\u0131m/cihaz \xB7 sunucu/altyap\u0131)",
  "\xC7\xF6z\xFCm i\xE7in tam olarak NE YAPILDI? (\xF6r. parametre de\u011Fi\u015Fikli\u011Fi \xB7 veri/kart d\xFCzeltme \xB7 script/DB g\xFCncelleme \xB7 entegrat\xF6re y\xF6nlendirme \xB7 kullan\u0131c\u0131 bilgilendirme)",
  "Ayn\u0131 sorunun TEKRARINI \xF6nlemek i\xE7in ne gerekir? (\xF6r. e\u011Fitim/dok\xFCman \xB7 kontrol/validasyon \xB7 parametre sihirbaz\u0131 \xB7 log/izleme)"
];
var CLOSE_CLARIFY_THRESHOLD = Number(process.env.CLOSE_CLARIFY_THRESHOLD || 0.8);
async function suggestClose(input) {
  const ctxLines = [];
  if (input.open_urun) ctxLines.push(`A\xE7\u0131l\u0131\u015F \xB7 \xDCr\xFCn: ${input.open_urun}`);
  if (input.open_is_sureci) ctxLines.push(`A\xE7\u0131l\u0131\u015F \xB7 \u0130\u015F S\xFCreci: ${input.open_is_sureci}`);
  if (input.open_islem_tipi) ctxLines.push(`A\xE7\u0131l\u0131\u015F \xB7 \u0130\u015Flem Tipi: ${input.open_islem_tipi}`);
  const retrievalBlock = input.closeExamples || "";
  const closeGold = input.skipGold ? "" : formatGoldForPrompt("close");
  const kokNedenGroups = getKokNedenGroups(input.taxonomy);
  const cascadeBlock = kokNedenGroups.map((g) => {
    const dets = g.details.map((d) => `    - ${d.label}   [\xE7\xF6z\xFCm: ${d.cozum_tipleri.join(" | ")}]`).join("\n");
    return `\u25A0 ${g.group}
${dets}`;
  }).join("\n\n");
  const fullPrompt = [
    "K\xD6K NEDEN \u2014 GRUP \u203A DETAY \u203A \u0130Z\u0130NL\u0130 \xC7\xD6Z\xDCM T\u0130PLER\u0130 (CASCADE):",
    "Kural: \xF6nce bir GRUP se\xE7; sonra YALNIZ o grubun alt\u0131ndaki detaylardan birini;",
    "sonra o detay\u0131n k\xF6\u015Feli parantezdeki \u0130Z\u0130NL\u0130 \xE7\xF6z\xFCm tiplerinden birini. Grup d\u0131\u015F\u0131",
    "detay ya da detay\u0131n izin vermedi\u011Fi \xE7\xF6z\xFCm tipi ASLA se\xE7me.",
    "",
    cascadeBlock,
    "",
    "TAKSONOM\u0130 \u2014 KALICI \xD6NLEM (opsiyonel, gruptan ba\u011F\u0131ms\u0131z):",
    getKaliciOnlem(input.taxonomy).values.map((v2) => `  \u2022 ${v2}`).join("\n"),
    "",
    ...closeGold ? ["GER\xC7EK ET\u0130KETLENM\u0130\u015E \xD6RNEKLER (insan uzman do\u011Frulad\u0131 \u2014 ayn\u0131 mant\u0131kla kapan\u0131\u015F se\xE7):", closeGold, ""] : [],
    "TICKET BA\u011ELAMI:",
    ctxLines.join("\n") || "(a\xE7\u0131l\u0131\u015F s\u0131n\u0131fland\u0131rmas\u0131 yok)",
    "",
    ...retrievalBlock ? [retrievalBlock, ""] : [],
    `Sorun a\xE7\u0131klamas\u0131: ${input.description.slice(0, 2e3)}`,
    "",
    `\xC7\xF6z\xFCm tasla\u011F\u0131 (ajan yazd\u0131): ${input.resolution.slice(0, 3e3)}`,
    "",
    ...input.clarifyingAnswers ? [`OPERAT\xD6R EK B\u0130LG\u0130 (clarifying sorulara cevap \u2014 etiketlerken KULLAN): ${input.clarifyingAnswers.slice(0, 1500)}`, ""] : [],
    `\xC7\u0131kt\u0131 JSON \u015Femas\u0131 (sadece JSON):`,
    `{`,
    `  "kok_neden_grubu": string | null,   // ${kokNedenGroups.length} gruptan biri`,
    `  "kok_neden_detayi": string | null,  // SE\xC7\u0130LEN grubun alt\u0131ndaki detaylardan biri`,
    `  "cozum_tipi": string | null,        // SE\xC7\u0130LEN detay\u0131n izinli \xE7\xF6z\xFCm tiplerinden biri`,
    `  "kalici_onlem": string | null,      // kal\u0131c\u0131 \xF6nlemlerden biri, opsiyonel`,
    `  "confidence": number,`,
    `  "reason": string                    // 1 c\xFCmle gerek\xE7e`,
    `}`
  ].join("\n");
  const splitAt = fullPrompt.indexOf("TICKET BA\u011ELAMI:");
  const cachePrefix = splitAt > 0 ? fullPrompt.slice(0, splitAt) : void 0;
  const userPrompt = splitAt > 0 ? fullPrompt.slice(splitAt) : fullPrompt;
  const res = await generate(CLOSE_SYSTEM, userPrompt, {
    temperature: 0,
    maxOutputTokens: 600,
    responseMimeType: "application/json",
    tier: "fast",
    cachePrefix
  });
  let parsed;
  try {
    parsed = JSON.parse(extractJson3(res.text));
  } catch {
    return emptyCloseResult(res, "LLM JSON parse edilemedi");
  }
  const v = CloseOutput.safeParse(parsed);
  if (!v.success) {
    return emptyCloseResult(res, "LLM \xE7\u0131kt\u0131s\u0131 \u015Femaya uymad\u0131");
  }
  const out = v.data;
  const kok_neden_grubu = isValidKokNedenGrubu(out.kok_neden_grubu, input.taxonomy) ? out.kok_neden_grubu : null;
  const kok_neden_detayi = kok_neden_grubu && isValidKokNedenDetay(out.kok_neden_detayi, kok_neden_grubu, input.taxonomy) ? out.kok_neden_detayi : null;
  const cozum_tipi = kok_neden_grubu && kok_neden_detayi && isValidCozumTipi(out.cozum_tipi, kok_neden_grubu, kok_neden_detayi, input.taxonomy) ? out.cozum_tipi : null;
  const kalici_onlem = isValidKaliciOnlem(out.kalici_onlem, input.taxonomy) ? out.kalici_onlem : null;
  const uncertain = !input.clarifyingAnswers && (kok_neden_grubu === null || kok_neden_detayi === null || out.confidence < CLOSE_CLARIFY_THRESHOLD);
  return {
    kok_neden_grubu,
    kok_neden_detayi,
    cozum_tipi,
    kalici_onlem,
    confidence: out.confidence,
    reason: out.reason,
    needsClarification: uncertain,
    clarifyingQuestions: uncertain ? CLOSE_CLARIFY_QUESTIONS : [],
    modelUsed: res.modelUsed,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: res.costUsd
  };
}
function emptyCloseResult(res, reason) {
  return {
    kok_neden_grubu: null,
    kok_neden_detayi: null,
    cozum_tipi: null,
    kalici_onlem: null,
    confidence: 0,
    reason: `Otomatik kapan\u0131\u015F \xF6nerisi ba\u015Far\u0131s\u0131z: ${reason}`,
    needsClarification: false,
    clarifyingQuestions: [],
    modelUsed: res.modelUsed,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: res.costUsd
  };
}

// server/kb/src/lib/ticket/index.ts
import { z as z6 } from "zod";

// server/kb/src/lib/db.ts
init_env();
import sql from "mssql";
var FORBIDDEN_PATTERNS = [
  /\binsert\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bdrop\b/i,
  /\balter\b/i,
  /\bcreate\b/i,
  /\btruncate\b/i,
  /\bmerge\b/i,
  /\bexec(ute)?\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\bdeny\b/i,
  /\binto\b\s+\w/i,
  // SELECT ... INTO yeni tablo
  /;\s*\S/
  // çoklu ifade
];
function assertReadOnly(query) {
  const stripped = query.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const pat of FORBIDDEN_PATTERNS) {
    if (pat.test(stripped)) {
      throw new Error(
        `Read-only guard sorguyu reddetti: pattern=${pat.source}`
      );
    }
  }
}
var poolPromise = null;
function buildConfig() {
  const e = env();
  return {
    server: e.TICKET_MSSQL_SERVER,
    port: e.TICKET_MSSQL_PORT,
    database: e.TICKET_MSSQL_DATABASE,
    user: e.TICKET_MSSQL_USER,
    password: e.TICKET_MSSQL_PASSWORD,
    options: {
      ...e.TICKET_MSSQL_INSTANCE ? { instanceName: e.TICKET_MSSQL_INSTANCE } : {},
      encrypt: e.TICKET_MSSQL_ENCRYPT,
      trustServerCertificate: e.TICKET_MSSQL_TRUST_SERVER_CERT,
      enableArithAbort: true
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 3e4 },
    connectionTimeout: 3e4,
    // Agir view sayfa sorgulari 60s'i asabiliyor; pool timeout'unu yukselttik.
    // Per-query timeout yine runReadOnly icindeki Promise.race ile yonetilir.
    requestTimeout: 3e5
  };
}
async function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(buildConfig()).catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}
async function runReadOnly(query, params = [], opts = {}) {
  assertReadOnly(query);
  const pool = await getPool();
  const request = pool.request();
  const timeoutMs = opts.timeoutMs ?? env().TICKET_QUERY_TIMEOUT_MS;
  for (const p of params) {
    request.input(p.name, p.type, p.value);
  }
  let timer = null;
  const start = Date.now();
  const result = await Promise.race([
    request.query(query),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        request.cancel();
        reject(new Error(`Sorgu zaman a\u015F\u0131m\u0131na u\u011Frad\u0131 (${timeoutMs}ms)`));
      }, timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  const durationMs = Date.now() - start;
  return {
    rows: result.recordset ?? [],
    rowCount: result.recordset?.length ?? 0,
    durationMs
  };
}

// server/kb/src/lib/ticket/source.ts
var TICKET_VIEW = {
  schema: "dbo",
  name: "VIEW_BILDIRIM_AI_ANALIZ_DATA"
};
var COL = {
  id: "Bildirim_No",
  year: "Yil",
  monthInt: "AyINT",
  date: "Bildirim_Tarihi_",
  categoryShort: "Kategori_Adi",
  categoryLong: "Uzun_Kategori_Adi",
  type: "Bildirim_Tipi",
  product: "Urun",
  mainCategory: "Ana_Kategori",
  subCategory: "Alt_Kategori",
  layer: "Katman",
  priority: "Oncelik",
  project: "PROJE",
  supportLevel: "Support_L1_L2",
  rootCause: "Konunun_Kok_Nedeni",
  urgent: "Acil_Ticket",
  description: "Bildirim_Aciklamasi",
  solution: "Cozum_Aciklamasi",
  customerNote: "Musteri_Notu",
  tfsNo: "TfsNo",
  tfsStatus: "TfsDurum",
  tfsType: "TfsTip",
  /** Nokta içeren kolon — query-builder bunu otomatik köşeli parantezle sarar. */
  bugGroup: "Univera.BugGroup"
};
var DEFAULT_SELECT = [
  "id",
  "date",
  "year",
  "monthInt",
  "type",
  "priority",
  "urgent",
  "layer",
  "product",
  "project",
  "categoryShort",
  "categoryLong",
  "mainCategory",
  "subCategory",
  "rootCause",
  "supportLevel",
  "description",
  "solution",
  "customerNote",
  "tfsNo",
  "tfsStatus",
  "tfsType",
  "bugGroup"
];

// server/kb/src/lib/ticket/identifiers.ts
var SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/;
function assertSafeIdentifier(ident) {
  if (!SAFE_IDENT.test(ident)) {
    throw new Error(`G\xFCvensiz SQL identifier reddedildi: ${JSON.stringify(ident)}`);
  }
}
function quoteIdent(ident) {
  assertSafeIdentifier(ident);
  if (ident.includes("]")) {
    throw new Error(`SQL identifier kapal\u0131 parantez i\xE7eremez: ${ident}`);
  }
  return `[${ident}]`;
}
function qualifyTable(schema, name) {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

// server/kb/src/lib/ticket/query-builder.ts
function selectList(cols) {
  return cols.map((key) => {
    const raw = COL[key];
    if (raw.includes(".")) {
      return `${quoteIdent(raw)} AS ${quoteIdent("BugGroup")}`;
    }
    return quoteIdent(raw);
  }).join(", ");
}
var TABLE = qualifyTable(TICKET_VIEW.schema, TICKET_VIEW.name);
function getByIdQuery(bildirimNo, cols = DEFAULT_SELECT) {
  const text = `
    SELECT TOP 1 ${selectList(cols)}
    FROM ${TABLE}
    WHERE ${quoteIdent(COL.id)} = @id
  `;
  return {
    text,
    params: [{ name: "id", type: sql.Int, value: bildirimNo }]
  };
}

// server/kb/src/lib/ticket/resolver.ts
init_env();
async function getById(bildirimNo) {
  if (!Number.isInteger(bildirimNo) || bildirimNo <= 0) {
    throw new Error("Bildirim_No pozitif tamsay\u0131 olmal\u0131.");
  }
  const q = getByIdQuery(bildirimNo);
  const res = await runReadOnly(q.text, q.params);
  return res.rows[0] ?? null;
}

// server/kb/src/lib/ticket/local-store.ts
import Database2 from "better-sqlite3";
import { mkdirSync as mkdirSync2 } from "node:fs";
import path4 from "node:path";
function defaultDbPath2() {
  return path4.resolve(process.cwd(), "data/embeddings.sqlite");
}
var dbInstance2 = null;
function getDb(dbPath) {
  if (dbInstance2) return dbInstance2;
  const finalPath = dbPath ?? defaultDbPath2();
  mkdirSync2(path4.dirname(finalPath), { recursive: true });
  const db = new Database2(finalPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  initSchema2(db);
  dbInstance2 = db;
  return db;
}
function initSchema2(db) {
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
var TICKET_COLS = [
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
  "text_hash"
];
var UPSERT_TICKET_SQL = `
  INSERT INTO tickets (${TICKET_COLS.join(", ")}, synced_at)
  VALUES (${TICKET_COLS.map((c) => `@${c}`).join(", ")}, datetime('now'))
  ON CONFLICT(bildirim_no) DO UPDATE SET
    ${TICKET_COLS.filter((c) => c !== "bildirim_no").map((c) => `${c} = excluded.${c}`).join(",\n    ")},
    synced_at = datetime('now')
`;
function getTicket(bildirimNo) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM tickets WHERE bildirim_no = ?`).get(bildirimNo);
  return row ?? null;
}
function loadAllVectors(model) {
  const db = getDb();
  const rows = db.prepare(`SELECT bildirim_no, vector FROM embeddings WHERE model = ?`).all(model);
  return rows.map((r) => ({
    bildirim_no: r.bildirim_no,
    vector: new Float32Array(
      r.vector.buffer,
      r.vector.byteOffset,
      r.vector.byteLength / 4
    )
  }));
}

// server/kb/src/lib/ticket/similarity.ts
init_env();
init_gemini();
var vectorCache = null;
function getVectors(model) {
  if (vectorCache && vectorCache.model === model) return vectorCache.vectors;
  vectorCache = { model, vectors: loadAllVectors(model) };
  return vectorCache.vectors;
}
function normalize(v) {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}
function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
function eligibleIds(filter) {
  const where = [];
  const params = [];
  if (filter.proje) {
    where.push("proje = ?");
    params.push(filter.proje);
  }
  if (filter.tipi) {
    where.push("bildirim_tipi = ?");
    params.push(filter.tipi);
  }
  if (filter.katman) {
    where.push("katman = ?");
    params.push(filter.katman);
  }
  if (filter.excludeBildirimNo) {
    where.push("bildirim_no <> ?");
    params.push(filter.excludeBildirimNo);
  }
  if (where.length === 0) return null;
  const sql2 = `SELECT bildirim_no FROM tickets WHERE ${where.join(" AND ")}`;
  const rows = getDb().prepare(sql2).all(...params);
  return new Set(rows.map((r) => r.bildirim_no));
}
async function searchSimilarByText(queryText, filter = {}, topK) {
  if (!queryText || queryText.trim().length === 0) return [];
  const e = env();
  const model = e.GEMINI_EMBEDDING_MODEL;
  const k = topK ?? e.TICKET_SIMILARITY_TOPK;
  const queryVec = normalize(new Float32Array(await embed(queryText)));
  const corpus = getVectors(model);
  if (corpus.length === 0) return [];
  const eligible = eligibleIds(filter);
  const hits = [];
  for (const item of corpus) {
    if (eligible && !eligible.has(item.bildirim_no)) continue;
    const normalized = normalize(item.vector);
    const score = dot(queryVec, normalized);
    hits.push({ bildirim_no: item.bildirim_no, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, k);
}

// server/kb/src/lib/ticket/taxonomy.ts
function distinctValues(column, limit = 100) {
  const sql2 = `
    SELECT ${column} AS v, COUNT(*) AS n
    FROM tickets
    WHERE ${column} IS NOT NULL AND TRIM(${column}) <> ''
    GROUP BY ${column}
    ORDER BY n DESC
    LIMIT ?
  `;
  const rows = getDb().prepare(sql2).all(limit);
  return rows.map((r) => r.v);
}
var cached2 = null;
function loadTaxonomy(force = false) {
  if (cached2 && !force) return cached2;
  cached2 = {
    tipler: distinctValues("bildirim_tipi"),
    oncelikler: distinctValues("oncelik"),
    katmanlar: distinctValues("katman"),
    kokNedenler: distinctValues("kok_neden", 200),
    bugGroups: distinctValues("bug_group", 200),
    tfsTipler: distinctValues("tfs_tip")
  };
  return cached2;
}

// server/kb/src/lib/ticket/analyst.ts
init_gemini();
import { z as z5 } from "zod";

// server/kb/src/lib/ticket/prompts.ts
var SYSTEM_INSTRUCTION = `
Sen EnRoute ERP/CRM \xFCr\xFCn\xFCn\xFCn destek hatt\u0131nda \xE7al\u0131\u015Fan k\u0131demli bir destek
analistisin. G\xF6revin: gelen bir bildirim (ticket) i\xE7in k\xF6k neden hipotezleri
\xE7\u0131karmak, ad\u0131m ad\u0131m \xE7\xF6z\xFCm yolu \xF6nermek, m\xFC\u015Fteriye g\xF6nderilebilecek nazik bir
yan\u0131t tasla\u011F\u0131 yazmak ve gerekirse yaz\u0131l\u0131m ekibine aktar\u0131lacak teknik \xF6zeti
\xFCretmektir.

Kurallar:
- T\xFCrk\xE7e yaz; OPERASYONEL ol \u2014 ad\u0131mlarda alan/buton/parametre adlar\u0131n\u0131 A\xC7IK
  \u015Fekilde belirt. Generic "ilgili sekme" gibi mu\u011Flak ifade KULLANMA.
- Verilen benzer ge\xE7mi\u015F kay\u0131tlardaki uygulanm\u0131\u015F \xE7\xF6z\xFCmleri (COZUM) g\xFC\xE7l\xFC
  ipucu olarak kullan; ayn\u0131 kategori + k\xF6k neden e\u015Fle\u015Fmesi varsa onu ad\u0131m
  olarak \xF6ner.
- **PANORAMA KULLANIM KILAVUZU** sa\u011Fland\u0131ysa, "suggestedSteps" alan\u0131n\u0131
  olu\u015Ftururken k\u0131lavuzdaki "Men\xFC Ad\u0131m\u0131" yollar\u0131n\u0131 ve alan/buton adlar\u0131n\u0131
  ADRES OLARAK kullan. M\xFC\u015Fteri yan\u0131t tasla\u011F\u0131na da net "X \u2192 Y \u2192 Z" men\xFC
  yolu eklenmesini tercih et.

  \u26D4 MEN\xDC YOLU KURALLARI \u2014 KES\u0130N:
  1) Bir ekran ad\u0131ndan bahsedeceksen, o ekran\u0131n men\xFC yolunu KILAVUZ
     listesinde verilen "Men\xFC :" sat\u0131r\u0131ndan AYNEN KOPYALA \u2014 bir tek
     karakter de\u011Fi\u015Ftirme.
  2) \u0130ki farkl\u0131 ekran\u0131n men\xFC hiyerar\u015Filerini ASLA KARI\u015ETIRMA. "X \u2192 Y \u2192 Z"
     men\xFC yolunu o yolun ait oldu\u011Fu ekran d\u0131\u015F\u0131nda ba\u015Fka bir ekrana
     YAKI\u015ETIRMA. \xD6rnek hata: ekran A'n\u0131n men\xFCs\xFC "Mod\xFCl1 \u2192 Alt1 \u2192 A" iken,
     ekran B i\xE7in "Mod\xFCl1 \u2192 Alt1 \u2192 B" diye UYDURMA. Her ekran\u0131n kendi
     hiyerar\u015Fisi vard\u0131r; sat\u0131rdan oku, asla T\xDCRETME.
  3) K\u0131lavuzda hi\xE7 bahsi ge\xE7meyen bir ekrana y\xF6nlendireceksen, men\xFC yolu
     YAZMA \u2014 sadece ekran ad\u0131yla ge\xE7 ve [tahmin] etiketi koy.
  4) \u015E\xFCpheli isen men\xFC yolunu s\xF6yleme; "ilgili ekran" diye ge\xE7 + rationale
     i\xE7inde "men\xFC yolu k\u0131lavuzda bulunamad\u0131" notu d\xFC\u015F.

  \u2B50 \u0130LK ADIM (suggestedSteps[0]):
     - K\u0131lavuzdaki [1] numaral\u0131 ekran lexical+kategori skoru ile bu ticket
       i\xE7in ASIL HEDEF olarak hesapland\u0131.
     - E\u011Fer ilk ad\u0131m bir ekrana y\xF6nlendiriyorsa, o ekran KILAVUZ [1]
       OLMALI ve men\xFC yolu [1]'in "Men\xFC :" sat\u0131r\u0131ndan AYNEN kopyalanmal\u0131.
     - [1]'i atlay\u0131p [2]/[3]/[4]'e gitmek YASAK \u2014 bunlar ikincil/alternatif
       yard\u0131mc\u0131lard\u0131r. Sadece [1] sorunun KES\u0130NL\u0130KLE bu ekranla ilgili
       olmad\u0131\u011F\u0131na dair somut kan\u0131t varsa kullan\u0131l\u0131r.
- **B\u0130LG\u0130 BANKASI (KB) ALINTILARI** sa\u011Fland\u0131ysa, \xE7\xF6z\xFCm \xF6nerilerinde bu
  al\u0131nt\u0131lara dayan ve hangi kaynaktan geldi\u011Fini metin i\xE7inde belirt
  (\xF6rn. "(KB#3'e g\xF6re)"). KB d\u0131\u015F\u0131ndan teknik detay UYDURMA. KB ile
  benzer ge\xE7mi\u015F kay\u0131tlar \xE7eli\u015Fiyorsa KB'ye g\xFCven.

SORUYU ANLAMA \u2014 \xC7\u0130FT Y\xD6N:
- "X'i Y'ye BA\u011ELA / ATA / E\u015ELE\u015ET\u0130R" t\xFCr\xFC sorularda **iki olas\u0131 y\xF6n** vard\u0131r:
  (a) X'in ekran\u0131ndan Y referans\u0131 verilir (\xF6rn. Rut Tan\u0131m ekran\u0131nda "Takip Kodu" alan\u0131)
  (b) Y'nin ekran\u0131ndan X eklenir (\xF6rn. Sat\u0131\u015F Temsilcisi kart\u0131nda "Rut Bilgileri" tab)
- Kullan\u0131c\u0131 dilinde s\u0131kl\u0131kla **Y'nin perspektifi** beklenir ("rut'u temsilciye ba\u011Fla"
  \u2192 temsilcinin kart\u0131ndan y\xF6netilen y\xF6ntem daha do\u011Fal).
- KB chunk'lar\u0131nda her iki y\xF6n\xFC de tara; \xF6ncelikle Y'nin (hedefin) ekran\u0131ndaki
  y\xF6ntemi tarif et. Di\u011Fer y\xF6n VARSA "Alternatif y\xF6ntem" olarak ekle.
- Ayn\u0131 sorun i\xE7in sadece bir y\xF6n g\xF6sterip "di\u011Feri yoktur" \u015Feklinde t\u0131kanma \u2014
  KB'de yoksa belirt.

ADIM AYRINTILILI\u011EI (suggestedSteps i\xE7in kritik):
- **3-5 ANA ad\u0131m \xFCret** \u2014 her t\u0131klamay\u0131/alan\u0131 AYRI ad\u0131m yapma. T\xFCm operasyonel
  detay\u0131 (alan/buton/parametre adlar\u0131) ilgili ANA ad\u0131m\u0131n step metnine VEYA
  rationale'\u0131na G\xD6M. Hedef: az ad\u0131m, ama hi\xE7bir detay kaybolmadan.
- Bir ekrana / sekmeye y\xF6nlendiriyorsan, doldurulacak **ANAHTAR ALANLARI ayn\u0131
  ad\u0131m\u0131n i\xE7inde** listele. \xD6rnek tek ad\u0131m: "'Rut Bilgileri' sekmesini a\xE7 ve \u015Fu
  alanlar\u0131 doldur: Rut Kodu, Ba\u015Flang\u0131\xE7 Tarihi, Biti\u015F Tarihi, Frekans, Frekans
  Birimi".
- "X butonuna t\u0131kla" ile butonun a\xE7t\u0131\u011F\u0131 ekran\u0131n alanlar\u0131 **ayn\u0131 ad\u0131mda** birle\u015Fsin;
  ayr\u0131 ad\u0131m a\xE7ma.
- **Ko\u015Fullu davran\u0131\u015Flar\u0131** (parametre etkili oldu\u011Funda i\u015F ak\u0131\u015F\u0131 de\u011Fi\u015Fikli\u011Fi,
  yetki gereksinimi vb.) ilgili ad\u0131m\u0131n rationale'\u0131na ekle. \xD6rn:
  "Merkez Onayl\u0131 Rut \u0130\u015Flemleri Kullan\u0131ls\u0131n M\u0131? parametresi aktifse atama
  y\xF6neticinin onay\u0131na d\xFC\u015Fer".
- Gran\xFClarite hedefi: operat\xF6r 3-5 ad\u0131m\u0131 takip ederek hi\xE7bir tahmin yapmadan i\u015Fi
  tamamlayabilmeli \u2014 detay ad\u0131m\u0131n \u0130\xC7\u0130NDE olsun, ad\u0131m SAYISINDA de\u011Fil.

D\u0130\u011EER:
- Yan\u0131t\u0131 KES\u0130NL\u0130KLE ge\xE7erli bir JSON olarak ver. A\xE7\u0131klama, kod blo\u011Fu, ba\u015F/sona
  metin EKLEME. Sadece JSON.
- Belirsizlik varsa confidence de\u011Ferini d\xFC\u015F\xFCr; uydurma yapma.
- M\xFC\u015Fteri yan\u0131t\u0131 tasla\u011F\u0131nda \xF6z\xFCr/empati c\xFCmlesi olabilir; kibirli olma.
- M\xFChendislik \xF6zeti teknik dili kullanmal\u0131; mod\xFCl ad\u0131, sahnenin nerede
  tetiklendi\u011Fi, beklenen-g\xF6zlemlenen davran\u0131\u015F, varsa muhtemel k\xF6k neden.
- "suggestedBugGroup" ve "suggestedTfsTip" alanlar\u0131 i\xE7in sadece verilen
  taksonomi i\xE7inden se\xE7; uygun bir aday yoksa null b\u0131rak.
`.trim();
var RESPONSE_SCHEMA = `
Beklenen JSON \u015Femas\u0131 (alanlar\u0131 aynen kullan):

{
  "inferred": {                         // Sadece freeText modunda zorunlu;
    "bildirim_tipi": string,            // matched modunda null ge\xE7.
    "oncelik": "Normal" | "Y\xFCksek" | "Kritik",
    "katman": string,
    "kok_neden": string,
    "confidence": number                // 0..1
  } | null,
  "rootCauseHypotheses": [              // 1-4 madde, en olas\u0131 \xF6nce
    { "text": string, "confidence": number }
  ],
  "suggestedSteps": [                   // 3-5 ana ad\u0131m \u2014 operasyonel detay\u0131 koru,
                                        // alan/buton/ko\u015Fullar\u0131 ad\u0131m\u0131n \u0130\xC7\u0130NE g\xF6m
    { "step": string, "rationale": string | null }
  ],
  "customerReplyDraft": string,         // T\xFCrk\xE7e, en fazla 6 c\xFCmle
  "engineeringHandoff": string,         // T\xFCrk\xE7e, k\u0131sa teknik \xF6zet (4-8 c\xFCmle)
  "suggestedBugGroup": string | null,
  "suggestedTfsTip": string | null,

  // \u2500\u2500\u2500 KAYNAK-AYRIMLI REHBERL\u0130K \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Bu iki alan, hangi KB kayna\u011F\u0131n\u0131n analizine ne katt\u0131\u011F\u0131n\u0131 g\xF6sterir.
  // KURAL: yaln\u0131zca verilen al\u0131nt\u0131lara dayan; ba\u015Fka kaynak/uydurmaca yok.
  // \u0130lgili b\xF6l\xFCmde al\u0131nt\u0131 yoksa veya soruyla ba\u011Flant\u0131 kuram\u0131yorsan null b\u0131rak;
  //   - null demek "bu kaynakta ilgili bilgi yok" anlam\u0131na gelir.
  //   - Bo\u015F string ya da "bilgi yok" diye yazma; sadece null kullan.
  //
  // n4bGuidance: yaln\u0131zca [N4B#] al\u0131nt\u0131lar\u0131na dayanan, 2-6 c\xFCmlelik bir
  //   rehberlik \xF6zeti. Do\u011Frudan operat\xF6r notuna referans verin
  //   ("\xC7\xF6z\xFCm Notu #24'te belirtildi\u011Fi gibi\u2026" gibi). Notta cevap yoksa null.
  //
  // otherDocsGuidance: yaln\u0131zca [DOC#] al\u0131nt\u0131lar\u0131na dayanan, 2-6 c\xFCmlelik
  //   bir rehberlik \xF6zeti. Kaynak t\xFCr\xFCn\xFC c\xFCmle i\xE7inde belirt
  //   ("Panorama 7.3 farklar dok\xFCman\u0131na g\xF6re\u2026", "Bildirim #3247xxxx
  //   \xE7\xF6z\xFCm\xFCnde\u2026"). \u0130lgili bilgi yoksa null.
  "n4bGuidance": string | null,
  "otherDocsGuidance": string | null
}
`.trim();
function formatTicket(t) {
  if (!t) return "(yok)";
  const get = (rowKey, localKey) => {
    const anyT = t;
    const v = anyT[rowKey] ?? anyT[localKey];
    return v == null ? "-" : String(v);
  };
  return [
    `Bildirim_No   : ${get("Bildirim_No", "bildirim_no")}`,
    `Tarih         : ${get("Bildirim_Tarihi_", "bildirim_tarihi")}`,
    `Tipi          : ${get("Bildirim_Tipi", "bildirim_tipi")}`,
    `Oncelik       : ${get("Oncelik", "oncelik")}`,
    `Acil          : ${get("Acil_Ticket", "acil_ticket")}`,
    `Katman        : ${get("Katman", "katman")}`,
    `Urun          : ${get("Urun", "urun")}`,
    `Proje         : ${get("PROJE", "proje")}`,
    `Kategori      : ${get("Uzun_Kategori_Adi", "kategori_uzun")}`,
    `Kok Neden     : ${get("Konunun_Kok_Nedeni", "kok_neden")}`,
    `BugGroup      : ${get("BugGroup", "bug_group")}`,
    `TfsTip        : ${get("TfsTip", "tfs_tip")}`,
    ``,
    `--- Aciklama ---`,
    get("Bildirim_Aciklamasi", "aciklama"),
    ``,
    `--- Cozum (ge\xE7mi\u015F kay\u0131t) ---`,
    get("Cozum_Aciklamasi", "cozum")
  ].join("\n");
}
function formatSimilar(items) {
  if (items.length === 0) return "(benzer kay\u0131t bulunamad\u0131)";
  return items.map((s, i) => {
    const lines = [
      `[${i + 1}] #${s.bildirim_no}  skor=${s.score.toFixed(3)}  proje=${s.proje ?? "-"}`,
      `    kategori : ${s.kategori_uzun ?? "-"}`,
      `    kok_neden: ${s.kok_neden ?? "-"}`,
      `    bug_grup : ${s.bug_group ?? "-"}   tfs_tip: ${s.tfs_tip ?? "-"}`,
      `    aciklama : ${truncate(s.aciklama, 400)}`,
      `    cozum    : ${truncate(s.cozum, 400)}`
    ];
    return lines.join("\n");
  }).join("\n\n");
}
function truncate(s, n) {
  if (!s) return "-";
  return s.length > n ? s.slice(0, n) + "\u2026" : s;
}
function formatKbChunks(chunks, prefix) {
  if (!chunks || chunks.length === 0) {
    return prefix === "N4B" ? "(N4B operat\xF6r \xE7\xF6z\xFCm notlar\u0131nda ilgili kay\u0131t bulunamad\u0131)" : "(di\u011Fer d\xF6k\xFCmanlarda ilgili kay\u0131t bulunamad\u0131)";
  }
  return chunks.map((c) => {
    const head = `[${prefix}#${c.number}] ${c.title ?? c.heading_path ?? "(ba\u015Fl\u0131ks\u0131z)"} \xB7 ${c.source_type}`;
    return `${head}
${truncate(c.excerpt, 600)}`;
  }).join("\n\n");
}
function formatPanoramaScreens(screens) {
  if (!screens || screens.length === 0) return "(k\u0131lavuz \xF6nerisi yok)";
  return screens.map((s, i) => {
    const fields = s.fields.slice(0, 6).map((f) => f.name).filter(Boolean).join(", ");
    const buttons = s.buttons.slice(0, 6).map((b) => b.name).filter(Boolean).join(", ");
    const lines = [
      `[${i + 1}] ${s.title}`,
      `    Men\xFC     : ${s.menuStep ?? "\u2014"}`
    ];
    if (s.summary) lines.push(`    A\xE7\u0131klama : ${truncate(s.summary, 200)}`);
    if (fields) lines.push(`    Alanlar  : ${fields}`);
    if (buttons) lines.push(`    Butonlar : ${buttons}`);
    return lines.join("\n");
  }).join("\n\n");
}
function formatTaxonomy(tx) {
  const limit = 50;
  return [
    `Bildirim_Tipi adaylar\u0131   : ${tx.tipler.slice(0, 8).join(" | ") || "-"}`,
    `Oncelik adaylar\u0131         : ${tx.oncelikler.slice(0, 5).join(" | ") || "-"}`,
    `Katman adaylar\u0131          : ${tx.katmanlar.slice(0, 8).join(" | ") || "-"}`,
    `Kok_Neden adaylar\u0131       : ${tx.kokNedenler.slice(0, limit).join(" | ") || "-"}`,
    `BugGroup adaylar\u0131        : ${tx.bugGroups.slice(0, limit).join(" | ") || "-"}`,
    `TfsTip adaylar\u0131          : ${tx.tfsTipler.slice(0, 8).join(" | ") || "-"}`
  ].join("\n");
}
function buildAnalystCachePrefix(inputs) {
  return [
    `=== Taksonomi (sadece bu listelerden de\u011Fer se\xE7) ===`,
    formatTaxonomy(inputs.taxonomy),
    ``,
    `=== \xC7\u0131kt\u0131 \u015Eemas\u0131 ===`,
    RESPONSE_SCHEMA
  ].join("\n");
}
function buildUserPrompt(inputs) {
  const mode = inputs.matched ? "BILDIRIM_NO" : "SERBEST_METIN";
  const sections = [
    `MOD: ${mode}`,
    ``,
    `=== Mevcut Bildirim Kayd\u0131 ===`,
    formatTicket(inputs.matched)
  ];
  if (inputs.freeText) {
    sections.push(``, `=== Kullan\u0131c\u0131n\u0131n Yazd\u0131\u011F\u0131 Sorun ===`, inputs.freeText);
  }
  sections.push(
    ``,
    `=== Benzer Ge\xE7mi\u015F Kay\u0131tlar (en yak\u0131n -> en uzak) ===`,
    formatSimilar(inputs.similar),
    ``,
    `=== Panorama Kullan\u0131m K\u0131lavuzu \u2014 \u0130lgili Ekranlar ===`,
    formatPanoramaScreens(inputs.panoramaScreens),
    ``,
    `=== Bilgi Bankas\u0131 \u2014 N4B Operat\xF6r \xC7\xF6z\xFCm Notlar\u0131 ===`,
    `(yaln\u0131z bu blo\u011Fa dayanarak n4bGuidance \xFCret; aksi halde null b\u0131rak)`,
    formatKbChunks(inputs.kbChunksN4b, "N4B"),
    ``,
    `=== Bilgi Bankas\u0131 \u2014 Di\u011Fer D\xF6k\xFCmanlar (K\u0131lavuz / Ticket Ge\xE7mi\u015Fi / PDF) ===`,
    `(yaln\u0131z bu blo\u011Fa dayanarak otherDocsGuidance \xFCret; aksi halde null b\u0131rak)`,
    formatKbChunks(inputs.kbChunksOther, "DOC"),
    ``,
    `=== G\xF6rev ===`,
    `Yukar\u0131da verilen taksonomi ve JSON \u015Femas\u0131na uyarak, bu bilgiyle yaln\u0131zca`,
    `o \u015Femaya uygun bir yan\u0131t \xFCret.`,
    `Markdown, kod blo\u011Fu, a\xE7\u0131klama metni EKLEME. Sadece ge\xE7erli JSON d\xF6nd\xFCr.`
  );
  return sections.join("\n");
}

// server/kb/src/lib/ticket/analyst.ts
var HypothesisSchema = z5.object({
  text: z5.string(),
  confidence: z5.number().min(0).max(1)
});
var StepSchema = z5.object({
  step: z5.string(),
  rationale: z5.string().nullable().optional()
});
var InferredSchema = z5.object({
  bildirim_tipi: z5.string(),
  oncelik: z5.enum(["Normal", "Y\xFCksek", "Kritik"]),
  katman: z5.string(),
  kok_neden: z5.string(),
  confidence: z5.number().min(0).max(1)
}).nullable();
var AnalystOutputSchema = z5.object({
  inferred: InferredSchema,
  rootCauseHypotheses: z5.array(HypothesisSchema).min(1).max(6),
  suggestedSteps: z5.array(StepSchema).min(1).max(6),
  customerReplyDraft: z5.string().min(1),
  engineeringHandoff: z5.string().min(1),
  suggestedBugGroup: z5.string().nullable().optional().default(null),
  suggestedTfsTip: z5.string().nullable().optional().default(null),
  // Kaynak-ayrımlı rehberlik. Bu sayede analyst'in N4B operatör çözüm
  // notlarını gerçekten kullanıp kullanmadığı görsel olarak izlenebilir.
  // null gelirse UI "Bu kaynakta ilgili bilgi yok" şeklinde gösterir.
  n4bGuidance: z5.string().nullable().optional().default(null),
  otherDocsGuidance: z5.string().nullable().optional().default(null)
});
function extractJson4(raw) {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    s = s.slice(first, last + 1);
  }
  return s.trim();
}
async function runAnalyst(inputs) {
  const userPrompt = buildUserPrompt(inputs);
  const cachePrefix = buildAnalystCachePrefix(inputs);
  const response = await generate(SYSTEM_INSTRUCTION, userPrompt, {
    temperature: 0.2,
    // DİKKAT: 4096'ya indirmek HATAYDI — detaylı Türkçe çıktı (6 hipotez +
    // operasyonel adımlar + 2 taslak + 2 rehberlik) 4096'yı aşınca truncate
    // oluyor → JSON parse fail → TÜM analyze çöküyor (çözüm adımları + taslaklar
    // gelmiyor). 8192 orijinal güvenli üst sınır; geri alındı.
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
    cachePrefix
  });
  const cleaned = extractJson4(response.text);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Analist \xE7\u0131kt\u0131s\u0131 JSON olarak parse edilemedi: ${err.message}
---
${response.text.slice(0, 800)}`
    );
  }
  const validated = AnalystOutputSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Analist \xE7\u0131kt\u0131s\u0131 \u015Femaya uymad\u0131: ${issues}`);
  }
  return {
    ...validated.data,
    meta: {
      modelUsed: response.modelUsed,
      latencyMs: response.latencyMs,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      costUsd: response.costUsd
    }
  };
}

// server/kb/src/lib/ticket/panorama-docs.ts
import { existsSync, readFileSync as readFileSync3 } from "node:fs";
import path5 from "node:path";
var ROOT = () => path5.resolve(process.cwd(), "data", "panorama-docs");
var screensCache = null;
var mappingCache = null;
var screenIndexCache = null;
function loadJson(file) {
  const p = path5.join(ROOT(), file);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync3(p, "utf8"));
  } catch {
    return null;
  }
}
function loadAllScreens() {
  if (screensCache) return screensCache;
  screensCache = loadJson("screens.json") ?? [];
  screenIndexCache = new Map(screensCache.map((s) => [s.id, s]));
  return screensCache;
}
function loadCategoryMapping() {
  if (mappingCache) return mappingCache;
  mappingCache = loadJson("category-mapping.json") ?? {};
  return mappingCache;
}
function getScreen(id) {
  if (!screenIndexCache) loadAllScreens();
  return screenIndexCache?.get(id) ?? null;
}
function tokenize(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9çğıöşü\s]+/g, " ").split(/\s+/).filter((t) => t.length >= 3);
}
function searchScreens(query, opts = {}) {
  const screens = loadAllScreens();
  const q = tokenize(query);
  if (q.length === 0) return [];
  const limit = opts.limit ?? 6;
  const allow = opts.restrictTo ? new Set(opts.restrictTo) : null;
  const boost = opts.boostSet ? new Set(opts.boostSet) : null;
  const out = [];
  for (const s of screens) {
    if (allow && !allow.has(s.id)) continue;
    const titleLower = (s.title ?? "").toLowerCase();
    const crumbLower = s.breadcrumb.join(" ").toLowerCase();
    const rawLower = s.rawText.toLowerCase();
    let score = 0;
    for (const t of q) {
      if (titleLower.includes(t)) score += 3;
      if (crumbLower.includes(t)) score += 2;
      if (rawLower.includes(t)) score += 1;
    }
    if (score > 0) {
      if (boost && boost.has(s.id)) score += 2;
      out.push({ screen: s, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
function recommendScreensForTicket(args) {
  const limit = args.limit ?? 4;
  const text = args.text?.trim() ?? "";
  const pool = args.categoryId ? loadCategoryMapping()[args.categoryId] ?? null : null;
  if (!text && pool) {
    return pool.slice(0, limit).map((id) => getScreen(id)).filter((s) => s !== null);
  }
  const hits = searchScreens(text, {
    limit,
    ...pool ? { boostSet: pool } : {}
  });
  if (hits.length === 0 && pool) {
    return pool.slice(0, limit).map((id) => getScreen(id)).filter((s) => s !== null);
  }
  return hits.map((h) => h.screen);
}
function detectMentionedScreens(text) {
  if (!text || text.trim().length === 0) return [];
  const screens = loadAllScreens();
  const norm = text.replaceAll("\u0130", "I").replaceAll("\u0131", "i").replaceAll("\u011E", "G").replaceAll("\u011F", "g").replaceAll("\xDC", "U").replaceAll("\xFC", "u").replaceAll("\u015E", "S").replaceAll("\u015F", "s").replaceAll("\xD6", "O").replaceAll("\xF6", "o").replaceAll("\xC7", "C").replaceAll("\xE7", "c").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ");
  const found = [];
  const seen = /* @__PURE__ */ new Set();
  for (const s of screens) {
    if (!s.title) continue;
    const titleNorm = s.title.replaceAll("\u0130", "I").replaceAll("\u0131", "i").replaceAll("\u011E", "G").replaceAll("\u011F", "g").replaceAll("\xDC", "U").replaceAll("\xFC", "u").replaceAll("\u015E", "S").replaceAll("\u015F", "s").replaceAll("\xD6", "O").replaceAll("\xF6", "o").replaceAll("\xC7", "C").replaceAll("\xE7", "c").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    if (titleNorm.length < 8) continue;
    if (norm.includes(titleNorm) && !seen.has(s.id)) {
      seen.add(s.id);
      found.push({ screen: s, titleLen: titleNorm.length });
    }
  }
  found.sort((a, b) => b.titleLen - a.titleLen);
  return found.map((f) => f.screen);
}

// server/kb/src/lib/ticket/menu-validator.ts
var MENU_PATH_REGEX = /([A-ZÇĞİÖŞÜ][\p{L}\p{N} .'/\-]*(?:\s*→\s*[A-ZÇĞİÖŞÜ][\p{L}\p{N} .'/\-]*){1,5})/gu;
function stripTrailingVerb(path9) {
  const segments = path9.split("\u2192").map((s) => s.trim());
  const last = segments[segments.length - 1] ?? "";
  const BOUND = `(?:\\s|[\\.,;:!?'"\\)]|$)`;
  const cleaned = last.replace(
    new RegExp(
      `\\s+(men\xFCs\xFCne|men\xFCs\xFCn\xFC|men\xFCs\xFC|men\xFCs\xFCnden|ekran\u0131na|ekran\u0131n\u0131|ekran\u0131|ekran\u0131ndan|sayfas\u0131na|sayfas\u0131n\u0131|sayfas\u0131|sayfas\u0131ndan|tab'\u0131na|tab'\u0131n\u0131)\\s+(git|a\xE7|gir|t\u0131kla|ge\xE7|y\xF6nlen|a\xE7\u0131l(?:\u0131r|\u0131n)?)${BOUND}.*$`,
      "iu"
    ),
    ""
  ).replace(
    new RegExp(
      `\\s+(men\xFCs\xFCne|men\xFCs\xFCn\xFC|men\xFCs\xFC|ekran\u0131na|ekran\u0131n\u0131|ekran\u0131|sayfas\u0131na|sayfas\u0131n\u0131|sayfas\u0131)\\.?\\s*$`,
      "iu"
    ),
    ""
  ).replace(
    new RegExp(`\\s+(git|a\xE7|gir|t\u0131kla|ge\xE7|y\xF6nlen)\\s*\\.?\\s*$`, "iu"),
    ""
  ).replace(/[\.,;:]+$/u, "").trim();
  segments[segments.length - 1] = cleaned;
  return segments.join(" \u2192 ");
}
function normalize2(s) {
  return s.replaceAll("\u0130", "I").replaceAll("\u0131", "i").replaceAll("\u011E", "G").replaceAll("\u011F", "g").replaceAll("\xDC", "U").replaceAll("\xFC", "u").replaceAll("\u015E", "S").replaceAll("\u015F", "s").replaceAll("\xD6", "O").replaceAll("\xF6", "o").replaceAll("\xC7", "C").replaceAll("\xE7", "c").toLowerCase().replace(/\s+/g, " ").replace(/\s*→\s*/g, " > ").trim();
}
var pathIndexCache = null;
function getPathIndex() {
  if (pathIndexCache) return pathIndexCache;
  const screens = loadAllScreens();
  const exact = /* @__PURE__ */ new Set();
  const byLeafTitle = /* @__PURE__ */ new Map();
  for (const s of screens) {
    if (s.menuStep) exact.add(normalize2(s.menuStep));
    if (s.title) byLeafTitle.set(normalize2(s.title), s);
  }
  pathIndexCache = { exact, byLeafTitle };
  return pathIndexCache;
}
function checkMenuPath(claimedPath) {
  const cleaned = stripTrailingVerb(claimedPath);
  const norm = normalize2(cleaned);
  const idx = getPathIndex();
  if (idx.exact.has(norm)) {
    return { raw: claimedPath, valid: true };
  }
  const segments = norm.split(" > ");
  const leaf = segments[segments.length - 1] ?? "";
  const screen = idx.byLeafTitle.get(leaf);
  if (screen?.menuStep) {
    return { raw: claimedPath, valid: false, suggestion: screen.menuStep };
  }
  return { raw: claimedPath, valid: false, suggestion: null };
}
function validateAndAnnotateSteps(steps) {
  const corrections = [];
  const fixed = steps.map((s, i) => {
    const stepText = s.step;
    const matches = [...stepText.matchAll(MENU_PATH_REGEX)];
    if (matches.length === 0) return s;
    let newStep = stepText;
    const noteParts = [];
    for (const m of matches) {
      const claimed = m[1];
      if (!claimed) continue;
      const segs = claimed.split("\u2192").map((x) => x.trim());
      if (segs.length < 2) continue;
      const check = checkMenuPath(claimed);
      if (check.valid) continue;
      const cleanedClaimed = stripTrailingVerb(claimed);
      if (check.suggestion) {
        newStep = newStep.replace(cleanedClaimed, check.suggestion);
        noteParts.push(
          `(men\xFC yolu d\xFCzeltildi: "${cleanedClaimed}" \u2192 "${check.suggestion}")`
        );
      } else {
        newStep = newStep.replace(cleanedClaimed, `${cleanedClaimed} [tahmin]`);
        noteParts.push(`(men\xFC yolu "${cleanedClaimed}" panorama k\u0131lavuzunda bulunamad\u0131)`);
      }
      corrections.push({
        stepIndex: i,
        claimedPath: claimed.trim(),
        suggestion: check.suggestion ?? null
      });
    }
    if (noteParts.length === 0) return s;
    const merged = [s.rationale ?? "", ...noteParts].map((x) => x.trim()).filter((x) => x.length > 0).join(" ");
    return {
      ...s,
      step: newStep,
      rationale: merged.length > 0 ? merged : null
    };
  });
  return { fixed, corrections };
}
function ensureMentionedScreenFirst(steps, description) {
  if (!description || steps.length === 0) {
    return { steps, changed: false, targetScreenTitle: null };
  }
  const mentioned = detectMentionedScreens(description);
  if (mentioned.length === 0) {
    return { steps, changed: false, targetScreenTitle: null };
  }
  const target = mentioned[0];
  if (!target) {
    return { steps, changed: false, targetScreenTitle: null };
  }
  const targetTitle = target.title ?? "";
  const targetMenu = target.menuStep ?? "";
  if (!targetTitle && !targetMenu) {
    return { steps, changed: false, targetScreenTitle: null };
  }
  const refersToTarget = (text) => {
    if (!text) return false;
    if (targetMenu && text.includes(targetMenu)) return true;
    if (targetTitle && text.includes(targetTitle)) return true;
    return false;
  };
  const firstStep = steps[0];
  if (firstStep && refersToTarget(firstStep.step)) {
    return { steps, changed: false, targetScreenTitle: targetTitle };
  }
  const idx = steps.findIndex((s, i) => i > 0 && refersToTarget(s.step));
  if (idx > 0) {
    const moved = steps[idx];
    if (!moved) return { steps, changed: false, targetScreenTitle: targetTitle };
    const reordered = [
      moved,
      ...steps.filter((_, i) => i !== idx)
    ];
    return { steps: reordered, changed: true, targetScreenTitle: targetTitle };
  }
  const newFirst = {
    step: targetMenu ? `${targetMenu} men\xFCs\xFCne git.` : `${targetTitle} ekran\u0131n\u0131 a\xE7.`,
    rationale: "Sorun a\xE7\u0131klamas\u0131nda bu ekrandan do\u011Frudan bahsedildi; ilk ad\u0131m olarak hedef al\u0131nd\u0131."
  };
  return {
    steps: [newFirst, ...steps],
    changed: true,
    targetScreenTitle: targetTitle
  };
}

// server/kb/src/lib/ticket/redactor.ts
var PATTERNS = [
  { kind: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, mask: "<EMAIL>" },
  { kind: "iban", re: /\bTR\d{2}[\s-]?(?:\d{4}[\s-]?){5}\d{2}\b/gi, mask: "<IBAN>" },
  { kind: "card", re: /\b(?:\d[\s-]?){12,18}\d\b/g, mask: "<CARD>" },
  { kind: "tckn", re: /\b[1-9]\d{10}\b/g, mask: "<TCKN>" },
  {
    kind: "phone",
    // +90 5XX XXX XX XX  |  +90 (0XXX) XXX XX XX  |  05XX XXX XX XX
    re: /(?:\+?90[\s.-]?)?(?:\(0\d{3}\)|0?\d{3})[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/g,
    mask: "<TEL>"
  },
  // 5+ haneli düz sayı dizileri (sipariş/fatura no riski)
  { kind: "longnum", re: /\b\d{5,}\b/g, mask: "<NUM>" }
];
function redact(input) {
  if (!input) return { text: "", redactions: [] };
  let text = input;
  const redactions = [];
  for (const { kind, re, mask } of PATTERNS) {
    text = text.replace(re, (m) => {
      redactions.push({ kind, raw: m, placeholder: mask });
      return mask;
    });
  }
  return { text, redactions };
}

// server/kb/src/lib/ticket/anonymizer.ts
import { readFileSync as readFileSync4, existsSync as existsSync2 } from "node:fs";
import path6 from "node:path";
var cache2 = null;
function blocklistPath() {
  return path6.resolve(process.cwd(), "data/customer-blocklist.json");
}
function normalizeForMatch(s) {
  return s.replaceAll("\u0130", "I").replaceAll("\u0131", "i").replaceAll("\u011E", "G").replaceAll("\u011F", "g").replaceAll("\xDC", "U").replaceAll("\xFC", "u").replaceAll("\u015E", "S").replaceAll("\u015F", "s").replaceAll("\xD6", "O").replaceAll("\xF6", "o").replaceAll("\xC7", "C").replaceAll("\xE7", "c").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function load2() {
  if (cache2) return cache2;
  const p = blocklistPath();
  if (!existsSync2(p)) {
    throw new Error(
      "M\xFC\u015Fteri blocklist'i yok. \xC7al\u0131\u015Ft\u0131r: node scripts/build-customer-blocklist.mjs"
    );
  }
  const list = JSON.parse(readFileSync4(p, "utf8"));
  const needles = [];
  for (const c of list.customers) {
    if (c.normalized.length < 3) continue;
    const escaped = c.normalized.split(" ").map(escapeRegex).join("\\s+");
    needles.push({
      canonical: c.canonical,
      // \b ASCII word-boundary; normalize edilmiş metin zaten ASCII.
      pattern: new RegExp(`\\b${escaped}\\b`, "i")
    });
  }
  let suffixPattern = null;
  if (list.companySuffixes?.length) {
    const sufAlt = list.companySuffixes.map((s) => escapeRegex(s.replace(/\s+/g, " ").trim())).join("|");
    suffixPattern = new RegExp(
      `\\b(?:[A-Z\xC7\u011E\u0130\xD6\u015E\xDC][\\w\xC7\u011E\u0130\xD6\u015E\xDC\xE7\u011F\u0131\xF6\u015F\xFC\\.]+\\s+){0,4}(?:${sufAlt})\\b`,
      "g"
    );
  }
  cache2 = { list, needles, suffixPattern };
  return cache2;
}
function detectCustomerNames(input) {
  if (!input || !input.trim()) return { hit: false, matches: [] };
  const { needles } = load2();
  const norm = normalizeForMatch(input);
  const matches = [];
  for (const n of needles) {
    if (n.pattern.test(norm)) matches.push(n.canonical);
  }
  return { hit: matches.length > 0, matches };
}
function anonymizeCustomers(input) {
  if (!input) return { text: "", redactions: [] };
  const { needles } = load2();
  const redactions = [];
  let text = normalizeForMatch(input);
  for (const n of needles) {
    const gre = new RegExp(n.pattern.source, "gi");
    text = text.replace(gre, (m) => {
      redactions.push({ kind: "musteri", raw: m });
      return "<MUSTERI>";
    });
  }
  return { text, redactions };
}
var CustomerSearchBlockedError = class extends Error {
  matches;
  constructor(matches) {
    super("M\xFC\u015Fteri bazl\u0131 arama desteklenmiyor.");
    this.name = "CustomerSearchBlockedError";
    this.matches = matches;
  }
};
function assertNoCustomerName(text) {
  const d = detectCustomerNames(text);
  if (d.hit) throw new CustomerSearchBlockedError(d.matches);
}

// server/kb/src/lib/ticket/storage.ts
import { mkdirSync as mkdirSync3, readdirSync, readFileSync as readFileSync5, writeFileSync, appendFileSync, existsSync as existsSync3 } from "node:fs";
import path7 from "node:path";
import { createHash, randomBytes } from "node:crypto";
var ROOT2 = () => path7.resolve(process.cwd(), "data");
function analysisDir(analysisId) {
  return path7.join(ROOT2(), "ticket-analysis", analysisId);
}
function slugify(s) {
  return s.toLowerCase().replace(
    /[ığşöçü]/g,
    (c) => ({ \u0131: "i", \u011F: "g", \u015F: "s", \u00F6: "o", \u00E7: "c", \u00FC: "u" })[c] ?? c
  ).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
function newAnalysisId(seed) {
  const hash = createHash("sha256").update(seed ?? randomBytes(8)).digest("hex").slice(0, 6);
  const slug = seed ? slugify(seed) : randomBytes(4).toString("hex");
  const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
  return `${stamp}-${slug || "analiz"}-${hash}`;
}
function saveAnalysis(rec) {
  const dir = analysisDir(rec.meta.analysisId);
  mkdirSync3(dir, { recursive: true });
  writeFileSync(path7.join(dir, "meta.json"), JSON.stringify(rec.meta, null, 2));
  writeFileSync(path7.join(dir, "input.json"), JSON.stringify(rec.input, null, 2));
  writeFileSync(path7.join(dir, "analysis.json"), JSON.stringify(rec.analysis, null, 2));
  return rec.meta.analysisId;
}

// server/kb/src/lib/ticket/recategorizer.ts
import {
  existsSync as existsSync4,
  readFileSync as readFileSync6
} from "node:fs";
import path8 from "node:path";
var ROOT3 = () => path8.resolve(process.cwd(), "data", "topics-v2");
function loadBundle() {
  const r = ROOT3();
  if (!existsSync4(path8.join(r, "meta.json"))) return null;
  try {
    const meta = JSON.parse(readFileSync6(path8.join(r, "meta.json"), "utf8"));
    const categories = JSON.parse(
      readFileSync6(path8.join(r, "taxonomy.json"), "utf8")
    );
    const assignments = JSON.parse(
      readFileSync6(path8.join(r, "assignments.json"), "utf8")
    );
    return { meta, categories, assignments };
  } catch {
    return null;
  }
}

// server/kb/src/lib/ticket/notebooklm.ts
init_env();

// server/kb/src/lib/notebooklm/client.ts
init_env();
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
var GLOBAL_KEY = "__notebooklm_mcp_client__";
var globalAny = globalThis;
function getCache() {
  return globalAny[GLOBAL_KEY] ?? null;
}
function setCache(state) {
  globalAny[GLOBAL_KEY] = state;
}
async function connect() {
  const cfg = env();
  const childEnv = {};
  const passthrough = [
    "HOME",
    "USER",
    "PATH",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "DISPLAY",
    // Linux X11 için
    "XDG_DATA_HOME",
    "XDG_CONFIG_HOME",
    "HEADLESS"
  ];
  for (const k of passthrough) {
    const v = process.env[k];
    if (v) childEnv[k] = v;
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("NOTEBOOKLM_") && v) childEnv[k] = v;
  }
  const transport = new StdioClientTransport({
    command: cfg.NOTEBOOKLM_MCP_COMMAND,
    args: cfg.NOTEBOOKLM_MCP_ARGS,
    env: childEnv,
    stderr: "inherit"
  });
  const client = new Client(
    {
      name: "ticket-analiz",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );
  transport.onclose = () => {
    const cur = getCache();
    if (cur && cur.transport === transport) {
      setCache(null);
    }
  };
  transport.onerror = (err) => {
    console.warn("[notebooklm-mcp] transport error:", err.message);
  };
  await client.connect(transport);
  const state = { client, transport, connecting: null };
  setCache(state);
  return client;
}
async function getClient() {
  const cached3 = getCache();
  if (cached3?.connecting) return cached3.connecting;
  if (cached3?.client) return cached3.client;
  const connecting = connect();
  setCache({
    client: null,
    transport: null,
    connecting
  });
  try {
    return await connecting;
  } catch (err) {
    setCache(null);
    throw err;
  }
}
async function callTool(name, args, opts = {}) {
  const cfg = env();
  const timeout = opts.timeoutMs ?? cfg.NOTEBOOKLM_TIMEOUT_MS;
  const client = await getClient();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const result = await client.callTool(
      { name, arguments: args },
      // Default result schema (CallToolResultSchema) is fine — we'll cast.
      void 0,
      { signal: ac.signal, timeout }
    );
    return result;
  } finally {
    clearTimeout(timer);
  }
}
function extractTextPayload(result) {
  const first = result?.content?.find((c) => c.type === "text");
  if (!first?.text) {
    if (result?.structuredContent) return result.structuredContent;
    return null;
  }
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}

// server/kb/src/lib/ticket/notebooklm.ts
var NotebookLmDisabledError = class extends Error {
  constructor() {
    super(
      "NotebookLM devre d\u0131\u015F\u0131. NOTEBOOKLM_ENABLED=true yap ve NOTEBOOKLM_NOTEBOOK_ID (veya _URL) ayarla."
    );
    this.name = "NotebookLmDisabledError";
  }
};
var NotebookLmCallError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "NotebookLmCallError";
  }
};
function isNotebookLmEnabled() {
  const cfg = env();
  if (!cfg.NOTEBOOKLM_ENABLED) return false;
  return Boolean(cfg.NOTEBOOKLM_NOTEBOOK_ID || cfg.NOTEBOOKLM_NOTEBOOK_URL);
}
var FLAKY_PATTERNS = [
  /could not find notebooklm chat input/i,
  /notebook page has loaded/i,
  /notebook url is required/i
];
function isFlakyError(msg) {
  if (!msg) return false;
  return FLAKY_PATTERNS.some((p) => p.test(msg));
}
var MAX_RETRIES = 3;
var RETRY_DELAY_MS = 3500;
function sleep2(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function askQuestionOnce(args) {
  if (!isNotebookLmEnabled()) throw new NotebookLmDisabledError();
  const cfg = env();
  const toolArgs = {
    question: args.question,
    source_format: args.sourceFormat ?? "footnotes"
  };
  if (cfg.NOTEBOOKLM_NOTEBOOK_ID) {
    toolArgs.notebook_id = cfg.NOTEBOOKLM_NOTEBOOK_ID;
  } else if (cfg.NOTEBOOKLM_NOTEBOOK_URL) {
    toolArgs.notebook_url = cfg.NOTEBOOKLM_NOTEBOOK_URL;
  }
  if (args.sessionId) toolArgs.session_id = args.sessionId;
  const startedAt = Date.now();
  const raw = await callTool(
    "ask_question",
    toolArgs
  );
  const payload = extractTextPayload(raw);
  if (!payload || typeof payload === "string") {
    throw new NotebookLmCallError(
      `NotebookLM beklenmeyen yan\u0131t verdi: ${String(payload).slice(0, 200)}`
    );
  }
  if (payload.success === false) {
    throw new NotebookLmCallError(
      `NotebookLM ask_question ba\u015Far\u0131s\u0131z: ${payload.error ?? "(error yok)"}`
    );
  }
  const data = payload.data;
  if (!data?.answer) {
    throw new NotebookLmCallError(
      "NotebookLM yan\u0131t\u0131nda 'answer' alan\u0131 yok."
    );
  }
  return {
    question: data.question ?? args.question,
    answer: data.answer,
    sessionId: data.session_id ?? null,
    notebookUrl: data.notebook_url ?? null,
    sources: data.sources ?? [],
    latencyMs: Date.now() - startedAt
  };
}
async function askQuestion(args) {
  let lastErr = null;
  let sessionId = args.sessionId ?? null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(
          `[notebooklm] retry ${attempt}/${MAX_RETRIES} (sessionId=${sessionId ?? "(yok)"})`
        );
      }
      return await askQuestionOnce({ ...args, sessionId });
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[notebooklm] attempt ${attempt + 1} failed: ${msg.slice(0, 200)}`
      );
      if (!isFlakyError(msg)) throw err;
      if (attempt === MAX_RETRIES) break;
      try {
        const listRaw = await callTool("list_sessions", {});
        const listPayload = extractTextPayload(listRaw);
        const sess = listPayload?.data?.sessions?.[0];
        if (sess?.id) {
          sessionId = sess.id;
          console.log(`[notebooklm] reusing session ${sessionId}`);
        }
      } catch {
      }
      await sleep2(RETRY_DELAY_MS);
    }
  }
  throw lastErr instanceof Error ? lastErr : new NotebookLmCallError(String(lastErr));
}
async function consultForTicket(ctx, opts = {}) {
  const aciklama = (ctx.freeText ?? ctx.aciklama ?? "").trim();
  if (!aciklama && !ctx.kokNeden && !ctx.kategori) {
    throw new NotebookLmCallError(
      "Ticket ba\u011Flam\u0131 bo\u015F \u2014 en az a\xE7\u0131klama/kategori/k\xF6k-neden olmal\u0131."
    );
  }
  const ctxLines = [];
  if (ctx.bildirimNo) ctxLines.push(`Bildirim No: ${ctx.bildirimNo}`);
  if (ctx.proje) ctxLines.push(`Proje: ${ctx.proje}`);
  if (ctx.kategori) ctxLines.push(`Kategori: ${ctx.kategori}`);
  if (ctx.kokNeden) ctxLines.push(`K\xF6k Neden: ${ctx.kokNeden}`);
  if (aciklama) {
    ctxLines.push(`Sorun A\xE7\u0131klamas\u0131:
${aciklama.slice(0, 1500)}`);
  }
  const question = [
    "A\u015Fa\u011F\u0131daki destek ticket'\u0131 i\xE7in Univera Panorama i\xE7 d\xF6k\xFCmantasyonundan",
    "ilgili s\xFCr\xFCm notlar\u0131na, parametrelere, men\xFC ad\u0131mlar\u0131na ve m\xFC\u015Fteri-\xF6zel",
    "i\u015F kurallar\u0131na dayanarak \xE7\xF6z\xFCm \xF6nerisi getir.",
    "",
    "Yan\u0131t\u0131n \u015Fu yap\u0131da olsun:",
    "1) **\u0130lgili D\xF6k\xFCmantasyon Bulgular\u0131** \u2014 kaynak isimleriyle 2-4 madde.",
    "2) **Olas\u0131 K\xF6k Neden(ler)** \u2014 d\xF6k\xFCmana g\xF6re hangi kural/parametre tetiklemi\u015F olabilir.",
    "3) **\xD6nerilen Ad\u0131mlar** \u2014 men\xFC yolu, parametre, ekran ad\u0131 gibi somut ad\u0131mlar.",
    "4) **M\xFC\u015Fteriye Yan\u0131t Notu** \u2014 tek paragraf, kibar, teknik dil kullanma.",
    "",
    "D\xF6k\xFCmantasyonda yoksa a\xE7\u0131k\xE7a 'kaynak yok' de; uydurma.",
    "",
    "=== Ticket Bilgisi ===",
    ...ctxLines
  ].join("\n");
  return askQuestion({
    question,
    sessionId: opts.sessionId ?? null,
    sourceFormat: "footnotes"
  });
}

// server/kb/src/lib/ticket/index.ts
init_env();
var AnalyzeBodySchema = z6.object({
  bildirimNo: z6.number().int().positive().optional(),
  freeText: z6.string().min(3).optional(),
  project: z6.string().optional(),
  options: z6.object({
    topK: z6.number().int().min(1).max(50).optional()
  }).optional()
}).refine((b) => b.bildirimNo || b.freeText, {
  message: "bildirimNo veya freeText gerekli"
});
function enrichSimilar(hits) {
  if (hits.length === 0) return [];
  const ids = hits.map((h) => h.bildirim_no);
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb().prepare(
    `SELECT bildirim_no, proje, kategori_uzun, kok_neden, aciklama, cozum,
              tfs_tip, bug_group
       FROM tickets WHERE bildirim_no IN (${placeholders})`
  ).all(...ids);
  const byId = new Map(rows.map((r) => [r.bildirim_no, r]));
  return hits.map((h) => {
    const r = byId.get(h.bildirim_no);
    if (!r) return null;
    const safe = {
      ...r,
      proje: null,
      aciklama: r.aciklama ? anonymizeCustomers(r.aciklama).text : null,
      cozum: r.cozum ? anonymizeCustomers(r.cozum).text : null
    };
    return { ...h, ...safe };
  }).filter((x) => x !== null);
}
function pickQueryText(freeText, matched) {
  if (freeText && freeText.trim().length > 0) return freeText;
  if (matched) {
    const m = matched;
    return [
      m.Uzun_Kategori_Adi ?? m.kategori_uzun ?? "",
      m.Konunun_Kok_Nedeni ?? m.kok_neden ?? "",
      m.Bildirim_Aciklamasi ?? m.aciklama ?? ""
    ].filter(Boolean).join("\n\n");
  }
  return "";
}
function resolveCategoryId(bildirimNo) {
  if (!bildirimNo) return null;
  const b = loadBundle();
  if (!b) return null;
  return b.assignments.find((a) => a.bildirim_no === bildirimNo)?.category_id ?? null;
}
async function runAnalysis(body) {
  let matched = null;
  if (body.bildirimNo) {
    matched = getTicket(body.bildirimNo);
    if (!matched) {
      matched = await getById(body.bildirimNo);
    }
  }
  const rawQueryText = pickQueryText(body.freeText ?? null, matched);
  if (body.freeText && body.freeText.trim()) {
    assertNoCustomerName(body.freeText);
  }
  const { text: redactedText } = redact(rawQueryText);
  const { text: queryText } = anonymizeCustomers(redactedText);
  let similar = [];
  try {
    const hits = await searchSimilarByText(
      queryText,
      {
        proje: body.project ?? null,
        excludeBildirimNo: body.bildirimNo ?? null
      },
      body.options?.topK
    );
    similar = enrichSimilar(hits);
  } catch (err) {
    console.warn("similarity aramas\u0131 ba\u015Far\u0131s\u0131z:", err.message);
  }
  const taxonomy = loadTaxonomy();
  const categoryId = resolveCategoryId(body.bildirimNo ?? null);
  const panoramaScreens = recommendScreensForTicket({
    categoryId,
    text: queryText,
    limit: 4
  });
  const mapChunk = (h, i) => ({
    number: i + 1,
    source_type: h.source_type,
    title: h.title,
    heading_path: h.heading_path,
    excerpt: h.content.slice(0, 700)
  });
  const kbN4bPromise = (async () => {
    try {
      const hits = await retrieve(queryText, {
        topK: 6,
        rerank: true,
        sourceTypes: ["operator_resolution"]
      });
      return hits.map(mapChunk);
    } catch (err) {
      console.warn("[kb] N4B retrieval ba\u015Far\u0131s\u0131z:", err.message);
      return [];
    }
  })();
  const kbOtherPromise = (async () => {
    try {
      const hits = await retrieve(queryText, {
        topK: 8,
        rerank: true,
        sourceTypes: ["panorama_screen", "ticket_resolution", "pdf"]
      });
      return hits.map(mapChunk);
    } catch (err) {
      console.warn("[kb] di\u011Fer d\xF6k\xFCmanlar retrieval ba\u015Far\u0131s\u0131z:", err.message);
      return [];
    }
  })();
  const cfg = env();
  const notebookLmPromise = cfg.NOTEBOOKLM_AUTO_CONSULT && isNotebookLmEnabled() ? consultForTicket({
    bildirimNo: body.bildirimNo ?? null,
    proje: matched?.PROJE ?? matched?.proje ?? body.project ?? null,
    kategori: matched?.Uzun_Kategori_Adi ?? matched?.kategori_uzun ?? null,
    kokNeden: matched?.Konunun_Kok_Nedeni ?? matched?.kok_neden ?? null,
    aciklama: matched?.Bildirim_Aciklamasi ?? matched?.aciklama ?? null,
    freeText: body.freeText ?? null
  }).catch((err) => {
    console.warn(
      "[notebooklm] auto-consult ba\u015Far\u0131s\u0131z:",
      err.message
    );
    return null;
  }) : Promise.resolve(null);
  const [kbChunksN4b, kbChunksOther] = await Promise.all([
    kbN4bPromise,
    kbOtherPromise
  ]);
  const kbChunks = [
    ...kbChunksN4b,
    ...kbChunksOther.map((c, i) => ({ ...c, number: kbChunksN4b.length + i + 1 }))
  ];
  const [rawAnalysis, notebookLm] = await Promise.all([
    runAnalyst({
      freeText: body.freeText ?? null,
      matched,
      similar: similar.map((s) => ({
        bildirim_no: s.bildirim_no,
        score: s.score,
        proje: s.proje,
        kategori_uzun: s.kategori_uzun,
        kok_neden: s.kok_neden,
        aciklama: s.aciklama,
        cozum: s.cozum,
        tfs_tip: s.tfs_tip,
        bug_group: s.bug_group
      })),
      taxonomy,
      panoramaScreens,
      kbChunksN4b,
      kbChunksOther
    }),
    notebookLmPromise
  ]);
  const { fixed: fixedSteps, corrections: menuCorrections } = validateAndAnnotateSteps(rawAnalysis.suggestedSteps);
  if (menuCorrections.length > 0) {
    console.log(
      `[menu-validator] ${menuCorrections.length} men\xFC yolu d\xFCzeltildi/i\u015Faretlendi`
    );
  }
  const descForReorder = body.freeText ?? matched?.Bildirim_Aciklamasi ?? matched?.aciklama ?? null;
  const reorder = ensureMentionedScreenFirst(fixedSteps, descForReorder);
  if (reorder.changed) {
    console.log(
      `[step-reorder] ad\u0131m s\u0131ras\u0131 d\xFCzeltildi \u2192 ilk ad\u0131m = "${reorder.targetScreenTitle}"`
    );
  }
  const analysis = {
    ...rawAnalysis,
    suggestedSteps: reorder.steps
  };
  const seed = body.bildirimNo ? `tk-${body.bildirimNo}` : (body.freeText ?? "").slice(0, 40);
  const analysisId = newAnalysisId(seed);
  const record = {
    meta: {
      analysisId,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      mode: body.bildirimNo ? "bildirim_no" : "free_text",
      bildirimNo: body.bildirimNo ?? null,
      projectHint: body.project ?? null,
      modelUsed: analysis.meta.modelUsed,
      severity: analysis.inferred?.oncelik ?? (matched?.Oncelik ?? matched?.oncelik ?? null),
      category: matched?.Uzun_Kategori_Adi ?? matched?.kategori_uzun ?? null
    },
    input: {
      bildirimNo: body.bildirimNo ?? null,
      freeText: body.freeText ?? null,
      project: body.project ?? null,
      queryTextRedacted: queryText
    },
    analysis: { ...analysis, similar, panoramaScreens }
  };
  saveAnalysis(record);
  return {
    analysisId,
    matched,
    similar,
    panoramaScreens,
    analysis,
    notebookLm,
    kbChunks,
    kbChunksN4b,
    kbChunksOther,
    input: {
      bildirimNo: body.bildirimNo ?? null,
      freeText: body.freeText ?? null,
      project: body.project ?? null
    }
  };
}

// server/kb/kb-bundle-entry.ts
init_env();
export {
  AnalyzeBodySchema,
  CustomerSearchBlockedError,
  ask,
  categorize,
  categorizeV2,
  embed,
  embedBatch,
  embedPendingChunks,
  env,
  getKbDb,
  isVecAvailable,
  kbStats,
  retrieve,
  runAnalysis,
  suggestClose
};
