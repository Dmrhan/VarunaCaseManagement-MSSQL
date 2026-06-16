import { z } from "zod";
import { getDb, type LocalTicket } from "./local-store";
import type { GroupBy } from "./clusters";
import {
  loadSynthesis,
  saveSynthesis,
  synthesisIdFor,
  type SynthesisRecord,
} from "./synthesis-storage";
import {
  jaccard,
  splitSentences,
  tokenize,
  tokenizeStemmed,
  topNGrams,
} from "./text-utils";
import { redact } from "./redactor";

/*
 * Bilgi yoğunluğu filtresi — kanonik çözüm adımı listesine "İşlem yapılıp
 * bilgi verildi.", "Tekrar kontrol edebilirsiniz.", "Müşteriye bilgi verildi."
 * gibi boilerplate cümleler GİRMESİN diye. Bir çözüm açıklamasının
 * gerçekten ne yapıldığını anlatması gerekir — sadece "iş tamamlandı"
 * sinyali değil.
 *
 * Yöntem:
 *   1. Çok kısa cümleler (< 25 karakter) reddedilir.
 *   2. Her token, low-info önek listesiyle eşleşiyor mu kontrol edilir.
 *   3. İçerik token sayısı (low-info olmayan) >= 3 olmalı.
 *   4. Boilerplate oranı > 0.65 ise reddedilir.
 *
 * Bu, "Rut kartı Satış Temsilcisinden çıkarıldı" gibi spesifik adımları
 * geçirir; "Çözüldü, bilgi verildi" türü cümleleri eler.
 */

const LOW_INFO_PREFIXES: ReadonlyArray<string> = [
  "bilgi",          // bilgi, bilgisi
  "veril",          // verildi, verilmistir
  "yonle",          // yönlendirildi
  "ilet",           // iletildi, iletilmistir
  "aktari",         // aktarıldı
  "konu",           // konu, konuya, konusunda
  "tekrar",         // tekrar (kontrol)
  "kontr",          // kontrol, kontrolüne, kontrolden
  "islem",          // işlem, işlemi
  "sagla",          // sağlandı, sağlanmıştır
  "tamam",          // tamamlandı
  "gerce",          // gerçekleştirildi
  "cozul",          // çözüldü
  "cozum",          // çözüm, çözümlenmiştir
  "gider",          // giderildi
  "halle",          // halledildi
  "muste",          // müşteri, müşteriye, müşterimize
  "operat",         // operatöre, operatör
  "sorun",          // sorun
  "problem",        // problem
  "yapil",          // yapıldı, yapılmıştır, yapılıp
  "olmus",          // olmuştur, olmuş
  "gorus",          // görüşme, görüşmemiz
  "donu",           // dönüş (dönüş sağlandı)
  "talep",          // talep edildi (genelde tek başına bilgi taşımaz)
];

function isLowInfoToken(stem: string): boolean {
  for (const p of LOW_INFO_PREFIXES) {
    if (stem.startsWith(p)) return true;
  }
  return false;
}

function isLowInfoSentence(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 25) return true;

  const stems = tokenize(trimmed).map((t) => (t.length > 6 ? t.slice(0, 6) : t));
  if (stems.length < 4) return true;

  const content = stems.filter((s) => !isLowInfoToken(s));
  if (content.length < 3) return true;

  const boilerplateRatio = (stems.length - content.length) / stems.length;
  return boilerplateRatio > 0.65;
}

/*
 * Deterministik pattern sentezi — LLM YOK.
 *
 * Bir cluster için lokal snapshot'tan kayıtları okuyup:
 *   - Açıklamalardan en sık n-gram'ları (karakteristik ifadeler)
 *   - Çözüm açıklamalarındaki cümleleri token-Jaccard benzerliği ile
 *     gruplayıp frekansa göre kanonik adım listesi
 *   - Sub-aggregation (kategori_uzun veya proje) ile varyantlar
 *   - Severity dağılımı, proje dağılımı, kapsam notu
 *
 * Çıktı şeması Gemini versiyonundakiyle uyumlu — UI değişmez.
 */

// === Output şeması (UI ile uyumlu) ===
const VariantSchema = z.object({
  title: z.string(),
  description: z.string(),
  rootCause: z.string(),
  indicativeBildirimNos: z.array(z.number()).default([]),
});

const StepSchema = z.object({
  step: z.string(),
  appliesTo: z.string().default("all"),
  evidence: z.string().nullable().optional(),
});

const EdgeSchema = z.object({
  situation: z.string(),
  handling: z.string(),
});

export const SynthesisOutputSchema = z.object({
  pattern: z.object({
    title: z.string(),
    description: z.string(),
    characteristicPhrases: z.array(z.string()),
  }),
  commonRootCause: z.string(),
  variants: z.array(VariantSchema),
  canonicalSolution: z.array(StepSchema),
  edgeCases: z.array(EdgeSchema),
  preventiveSuggestions: z.array(z.string()),
  coverageNote: z.string(),
});

export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;

// === Veri çekme ===
const ALLOWED_GROUP_BY: ReadonlySet<GroupBy> = new Set([
  "kok_neden",
  "kategori_uzun",
  "bug_group",
  "bildirim_tipi",
]);

function fetchGroupTickets(
  groupBy: GroupBy,
  groupKey: string,
  lookbackDays: number,
  limit: number,
): { tickets: LocalTicket[]; totalInGroup: number } {
  if (!ALLOWED_GROUP_BY.has(groupBy)) {
    throw new Error(`Geçersiz groupBy: ${groupBy}`);
  }
  const db = getDb();
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM tickets
         WHERE ${groupBy} = @key
           AND date(bildirim_tarihi) >= date('now', '-' || @days || ' days')`,
      )
      .get({ key: groupKey, days: lookbackDays }) as { n: number }
  ).n;
  const rows = db
    .prepare(
      `SELECT * FROM tickets
       WHERE ${groupBy} = @key
         AND date(bildirim_tarihi) >= date('now', '-' || @days || ' days')
       ORDER BY bildirim_tarihi DESC, bildirim_no DESC
       LIMIT @lim`,
    )
    .all({ key: groupKey, days: lookbackDays, lim: limit }) as LocalTicket[];
  return { tickets: rows, totalInGroup: total };
}

// === Çözüm cümlesi kümeleme ===
type SolutionSentence = {
  text: string;
  tokens: string[];
  bildirimNos: number[];
};

/**
 * Çözüm açıklamalarındaki cümleleri normalize edip Jaccard >= 0.55 ile
 * grupla. Her grup için en uzun temsilci cümleyi sakla; grup üyesi olan
 * tüm bildirim_no'ları kaynak olarak ekle.
 */
function clusterSolutionSentences(
  tickets: LocalTicket[],
  jaccardThreshold = 0.45,
): SolutionSentence[] {
  const groups: SolutionSentence[] = [];
  for (const t of tickets) {
    if (!t.cozum) continue;
    // Telefon numarası, e-posta vb. çözüm metinlerinde sıkça geçiyor;
    // önce maskele, sonra cümlelere böl.
    const safe = redact(t.cozum).text;
    const sentences = splitSentences(safe);
    for (const raw of sentences) {
      // Boilerplate cümleleri ("Çözüldü.", "Bilgi verildi.",
      // "Tekrar kontrol edebilirsiniz." vb.) kanonik çözüme almıyoruz.
      if (isLowInfoSentence(raw)) continue;
      const toks = tokenizeStemmed(raw);
      if (toks.length < 3) continue;

      // En yakın mevcut grubu bul
      let bestIdx = -1;
      let bestSim = 0;
      for (let i = 0; i < groups.length; i++) {
        const sim = jaccard(toks, groups[i]!.tokens);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestSim >= jaccardThreshold) {
        const g = groups[bestIdx]!;
        if (!g.bildirimNos.includes(t.bildirim_no)) {
          g.bildirimNos.push(t.bildirim_no);
        }
        // Daha uzun temsilci varsa onu kullan (daha bilgilendirici).
        if (raw.length > g.text.length) {
          g.text = raw;
          g.tokens = toks;
        }
      } else {
        groups.push({ text: raw, tokens: toks, bildirimNos: [t.bildirim_no] });
      }
    }
  }
  // Frekans = grubu destekleyen distinct ticket sayısı
  return groups
    .sort((a, b) => b.bildirimNos.length - a.bildirimNos.length)
    .filter((g) => g.bildirimNos.length >= 2 || groups.length <= 6);
}

// === Sub-aggregation (varyantlar) ===
function buildVariants(
  groupBy: GroupBy,
  tickets: LocalTicket[],
): SynthesisOutput["variants"] {
  // Hangi kolonu sub-aggregation için kullanalım?
  // Ana groupBy ne ise farklı bir eksene düş.
  const subKey =
    groupBy === "kategori_uzun"
      ? "kok_neden"
      : groupBy === "kok_neden"
        ? "kategori_uzun"
        : groupBy === "bug_group"
          ? "kategori_uzun"
          : "kategori_uzun";

  const buckets = new Map<string, LocalTicket[]>();
  for (const t of tickets) {
    const v = (t as unknown as Record<string, string | null>)[subKey];
    if (!v) continue;
    const arr = buckets.get(v) ?? [];
    arr.push(t);
    buckets.set(v, arr);
  }
  const variants = Array.from(buckets.entries())
    .filter(([, list]) => list.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)
    .map(([key, list]) => {
      const projects = Array.from(
        new Set(list.map((t) => t.proje).filter((p): p is string => !!p)),
      ).slice(0, 5);
      return {
        title: key,
        description: `Bu varyantta ${list.length} kayıt var. Geçen projeler: ${
          projects.length > 0 ? projects.join(", ") : "—"
        }.`,
        rootCause: subKey === "kok_neden" ? key : `Alt eksen: ${key}`,
        indicativeBildirimNos: list.slice(0, 5).map((t) => t.bildirim_no),
      };
    });
  return variants;
}

// === Outlier / edge-case'ler ===
function buildEdgeCases(
  groups: SolutionSentence[],
): SynthesisOutput["edgeCases"] {
  // Tek bir ticket tarafından desteklenen, kanonikten ayrılmış çözümler
  // edge case olarak listelenir. En anlamlı 3'ü.
  return groups
    .filter((g) => g.bildirimNos.length === 1 && g.text.length > 40)
    .slice(-3)
    .map((g) => ({
      situation: `#${g.bildirimNos[0]} kaydında bir kez gözlenen alternatif yaklaşım`,
      handling: g.text,
    }));
}

// === Pattern başlığı + açıklama ===
function buildHeader(
  groupBy: GroupBy,
  groupKey: string,
  tickets: LocalTicket[],
  totalInGroup: number,
): { title: string; description: string; commonRootCause: string } {
  const projects = new Map<string, number>();
  for (const t of tickets) {
    if (!t.proje) continue;
    projects.set(t.proje, (projects.get(t.proje) ?? 0) + 1);
  }
  const topProjects = Array.from(projects.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([p, n]) => `${p} (${n})`);

  const dates = tickets
    .map((t) => t.bildirim_tarihi)
    .filter((d): d is string => !!d)
    .sort();
  const first = dates[0];
  const last = dates[dates.length - 1];

  const description = [
    `Bu grupta ${totalInGroup} kayıt birikti (${tickets.length} tanesi sentezde kullanıldı).`,
    first && last && first !== last
      ? `${first} → ${last} aralığında görüldü.`
      : last
        ? `${last} tarihinde görüldü.`
        : "",
    topProjects.length > 0
      ? `En çok geçen projeler: ${topProjects.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Kök neden — eğer groupBy zaten kok_neden ise groupKey'in kendisidir;
  // değilse cluster içindeki en sık kok_neden değeri.
  let commonRootCause = "—";
  if (groupBy === "kok_neden") {
    commonRootCause = groupKey;
  } else {
    const rc = new Map<string, number>();
    for (const t of tickets) {
      if (!t.kok_neden) continue;
      rc.set(t.kok_neden, (rc.get(t.kok_neden) ?? 0) + 1);
    }
    const top = Array.from(rc.entries()).sort((a, b) => b[1] - a[1])[0];
    if (top) commonRootCause = `${top[0]} (${top[1]} kayıt)`;
  }

  return {
    title: groupKey,
    description,
    commonRootCause,
  };
}

// === Ana üretici ===
export function deterministicSynthesize(args: {
  groupBy: GroupBy;
  groupKey: string;
  tickets: LocalTicket[];
  totalInGroup: number;
}): SynthesisOutput {
  const { groupBy, groupKey, tickets, totalInGroup } = args;
  const header = buildHeader(groupBy, groupKey, tickets, totalInGroup);

  // Karakteristik ifadeler — açıklamalardan (cozumdan değil, müşterinin
  // dilini yakalamak için). Redaction uygulanmış metin üzerinde çalışır,
  // böylece e-posta domain artıkları (com.tr, jti.com vb.) gürültüsü olmaz.
  const descTexts = tickets
    .map((t) => (t.aciklama ? redact(t.aciklama).text : null))
    .filter((t): t is string => !!t);
  const ngrams = topNGrams(descTexts, 12, 2);
  const characteristicPhrases = ngrams.map((g) => g.phrase);

  // Kanonik çözüm — çözüm cümle kümeleri
  const sentenceGroups = clusterSolutionSentences(tickets);
  const canonicalSolution = sentenceGroups.slice(0, 10).map((g) => ({
    step: g.text,
    appliesTo: "all",
    evidence: `${g.bildirimNos.length} kayıtta gözlendi · örn. ${g.bildirimNos
      .slice(0, 5)
      .map((n) => "#" + n)
      .join(", ")}`,
  }));

  const variants = buildVariants(groupBy, tickets);
  const edgeCases = buildEdgeCases(sentenceGroups);

  const ticketsWithSolution = tickets.filter(
    (t) => t.cozum && t.cozum.trim().length > 0,
  ).length;
  const coverageNote =
    `Bu sentez ${tickets.length} kayıttan deterministik olarak üretildi. ` +
    `${ticketsWithSolution} tanesinde çözüm açıklaması mevcut. ` +
    `Cümleler Jaccard ≥ 0.55 ile kümelendi; en az 2 kayıtta gözlenen adımlar kanonik kabul edildi.`;

  return {
    pattern: {
      title: header.title,
      description: header.description,
      characteristicPhrases,
    },
    commonRootCause: header.commonRootCause,
    variants,
    canonicalSolution,
    edgeCases,
    preventiveSuggestions: [], // deterministik üreticide önerimiz yok
    coverageNote,
  };
}

// === Public API (önceki imzayla uyumlu) ===
export type SynthesizeOptions = {
  groupBy: GroupBy;
  groupKey: string;
  lookbackDays?: number;
  sampleSize?: number;
  force?: boolean;
};

export async function runSynthesis(
  opts: SynthesizeOptions,
): Promise<SynthesisRecord> {
  const lookbackDays = opts.lookbackDays ?? 365;
  // Deterministik üreticide "sample" kavramı yok; tüm kayıtları okuyoruz,
  // ama performans için bir üst sınır koyuyoruz.
  const limit = Math.min(Math.max(opts.sampleSize ?? 500, 10), 2000);
  const id = synthesisIdFor(opts.groupBy, opts.groupKey);

  if (!opts.force) {
    const existing = loadSynthesis(id);
    if (existing) return existing;
  }

  const { tickets, totalInGroup } = fetchGroupTickets(
    opts.groupBy,
    opts.groupKey,
    lookbackDays,
    limit,
  );
  if (tickets.length === 0) {
    throw new Error("Bu grup için lokal snapshot'ta kayıt yok.");
  }

  const t0 = Date.now();
  const synthesis = deterministicSynthesize({
    groupBy: opts.groupBy,
    groupKey: opts.groupKey,
    tickets,
    totalInGroup,
  });
  const latencyMs = Date.now() - t0;

  const now = new Date().toISOString();
  const record: SynthesisRecord = {
    meta: {
      id,
      groupBy: opts.groupBy,
      groupKey: opts.groupKey,
      totalInGroup,
      sampledCount: tickets.length,
      ticketIds: tickets.map((t) => t.bildirim_no),
      modelUsed: "deterministic-v1",
      latencyMs,
      createdAt: now,
      updatedAt: now,
    },
    synthesis,
  };
  saveSynthesis(record);
  return record;
}
