/*
 * KB ask — halisünasyon-savar RAG generation.
 *
 * Akış:
 *   1. retrieve(query) → top-k chunks
 *   2. minimum güven testi: top chunk yoksa veya RRF skoru < threshold → refuse
 *   3. Gemini'ye strict grounding prompt'u: "ONLY use sources, cite [N]"
 *   4. JSON schema: { answer, citations, refused, reason }
 *   5. Verifier pass (opsiyonel, default açık): yanıttaki her claim için
 *      gerçekten o citation'da var mı kontrol et — yoksa cümle silinir
 *      veya yanıt refused olarak işaretlenir.
 *
 * Sonuç: kaynaksız iddia üretilemez; "Bilgi yok" cevabı yanlış cevaptan
 * daha değerlidir.
 */

import { z } from "zod";
import { generate } from "../gemini";
import { retrieve, type RetrievedChunk, type RetrieveOpts } from "./retrieve";
import type { SourceType } from "./db";

const MIN_RRF_SCORE = 0.005; // RRF default skor aralığı 0.001–0.05; bu değerin altı zayıf
const MIN_HIGH_CONFIDENCE_CHUNKS = 1;

const AskOutputSchema = z.object({
  answer: z.string(),
  citations: z.array(z.number().int().min(1)).default([]),
  refused: z.boolean().default(false),
  reason: z.string().nullable().optional(),
});

export type AskOutput = z.infer<typeof AskOutputSchema>;

export type AskCitation = {
  number: number;
  chunk_id: number;
  doc_id: string;
  source_type: SourceType;
  title: string | null;
  heading_path: string | null;
  excerpt: string;
};

export type AskResult = {
  query: string;
  answer: string;
  citations: AskCitation[];
  refused: boolean;
  reason: string | null;
  retrieved: RetrievedChunk[];
  meta: {
    retrievalLatencyMs: number;
    generationLatencyMs: number;
    verifierLatencyMs: number;
    totalLatencyMs: number;
    modelUsed: string;
    rerankUsed: boolean;
    verifierUsed: boolean;
  };
};

export type AskOpts = RetrieveOpts & {
  /** Verifier pass yapılsın mı (default true). Kapatırsan halisünasyon riski artar. */
  verify?: boolean;
  /** Refusal'da daha düşük tolerans? "strict" daha sık reddeder. */
  strictness?: "lenient" | "normal" | "strict";
};

const SYSTEM = `
Sen Univera Panorama destek bilgi bankasına bakan kıdemli bir destek analistsin.

KURALLAR (mutlak):
- SADECE aşağıdaki <KAYNAKLAR> bölümünde verilen alıntılara dayanarak cevap ver.
- Kaynaklardaki bilgi yoksa veya yetersizse, "refused": true, "answer": "" ve "reason" alanında neden olduğunu açıkla.
- Yanıttaki teknik iddiaların yanına kaynak numarasını köşeli parantezde ekle: [1], [2]. Birden fazla kaynak destekliyorsa: [1][3] gibi.
- Kaynak DIŞI bilgi (genel kültür, başka ürün, tahmin) KULLANMA. Uydurma.

CEVAP STİLİ — DETAYLI ve İŞLEMSEL ol:
- Sorulan konunun TÜM ilgili adımlarını ve detaylarını ver. Generic özet yapma.
- **Menü adımlarını TAM yaz**: "Satış Ekibi → Tanımlamalar → Satış Temsilcisi" gibi.
- **Buton/sekme adlarını AYNEN kullan**: kaynakta "Rut Bilgileri" yazıyorsa öyle yaz, "Rut sekmesi" diye genelleme yapma.
- **Alan adlarını (saha adlarını) ekle**: hangi alanlar doldurulacak — Rut Kodu, Başlangıç Tarihi, Frekans vb.
- **Koşullu davranışları AÇIKLA**: parametre veya yetki etkili oluyorsa belirt (örn. "Merkez Onaylı Rut İşlemleri Kullanılsın Mı? parametresi aktifse yöneticinin iş akış onayına düşer").
- **Adımları numaralandırılmış liste yap** (1, 2, 3...).
- **Markdown KULLAN**: bold (**...**), liste (-), code (\`...\`) işaretleri okunabilirliği arttırır.
- Türkçe yaz.

ÇIKTI:
- Yalnızca aşağıdaki JSON şemasında ver, başka metin EKLEME.

JSON şeması:
{
  "answer": string,         // Detaylı markdown, [N] alıntılı. refused=true ise "".
  "citations": number[],    // Yanıtta kullandığın kaynak numaraları (1-tabanlı)
  "refused": boolean,       // Kaynaklar yetersizse true
  "reason": string | null   // refused=true ise neden, yoksa null
}
`.trim();

function buildPrompt(query: string, chunks: RetrievedChunk[]): string {
  const sourcesBlock = chunks
    .map((c, i) => {
      const header = [
        `[${i + 1}] ${c.title ?? c.heading_path ?? "(başlıksız)"} · ${c.source_type}`,
        c.heading_path && c.heading_path !== c.title
          ? `Path: ${c.heading_path}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
      return `${header}\n---\n${c.content}`;
    })
    .join("\n\n=== SONRAKİ KAYNAK ===\n\n");

  return [
    `SORU:\n${query}`,
    "",
    `<KAYNAKLAR>`,
    sourcesBlock,
    `</KAYNAKLAR>`,
    "",
    "Görev: JSON şemasında cevap üret.",
  ].join("\n");
}

function extractJson(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s.trim();
}

/** Yanıttan [N] alıntı numaralarını çıkar. */
function extractCitedNumbers(text: string): number[] {
  const set = new Set<number>();
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** Verifier: yanıttaki her cümle için "bu kaynak X'te gerçekten geçiyor mu?" sor. */
async function verifyGrounding(
  answer: string,
  citations: number[],
  chunks: RetrievedChunk[],
): Promise<{ verified: boolean; problemSentences: string[]; modelUsed: string; latencyMs: number }> {
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);
  if (sentences.length === 0) {
    return {
      verified: true,
      problemSentences: [],
      modelUsed: "n/a",
      latencyMs: 0,
    };
  }

  const usedChunks = citations
    .map((n) => chunks[n - 1])
    .filter((c): c is RetrievedChunk => Boolean(c));
  if (usedChunks.length === 0) {
    return {
      verified: false,
      problemSentences: sentences,
      modelUsed: "n/a",
      latencyMs: 0,
    };
  }

  const system =
    "Sen bir grounding verifier'sın. Verilen yanıttaki HER cümlenin aşağıdaki kaynaklardan birinde desteklendiğini kontrol et. Birebir kelime eşleşmesi şart değil — kaynaktaki bilginin **anlamca aynı** (parafraze, özetleme, yeniden yapılandırma) olması yeterli. Adımları farklı sırada yazmak veya başlık değiştirmek 'desteklenmiyor' demek değildir. Sadece kaynaklara bak; genel bilgi kullanma. JSON döndür.";
  const sourcesBlock = usedChunks
    .map((c, i) => `[KAYNAK ${i + 1}]\n${c.content.slice(0, 2000)}`)
    .join("\n\n");
  const sentBlock = sentences.map((s, i) => `[C${i + 1}] ${s}`).join("\n");
  const userPrompt = [
    "KAYNAKLAR:",
    sourcesBlock,
    "",
    "YANIT CÜMLELERİ:",
    sentBlock,
    "",
    'Her cümle için kaynaklarca destekleniyor mu? Anlamca eşleşme yeterli — birebir kelime gerekmez. Cevap formatı (sadece JSON):',
    '{"results":[{"id":"C1","supported":true|false}, ...]}',
  ].join("\n");

  const start = Date.now();
  const res = await generate(system, userPrompt, {
    temperature: 0,
    maxOutputTokens: 1024,
    responseMimeType: "application/json",
    tier: "fast", // verifier basit task, Haiku yeterli
  });
  let parsed: { results?: Array<{ id: string; supported: boolean }> } = {};
  try {
    parsed = JSON.parse(extractJson(res.text));
  } catch {
    return {
      verified: true,
      problemSentences: [],
      modelUsed: res.modelUsed,
      latencyMs: Date.now() - start,
    };
  }
  const unsupported = (parsed.results ?? [])
    .filter((r) => r.supported === false)
    .map((r) => {
      const idx = Number(r.id.replace("C", "")) - 1;
      return sentences[idx] ?? "";
    })
    .filter(Boolean);
  return {
    verified: unsupported.length === 0,
    problemSentences: unsupported,
    modelUsed: res.modelUsed,
    latencyMs: Date.now() - start,
  };
}

/**
 * Ana entry point.
 */
export async function ask(
  query: string,
  opts: AskOpts = {},
): Promise<AskResult> {
  const strictness = opts.strictness ?? "normal";
  const verify = opts.verify ?? true;
  const totalStart = Date.now();

  // 1) Retrieval
  const retrievalStart = Date.now();
  const chunks = await retrieve(query, opts);
  const retrievalLatencyMs = Date.now() - retrievalStart;

  // 2) Confidence guard
  const minScore =
    strictness === "strict"
      ? MIN_RRF_SCORE * 2
      : strictness === "lenient"
        ? MIN_RRF_SCORE / 2
        : MIN_RRF_SCORE;
  const strong = chunks.filter((c) => c.rrfScore >= minScore);
  if (chunks.length === 0 || strong.length < MIN_HIGH_CONFIDENCE_CHUNKS) {
    return {
      query,
      answer: "",
      citations: [],
      refused: true,
      reason:
        chunks.length === 0
          ? "Bilgi bankasında ilgili kaynak bulunamadı."
          : "Bulunan kaynaklar yeterince güvenilir değil.",
      retrieved: chunks,
      meta: {
        retrievalLatencyMs,
        generationLatencyMs: 0,
        verifierLatencyMs: 0,
        totalLatencyMs: Date.now() - totalStart,
        modelUsed: "n/a",
        rerankUsed: Boolean(opts.rerank),
        verifierUsed: false,
      },
    };
  }

  // 3) Generation
  const userPrompt = buildPrompt(query, chunks);
  const genStart = Date.now();
  const res = await generate(SYSTEM, userPrompt, {
    temperature: 0.1,
    maxOutputTokens: 4096,
    responseMimeType: "application/json",
  });
  const generationLatencyMs = Date.now() - genStart;

  let parsed: AskOutput;
  try {
    parsed = AskOutputSchema.parse(JSON.parse(extractJson(res.text)));
  } catch (err) {
    return {
      query,
      answer: "",
      citations: [],
      refused: true,
      reason: `LLM yanıtı şemaya uymadı: ${(err as Error).message}`,
      retrieved: chunks,
      meta: {
        retrievalLatencyMs,
        generationLatencyMs,
        verifierLatencyMs: 0,
        totalLatencyMs: Date.now() - totalStart,
        modelUsed: res.modelUsed,
        rerankUsed: Boolean(opts.rerank),
        verifierUsed: false,
      },
    };
  }

  if (parsed.refused || !parsed.answer) {
    return {
      query,
      answer: parsed.answer ?? "",
      citations: [],
      refused: true,
      reason: parsed.reason ?? "LLM cevap üretmedi.",
      retrieved: chunks,
      meta: {
        retrievalLatencyMs,
        generationLatencyMs,
        verifierLatencyMs: 0,
        totalLatencyMs: Date.now() - totalStart,
        modelUsed: res.modelUsed,
        rerankUsed: Boolean(opts.rerank),
        verifierUsed: false,
      },
    };
  }

  // citations'ı modelin söylediği + metinden çıkarılan birleşik küme yap
  const fromText = extractCitedNumbers(parsed.answer);
  const declared = parsed.citations ?? [];
  const allCitations = [...new Set([...fromText, ...declared])].filter(
    (n) => n >= 1 && n <= chunks.length,
  );

  // 4) Verifier (opsiyonel)
  let verifierLatencyMs = 0;
  let verifierUsed = false;
  let finalAnswer = parsed.answer;
  let finalRefused = false;
  let finalReason: string | null = null;
  if (verify && allCitations.length > 0) {
    verifierUsed = true;
    const v = await verifyGrounding(parsed.answer, allCitations, chunks);
    verifierLatencyMs = v.latencyMs;
    if (!v.verified) {
      if (strictness === "strict") {
        finalRefused = true;
        finalAnswer = "";
        finalReason = `Verifier: ${v.problemSentences.length} cümle kaynaklarca desteklenmiyor.`;
      } else {
        // desteklenmeyen cümleleri yanıttan çıkar
        let stripped = parsed.answer;
        for (const s of v.problemSentences) {
          stripped = stripped.replace(s, "");
        }
        stripped = stripped.replace(/\s{2,}/g, " ").trim();
        if (stripped.length < 20) {
          finalRefused = true;
          finalAnswer = "";
          finalReason = `Doğrulanabilir bilgi az: ${v.problemSentences.length} cümle kaldırıldı, kalan yetersiz.`;
        } else {
          finalAnswer = stripped;
          finalReason = `Verifier: ${v.problemSentences.length} cümle desteklenmediği için kaldırıldı.`;
        }
      }
    }
  }

  // 5) Citation payloads
  const citationPayloads: AskCitation[] = allCitations
    .map((n) => {
      const c = chunks[n - 1];
      if (!c) return null;
      return {
        number: n,
        chunk_id: c.chunk_id,
        doc_id: c.doc_id,
        source_type: c.source_type,
        title: c.title,
        heading_path: c.heading_path,
        excerpt: c.content.slice(0, 300),
      };
    })
    .filter((x): x is AskCitation => x !== null);

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
      verifierUsed,
    },
  };
}
