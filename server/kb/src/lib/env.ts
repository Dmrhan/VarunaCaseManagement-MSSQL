import { z } from "zod";

const Schema = z.object({
  TICKET_MSSQL_SERVER: z.string().min(1),
  TICKET_MSSQL_INSTANCE: z.string().optional(),
  TICKET_MSSQL_PORT: z.coerce.number().int().positive().default(1433),
  TICKET_MSSQL_DATABASE: z.string().min(1),
  TICKET_MSSQL_USER: z.string().min(1),
  TICKET_MSSQL_PASSWORD: z.string().min(1),
  TICKET_MSSQL_ENCRYPT: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  TICKET_MSSQL_TRUST_SERVER_CERT: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // LLM provider: artık Claude (generation) + OpenAI (embedding).
  // GEMINI_API_KEY geriye uyumluluk için kalıyor ama kullanılmıyor.
  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  GEMINI_EMBEDDING_MODEL: z.string().default("text-embedding-004"),
  GEMINI_GENERATION_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_GENERATION_FALLBACK_MODEL: z.string().default("gemini-2.5-flash-lite"),

  // Anthropic Claude (generation)
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
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
  API_KEYS: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return {} as Record<string, string>;
      const map: Record<string, string> = {};
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
  TICKET_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  TICKET_ANALYSIS_LOOKBACK_DAYS: z.coerce.number().int().positive().default(180),
  TICKET_SIMILARITY_TOPK: z.coerce.number().int().positive().default(10),

  // Auth — iron-session için cookie imzalama anahtarı. EN AZ 32 karakter.
  // Üretmek için: `openssl rand -hex 32`
  CC_SESSION_SECRET: z.string().min(32, "CC_SESSION_SECRET en az 32 karakter olmalı"),
  CC_SESSION_COOKIE_NAME: z.string().default("cc_session"),
  CC_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7), // 7 gün

  // NotebookLM (Univera iç dökümantasyonu) — opsiyonel.
  // Boş bırakılırsa NotebookLM consult özelliği devre dışıdır.
  NOTEBOOKLM_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Library'e kayıtlı notebook id (örn. "univera-panorama-d-k-manlar").
  // Boşsa direkt URL kullanılır; ikisi de boşsa consult fail eder.
  NOTEBOOKLM_NOTEBOOK_ID: z.string().optional(),
  NOTEBOOKLM_NOTEBOOK_URL: z.string().optional(),
  // notebooklm-mcp paketini stdio ile spawn ederken kullanılacak komut + args.
  // Default: `npx -y notebooklm-mcp@latest`.
  NOTEBOOKLM_MCP_COMMAND: z.string().default("npx"),
  NOTEBOOKLM_MCP_ARGS: z
    .string()
    .default("-y notebooklm-mcp@latest")
    .transform((v) =>
      v
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  // Tek bir ask_question çağrısı için timeout (ms). NotebookLM ~15-30s.
  NOTEBOOKLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  // runAnalysis pipeline'ında her ticket için otomatik consult yapılsın mı?
  // Default kapalı — UI'dan opt-in. Açılırsa her analiz 25-40s daha sürer.
  NOTEBOOKLM_AUTO_CONSULT: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof Schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(
      `Ortam değişkenleri eksik/hatalı:\n${lines.join("\n")}\n` +
        `.env dosyasını .env.example referans alıp doldur.`,
    );
  }
  cached = parsed.data;
  return cached;
}
