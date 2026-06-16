/*
 * NotebookLM MCP client — persistent stdio bağlantısı.
 *
 * Tasarım:
 *   - Singleton lazy-init: `getClient()` ilk çağrıda subprocess'i spawn eder,
 *     sonraki çağrılar aynı bağlantıyı paylaşır.
 *   - `dev` modda Next.js hot reload sırasında subprocess'in dublike spawn
 *     edilmesini engellemek için global cache kullanılır.
 *   - Bağlantı koparsa (process exit / transport error) bir sonraki çağrıda
 *     yeniden bağlanır. Concurrent reconnect race'i lock ile bloklanır.
 *   - Per-call timeout: env'de `NOTEBOOKLM_TIMEOUT_MS` (default 60s).
 *   - Server stderr inherit edilir; debug için terminalde görünür.
 *
 * Bu dosya hiçbir Next.js bileşeniyle direkt konuşmaz; üst katman
 * `src/lib/ticket/notebooklm.ts` consult helper'ları açar.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { env } from "../env";

type ToolResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
};

type ClientState = {
  client: Client;
  transport: StdioClientTransport;
  connecting: Promise<Client> | null;
};

const GLOBAL_KEY = "__notebooklm_mcp_client__";
const globalAny = globalThis as unknown as Record<string, ClientState | null>;

function getCache(): ClientState | null {
  return globalAny[GLOBAL_KEY] ?? null;
}

function setCache(state: ClientState | null): void {
  globalAny[GLOBAL_KEY] = state;
}

async function connect(): Promise<Client> {
  const cfg = env();

  // Subprocess'e güvenli env değişkenlerini (HOME, PATH vs.) + notebooklm-mcp'ye
  // özgü olanları (HEADLESS, NOTEBOOKLM_*) aktarırız.
  // Patchright/Chromium'un kullanıcı profili HOME'a göre çözülür, bu yüzden
  // HOME mutlaka geçilmeli.
  const childEnv: Record<string, string> = {};
  const passthrough = [
    "HOME",
    "USER",
    "PATH",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "DISPLAY", // Linux X11 için
    "XDG_DATA_HOME",
    "XDG_CONFIG_HOME",
    "HEADLESS",
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
    stderr: "inherit",
  });

  const client = new Client(
    {
      name: "ticket-analiz",
      version: "0.1.0",
    },
    {
      capabilities: {},
    },
  );

  // Bağlantı kapanırsa cache temizle; sonraki çağrı yeniden bağlansın.
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
  const state: ClientState = { client, transport, connecting: null };
  setCache(state);
  return client;
}

/**
 * Singleton client'ı al; yoksa spawn et. Concurrent çağrılarda tek bir
 * spawn yapılır (in-flight promise paylaşılır).
 */
export async function getClient(): Promise<Client> {
  const cached = getCache();
  if (cached?.connecting) return cached.connecting;
  if (cached?.client) return cached.client;
  const connecting = connect();
  setCache({
    client: null as unknown as Client,
    transport: null as unknown as StdioClientTransport,
    connecting,
  });
  try {
    return await connecting;
  } catch (err) {
    setCache(null);
    throw err;
  }
}

/** Mevcut bağlantıyı kapat — testlerde ve graceful shutdown'da kullan. */
export async function closeClient(): Promise<void> {
  const cur = getCache();
  if (!cur) return;
  setCache(null);
  try {
    if (cur.transport) {
      await cur.transport.close();
    }
  } catch {
    // ignore
  }
}

type CallOptions = {
  timeoutMs?: number;
};

/**
 * Tek bir tool çağrısı. Timeout sonrası AbortController ile iptal edilir;
 * subprocess çalışmaya devam edebilir ama promise hata fırlatır.
 */
export async function callTool<T = ToolResult>(
  name: string,
  args: Record<string, unknown>,
  opts: CallOptions = {},
): Promise<T> {
  const cfg = env();
  const timeout = opts.timeoutMs ?? cfg.NOTEBOOKLM_TIMEOUT_MS;
  const client = await getClient();

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);

  try {
    const result = await client.callTool(
      { name, arguments: args },
      // Default result schema (CallToolResultSchema) is fine — we'll cast.
      undefined,
      { signal: ac.signal, timeout },
    );
    return result as unknown as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tool result'tan text payload'ı çıkar. notebooklm-mcp cevabı
 * `content[].text` içinde JSON string olarak döner — bu helper parse eder.
 */
export function extractTextPayload(result: ToolResult): unknown {
  const first = result?.content?.find((c) => c.type === "text");
  if (!first?.text) {
    if (result?.structuredContent) return result.structuredContent;
    return null;
  }
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text; // plain string
  }
}
