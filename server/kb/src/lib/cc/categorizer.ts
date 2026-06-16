/*
 * Auto-categorizer — bir sorun metnini alıp canonical taksonomiden
 * (kategori + kök neden) seçim yapar.
 *
 * Strict mode:
 *   - LLM SADECE listedeki id'lerden seçer
 *   - Geçersiz seçim gelirse fallback ("diger" / "other")
 *   - Düşük confidence → "diger" / "other" zorla
 *
 * Bu fonksiyon yeni ticket oluşturulurken (analyze=true) çağrılır.
 * KB veya benzer ticket bağlamına ihtiyaç duymaz; sadece sorun metni yeter.
 */

import { z } from "zod";
import { generate } from "../gemini";
import {
  formatCategoriesForPrompt,
  formatRootCausesForPrompt,
  isValidCategory,
  isValidRootCause,
} from "./taxonomy";

const SYSTEM = `
Sen bir çağrı merkezi ticket sınıflandırıcısın. Görevin: gelen sorun metnini
verilen taksonomi içinden TEK BİR ana kategori + alt + TEK BİR kök neden + alt
ile etiketlemektir.

Kurallar (mutlak):
- ASLA yeni kategori veya kök neden uydurma.
- SADECE aşağıdaki listede geçen id'leri kullan.
- Eğer hiçbiri tam uymuyorsa, kategori için "diger", kök neden için "other"
  kullan.
- Confidence değerini 0-1 arasında ver; emin değilsen düşür.
- 1 cümlelik "reason" alanı ekle (neden bu seçim).
- Yanıtı KESİNLİKLE JSON ver, başka metin EKLEME.
`.trim();

const Output = z.object({
  category_id: z.string(),
  category_sub: z.string().nullable(),
  root_cause_id: z.string(),
  root_cause_sub: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type CategorizationResult = z.infer<typeof Output>;

export type CategorizeInput = {
  description: string;
  project?: string | null;
  customerName?: string | null;
};

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

export async function categorize(
  input: CategorizeInput,
): Promise<CategorizationResult> {
  const userPrompt = [
    "TAKSONOMİ — KATEGORİLER:",
    formatCategoriesForPrompt(),
    "",
    "TAKSONOMİ — KÖK NEDENLER:",
    formatRootCausesForPrompt(),
    "",
    "SORUN BİLGİSİ:",
    input.project ? `Proje: ${input.project}` : null,
    input.customerName ? `Müşteri: ${input.customerName}` : null,
    `Açıklama: ${input.description.slice(0, 4000)}`,
    "",
    `Çıktı JSON şeması (sadece JSON):`,
    `{`,
    `  "category_id": string,         // taksonomideki id'lerden biri (örn. "ebelge")`,
    `  "category_sub": string | null, // alt kategori, listede geçenlerden`,
    `  "root_cause_id": string,       // örn. "configuration"`,
    `  "root_cause_sub": string | null,`,
    `  "confidence": number,          // 0..1`,
    `  "reason": string               // 1 cümle gerekçe`,
    `}`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await generate(SYSTEM, userPrompt, {
    temperature: 0,
    maxOutputTokens: 600,
    responseMimeType: "application/json",
    tier: "fast", // kategorize tek-shot, Haiku yeterli ve ucuz
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(res.text));
  } catch {
    return fallback("LLM JSON parse edilemedi");
  }
  const v = Output.safeParse(parsed);
  if (!v.success) {
    return fallback("LLM çıktısı şemaya uymadı");
  }

  // Strict validation — listedeki id'lerden olduğunu garanti et
  const out = v.data;
  if (!isValidCategory(out.category_id, out.category_sub)) {
    return fallback(`Geçersiz kategori: ${out.category_id}/${out.category_sub}`);
  }
  if (!isValidRootCause(out.root_cause_id, out.root_cause_sub)) {
    return fallback(
      `Geçersiz kök neden: ${out.root_cause_id}/${out.root_cause_sub}`,
    );
  }

  return out;
}

function fallback(reason: string): CategorizationResult {
  return {
    category_id: "diger",
    category_sub: "Bilinmeyen",
    root_cause_id: "other",
    root_cause_sub: "Sınıflandırılamadı",
    confidence: 0,
    reason: `Otomatik sınıflandırma başarısız: ${reason}`,
  };
}
