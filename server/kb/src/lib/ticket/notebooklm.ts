/*
 * Ticket bağlamından NotebookLM consult — yüksek seviyeli sarmalayıcı.
 *
 * - `consultForTicket` bir ticket özetinden NotebookLM'e iki katmanlı soru
 *   üretir (kök neden + çözüm önerisi); cevabı + alıntıları döner.
 * - `consultFreeQuestion` herhangi bir metni alıp direkt soru gönderir.
 *
 * NotebookLM çağrıları yavaştır (~15-30s); bu yüzden runAnalysis pipeline'ına
 * default olarak EKLENMEZ. Env `NOTEBOOKLM_AUTO_CONSULT=true` ile veya UI'dan
 * opt-in olarak çağrılır.
 */

import { env } from "../env";
import { callTool, extractTextPayload } from "../notebooklm/client";

export type NotebookLmCitation = {
  marker: string;
  number: number;
  sourceName: string;
  sourceText: string;
};

export type NotebookLmAnswer = {
  question: string;
  answer: string;
  sessionId: string | null;
  notebookUrl: string | null;
  sources: NotebookLmCitation[];
  latencyMs: number;
};

type AskQuestionResult = {
  success?: boolean;
  data?: {
    status?: string;
    question?: string;
    answer?: string;
    session_id?: string | null;
    notebook_url?: string | null;
    sources?: NotebookLmCitation[];
  };
  error?: string;
};

export class NotebookLmDisabledError extends Error {
  constructor() {
    super(
      "NotebookLM devre dışı. NOTEBOOKLM_ENABLED=true yap ve NOTEBOOKLM_NOTEBOOK_ID (veya _URL) ayarla.",
    );
    this.name = "NotebookLmDisabledError";
  }
}

export class NotebookLmCallError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "NotebookLmCallError";
  }
}

/**
 * NotebookLM aktif mi? Bu hem env flag'ine hem de notebook bağlayıcısının
 * (id ya da URL) varlığına bakar. Pipeline'lar bu fonksiyonu kullanarak
 * NotebookLM çağrısı yapıp yapmayacağına karar verir.
 */
export function isNotebookLmEnabled(): boolean {
  const cfg = env();
  if (!cfg.NOTEBOOKLM_ENABLED) return false;
  return Boolean(cfg.NOTEBOOKLM_NOTEBOOK_ID || cfg.NOTEBOOKLM_NOTEBOOK_URL);
}

type AskArgs = {
  question: string;
  sessionId?: string | null;
  sourceFormat?: "none" | "inline" | "footnotes" | "json";
};

/**
 * notebooklm-mcp flakiness: ilk çağrıda Chrome sayfası tam yüklenmeden
 * input aranır ve "Could not find NotebookLM chat input" hatası gelir.
 * Sayfa arka planda yüklenmeye devam eder; 3-5s sonra retry başarılıdır.
 * Bu pattern'e match eden hata için sessiz retry yapıyoruz.
 */
const FLAKY_PATTERNS = [
  /could not find notebooklm chat input/i,
  /notebook page has loaded/i,
  /notebook url is required/i,
];

function isFlakyError(msg: string | undefined | null): boolean {
  if (!msg) return false;
  return FLAKY_PATTERNS.some((p) => p.test(msg));
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askQuestionOnce(args: AskArgs): Promise<NotebookLmAnswer> {
  if (!isNotebookLmEnabled()) throw new NotebookLmDisabledError();

  const cfg = env();
  const toolArgs: Record<string, unknown> = {
    question: args.question,
    source_format: args.sourceFormat ?? "footnotes",
  };
  if (cfg.NOTEBOOKLM_NOTEBOOK_ID) {
    toolArgs.notebook_id = cfg.NOTEBOOKLM_NOTEBOOK_ID;
  } else if (cfg.NOTEBOOKLM_NOTEBOOK_URL) {
    toolArgs.notebook_url = cfg.NOTEBOOKLM_NOTEBOOK_URL;
  }
  if (args.sessionId) toolArgs.session_id = args.sessionId;

  const startedAt = Date.now();
  const raw = await callTool<{ content?: Array<{ type: string; text?: string }> }>(
    "ask_question",
    toolArgs,
  );
  const payload = extractTextPayload(raw) as AskQuestionResult | string | null;

  if (!payload || typeof payload === "string") {
    throw new NotebookLmCallError(
      `NotebookLM beklenmeyen yanıt verdi: ${String(payload).slice(0, 200)}`,
    );
  }
  if (payload.success === false) {
    throw new NotebookLmCallError(
      `NotebookLM ask_question başarısız: ${payload.error ?? "(error yok)"}`,
    );
  }
  const data = payload.data;
  if (!data?.answer) {
    throw new NotebookLmCallError(
      "NotebookLM yanıtında 'answer' alanı yok.",
    );
  }
  return {
    question: data.question ?? args.question,
    answer: data.answer,
    sessionId: data.session_id ?? null,
    notebookUrl: data.notebook_url ?? null,
    sources: data.sources ?? [],
    latencyMs: Date.now() - startedAt,
  };
}

async function askQuestion(args: AskArgs): Promise<NotebookLmAnswer> {
  let lastErr: unknown = null;
  let sessionId = args.sessionId ?? null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(
          `[notebooklm] retry ${attempt}/${MAX_RETRIES} (sessionId=${sessionId ?? "(yok)"})`,
        );
      }
      return await askQuestionOnce({ ...args, sessionId });
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[notebooklm] attempt ${attempt + 1} failed: ${msg.slice(0, 200)}`,
      );
      // Flakiness pattern değilse retry'a gerek yok; direkt fırlat.
      if (!isFlakyError(msg)) throw err;
      if (attempt === MAX_RETRIES) break;
      // İlk denemeden sonra mevcut session'ı listele ve onu kullanarak retry et.
      // Sayfa arka planda yüklenmiş olur; aynı session_id ile çağrı başarılıdır.
      try {
        const listRaw = await callTool("list_sessions", {});
        const listPayload = extractTextPayload(listRaw) as
          | { data?: { sessions?: Array<{ id: string; notebook_url: string }> } }
          | null;
        const sess = listPayload?.data?.sessions?.[0];
        if (sess?.id) {
          sessionId = sess.id;
          console.log(`[notebooklm] reusing session ${sessionId}`);
        }
      } catch {
        // ignore; retry without session id
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new NotebookLmCallError(String(lastErr));
}

/**
 * Serbest soru — UI'dan gelen "şu konuyu sor" gibi taleplerde kullanılır.
 * Hata fırlatabilir; çağıran try/catch'e almalı.
 */
export async function consultFreeQuestion(
  question: string,
  opts: { sessionId?: string | null } = {},
): Promise<NotebookLmAnswer> {
  if (!question.trim()) {
    throw new NotebookLmCallError("Soru metni boş olamaz.");
  }
  return askQuestion({
    question: question.trim(),
    sessionId: opts.sessionId ?? null,
    sourceFormat: "footnotes",
  });
}

/**
 * Ticket bağlamından NotebookLM consult. Sadece relevant alanları
 * (kategori, kök neden, açıklama, proje) ile kısa bir prompt üretir.
 * NotebookLM "ne diyor?" sorusuna alıntılı yanıt verir.
 */
export type TicketContext = {
  bildirimNo?: number | null;
  proje?: string | null;
  kategori?: string | null;
  kokNeden?: string | null;
  aciklama?: string | null;
  freeText?: string | null;
};

export async function consultForTicket(
  ctx: TicketContext,
  opts: { sessionId?: string | null } = {},
): Promise<NotebookLmAnswer> {
  const aciklama = (ctx.freeText ?? ctx.aciklama ?? "").trim();
  if (!aciklama && !ctx.kokNeden && !ctx.kategori) {
    throw new NotebookLmCallError(
      "Ticket bağlamı boş — en az açıklama/kategori/kök-neden olmalı.",
    );
  }
  const ctxLines: string[] = [];
  if (ctx.bildirimNo) ctxLines.push(`Bildirim No: ${ctx.bildirimNo}`);
  if (ctx.proje) ctxLines.push(`Proje: ${ctx.proje}`);
  if (ctx.kategori) ctxLines.push(`Kategori: ${ctx.kategori}`);
  if (ctx.kokNeden) ctxLines.push(`Kök Neden: ${ctx.kokNeden}`);
  if (aciklama) {
    ctxLines.push(`Sorun Açıklaması:\n${aciklama.slice(0, 1500)}`);
  }

  const question = [
    "Aşağıdaki destek ticket'ı için Univera Panorama iç dökümantasyonundan",
    "ilgili sürüm notlarına, parametrelere, menü adımlarına ve müşteri-özel",
    "iş kurallarına dayanarak çözüm önerisi getir.",
    "",
    "Yanıtın şu yapıda olsun:",
    "1) **İlgili Dökümantasyon Bulguları** — kaynak isimleriyle 2-4 madde.",
    "2) **Olası Kök Neden(ler)** — dökümana göre hangi kural/parametre tetiklemiş olabilir.",
    "3) **Önerilen Adımlar** — menü yolu, parametre, ekran adı gibi somut adımlar.",
    "4) **Müşteriye Yanıt Notu** — tek paragraf, kibar, teknik dil kullanma.",
    "",
    "Dökümantasyonda yoksa açıkça 'kaynak yok' de; uydurma.",
    "",
    "=== Ticket Bilgisi ===",
    ...ctxLines,
  ].join("\n");

  return askQuestion({
    question,
    sessionId: opts.sessionId ?? null,
    sourceFormat: "footnotes",
  });
}
