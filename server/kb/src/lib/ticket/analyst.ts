import { z } from "zod";
import { generate } from "../gemini";
import { SYSTEM_INSTRUCTION, buildUserPrompt, type PromptInputs } from "./prompts";

/*
 * Analyst — tek Gemini çağrısı. Çıktıyı JSON olarak alır, Zod ile parse eder.
 * Geçersiz JSON gelirse temizle + tekrar parse; yine olmazsa hata.
 */

const HypothesisSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
});

const StepSchema = z.object({
  step: z.string(),
  rationale: z.string().nullable().optional(),
});

const InferredSchema = z
  .object({
    bildirim_tipi: z.string(),
    oncelik: z.enum(["Normal", "Yüksek", "Kritik"]),
    katman: z.string(),
    kok_neden: z.string(),
    confidence: z.number().min(0).max(1),
  })
  .nullable();

export const AnalystOutputSchema = z.object({
  inferred: InferredSchema,
  rootCauseHypotheses: z.array(HypothesisSchema).min(1).max(6),
  suggestedSteps: z.array(StepSchema).min(1).max(15),
  customerReplyDraft: z.string().min(1),
  engineeringHandoff: z.string().min(1),
  suggestedBugGroup: z.string().nullable().optional().default(null),
  suggestedTfsTip: z.string().nullable().optional().default(null),
  // Kaynak-ayrımlı rehberlik. Bu sayede analyst'in N4B operatör çözüm
  // notlarını gerçekten kullanıp kullanmadığı görsel olarak izlenebilir.
  // null gelirse UI "Bu kaynakta ilgili bilgi yok" şeklinde gösterir.
  n4bGuidance: z.string().nullable().optional().default(null),
  otherDocsGuidance: z.string().nullable().optional().default(null),
});

export type AnalystOutput = z.infer<typeof AnalystOutputSchema>;

export type AnalystResult = AnalystOutput & {
  meta: {
    modelUsed: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
};

/** ```json ... ``` veya leading/trailing whitespace temizle. */
function extractJson(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  // İlk { ile son } arasını al
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    s = s.slice(first, last + 1);
  }
  return s.trim();
}

export async function runAnalyst(inputs: PromptInputs): Promise<AnalystResult> {
  const userPrompt = buildUserPrompt(inputs);
  const response = await generate(SYSTEM_INSTRUCTION, userPrompt, {
    temperature: 0.2,
    // 2.5-flash 65k destekler; analiz çıktıları (özellikle benzer kayıt
    // sayısı yüksekken) 2k'yı aşabiliyor. 8k güvenli üst sınır.
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
  });

  const cleaned = extractJson(response.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Analist çıktısı JSON olarak parse edilemedi: ${(err as Error).message}\n---\n${response.text.slice(0, 800)}`,
    );
  }

  const validated = AnalystOutputSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Analist çıktısı şemaya uymadı: ${issues}`);
  }

  return {
    ...validated.data,
    meta: {
      modelUsed: response.modelUsed,
      latencyMs: response.latencyMs,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      costUsd: response.costUsd,
    },
  };
}
