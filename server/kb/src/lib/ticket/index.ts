/*
 * Ticket analiz pipeline — public API.
 *
 * runAnalysis: tek girdiyle (bildirimNo veya freeText) tüm pipeline'ı koşturur.
 *   1) Önce lokal snapshot'tan ticket'ı çekmeye çalış (hızlı).
 *   2) Yoksa view'a düş (yavaş).
 *   3) Benzer geçmiş kayıtları kosinüs araması ile bul.
 *   4) Taxonomy + matched + similar → Gemini analist.
 *   5) Sonucu data/ticket-analysis altına kaydet.
 */

import { z } from "zod";
import { getById as fetchById } from "./resolver";
import { getTicket as fetchLocal, type LocalTicket } from "./local-store";
import { searchSimilarByText, type SimilarHit } from "./similarity";
import { loadTaxonomy } from "./taxonomy";
import { runAnalyst, type AnalystResult } from "./analyst";
import { validateAndAnnotateSteps, ensureMentionedScreenFirst } from "./menu-validator";
import { redact } from "./redactor";
import { anonymizeCustomers, assertNoCustomerName } from "./anonymizer";
import {
  newAnalysisId,
  saveAnalysis,
  type AnalysisRecord,
} from "./storage";
import { getDb } from "./local-store";
import type { TicketRow } from "./types";
import { loadBundle as loadRecatBundle } from "./recategorizer";
import {
  recommendScreensForTicket,
  type PanoramaScreen,
} from "./panorama-docs";
import {
  consultForTicket,
  isNotebookLmEnabled,
  type NotebookLmAnswer,
} from "./notebooklm";
import { env } from "../env";
import { retrieve } from "../kb/retrieve";
import type { KbContextChunk } from "./prompts";

export const AnalyzeBodySchema = z
  .object({
    bildirimNo: z.number().int().positive().optional(),
    freeText: z.string().min(3).optional(),
    project: z.string().optional(),
    options: z
      .object({
        topK: z.number().int().min(1).max(50).optional(),
      })
      .optional(),
  })
  .refine((b) => b.bildirimNo || b.freeText, {
    message: "bildirimNo veya freeText gerekli",
  });

export type AnalyzeBody = z.infer<typeof AnalyzeBodySchema>;

type SimilarDetail = SimilarHit & {
  proje: string | null;
  kategori_uzun: string | null;
  kok_neden: string | null;
  aciklama: string | null;
  cozum: string | null;
  tfs_tip: string | null;
  bug_group: string | null;
};

function enrichSimilar(hits: SimilarHit[]): SimilarDetail[] {
  if (hits.length === 0) return [];
  const ids = hits.map((h) => h.bildirim_no);
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT bildirim_no, proje, kategori_uzun, kok_neden, aciklama, cozum,
              tfs_tip, bug_group
       FROM tickets WHERE bildirim_no IN (${placeholders})`,
    )
    .all(...ids) as Array<{
    bildirim_no: number;
    proje: string | null;
    kategori_uzun: string | null;
    kok_neden: string | null;
    aciklama: string | null;
    cozum: string | null;
    tfs_tip: string | null;
    bug_group: string | null;
  }>;
  const byId = new Map(rows.map((r) => [r.bildirim_no, r]));
  return hits
    .map((h): SimilarDetail | null => {
      const r = byId.get(h.bildirim_no);
      if (!r) return null;
      // Defense-in-depth: gösterilecek serbest metin alanlarını anonimleştir.
      // proje alanı tamamen elenir (müşteri kimliği). aciklama/cozum
      // içindeki müşteri adı geçişleri <MUSTERI> ile değiştirilir.
      const safe = {
        ...r,
        proje: null,
        aciklama: r.aciklama ? anonymizeCustomers(r.aciklama).text : null,
        cozum: r.cozum ? anonymizeCustomers(r.cozum).text : null,
      };
      return { ...h, ...safe };
    })
    .filter((x): x is SimilarDetail => x !== null);
}

function pickQueryText(
  freeText: string | null,
  matched: TicketRow | LocalTicket | null,
): string {
  if (freeText && freeText.trim().length > 0) return freeText;
  if (matched) {
    // matched TicketRow veya LocalTicket; her ikisinde de okuyabilen accessor.
    const m = matched as Partial<TicketRow> & Partial<LocalTicket>;
    return [
      m.Uzun_Kategori_Adi ?? m.kategori_uzun ?? "",
      m.Konunun_Kok_Nedeni ?? m.kok_neden ?? "",
      m.Bildirim_Aciklamasi ?? m.aciklama ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

export type AnalyzeResult = {
  analysisId: string;
  matched: TicketRow | LocalTicket | null;
  similar: SimilarDetail[];
  panoramaScreens: PanoramaScreen[];
  analysis: AnalystResult;
  notebookLm?: NotebookLmAnswer | null;
  /**
   * Analyst'e prompt-injection olarak verilen RAG alıntıları — UI'da gösterilebilir.
   * Geriye uyumluluk: hem birleşik dizi (kbChunks) hem kaynak-ayrımlı diziler.
   * API tüketicileri tercihen kbChunksN4b/kbChunksOther'a bakmalı; tek bir
   * "hangi chunk hangi kaynaktan" ayrımı için source_type da her chunk'ta var.
   */
  kbChunks?: KbContextChunk[];
  kbChunksN4b?: KbContextChunk[];
  kbChunksOther?: KbContextChunk[];
  // Orijinal input echo'su — UI'da NotebookLM consult için ticket bağlamı
  // kurulurken kullanılır (özellikle free-text modunda matched null'ken).
  input: {
    bildirimNo: number | null;
    freeText: string | null;
    project: string | null;
  };
};

function resolveCategoryId(bildirimNo: number | null): string | null {
  if (!bildirimNo) return null;
  const b = loadRecatBundle();
  if (!b) return null;
  return b.assignments.find((a) => a.bildirim_no === bildirimNo)?.category_id ?? null;
}

export async function runAnalysis(body: AnalyzeBody): Promise<AnalyzeResult> {
  // 1) matched record
  let matched: TicketRow | LocalTicket | null = null;
  if (body.bildirimNo) {
    matched = fetchLocal(body.bildirimNo);
    if (!matched) {
      // Lokalde yoksa view'a düş (yavaş ama tek-kayıt çekimi).
      matched = await fetchById(body.bildirimNo);
    }
  }

  // 2) similar geçmiş kayıtlar (redacted query text üzerinden)
  const rawQueryText = pickQueryText(body.freeText ?? null, matched);

  // Müşteri-anonimizasyon (sert reddet) — yalnız free-text modunda.
  // bildirim_no ile gelen aramada kullanıcı zaten o ticket'ı görüyor; sorgu
  // metni ticket açıklamasından türetiliyor ve müşteri adı içerebilir, ama
  // bu sızıntı değil (kullanıcı kendi ticket'ına bakıyor). Embedding her
  // durumda anonimize metinden hesaplanır → cross-customer benzerlik leak'i
  // engellenir.
  if (body.freeText && body.freeText.trim()) {
    assertNoCustomerName(body.freeText);
  }

  const { text: redactedText } = redact(rawQueryText);
  // Embedding'i müşteri-adı-temiz metin üzerinden hesapla. Aksi takdirde
  // "Pernod Ricard" yazılmamış olsa bile başka müşteri adlarını içeren
  // ticket'lar benzerlik üzerinden yüzeye çıkar.
  const { text: queryText } = anonymizeCustomers(redactedText);
  let similar: SimilarDetail[] = [];
  try {
    const hits = await searchSimilarByText(
      queryText,
      {
        proje: body.project ?? null,
        excludeBildirimNo: body.bildirimNo ?? null,
      },
      body.options?.topK,
    );
    similar = enrichSimilar(hits);
  } catch (err) {
    // Embedding cache boşsa veya API key yoksa similarity sessizce
    // boş kalır; analyst yine çalışır (sadece benzer kayıt göstermez).
    console.warn("similarity araması başarısız:", (err as Error).message);
  }

  // 3) taxonomy (lokal cache)
  const taxonomy = loadTaxonomy();

  // 3b) Panorama kılavuz ekranları — kategori havuzu + lexical re-rank
  const categoryId = resolveCategoryId(body.bildirimNo ?? null);
  const panoramaScreens = recommendScreensForTicket({
    categoryId,
    text: queryText,
    limit: 4,
  });

  // 4a) KB retrieval (RAG inline) — analyst ile paralel.
  // ÖNEMLİ: İki ayrı retrieve çağrısı yapıyoruz çünkü analyst response'unda
  // n4bGuidance ve otherDocsGuidance ayrı alanlar olarak çıkacak. Bu sayede
  // kullanıcı "N4B verisi gerçekten bu analize ne kattı?" sorusunun yanıtını
  // görsel olarak alır — boş geldiğinde "bu kaynakta ilgili bilgi yok" diye
  // belirir.
  const mapChunk = (h: { source_type: KbContextChunk["source_type"]; title: string | null; heading_path: string | null; content: string }, i: number): KbContextChunk => ({
    number: i + 1,
    source_type: h.source_type,
    title: h.title,
    heading_path: h.heading_path,
    excerpt: h.content.slice(0, 700),
  });

  const kbN4bPromise: Promise<KbContextChunk[]> = (async () => {
    try {
      const hits = await retrieve(queryText, {
        topK: 6,
        rerank: true,
        sourceTypes: ["operator_resolution"],
      });
      return hits.map(mapChunk);
    } catch (err) {
      console.warn("[kb] N4B retrieval başarısız:", (err as Error).message);
      return [];
    }
  })();

  const kbOtherPromise: Promise<KbContextChunk[]> = (async () => {
    try {
      const hits = await retrieve(queryText, {
        topK: 8,
        rerank: true,
        sourceTypes: ["panorama_screen", "ticket_resolution", "pdf"],
      });
      return hits.map(mapChunk);
    } catch (err) {
      console.warn("[kb] diğer dökümanlar retrieval başarısız:", (err as Error).message);
      return [];
    }
  })();

  // 4b) NotebookLM consult — opsiyonel; analyst ile PARALEL koş ki toplam
  // gecikme = max(analyst, notebooklm) olsun.
  const cfg = env();
  const notebookLmPromise: Promise<NotebookLmAnswer | null> =
    cfg.NOTEBOOKLM_AUTO_CONSULT && isNotebookLmEnabled()
      ? consultForTicket({
          bildirimNo: body.bildirimNo ?? null,
          proje:
            (matched as Partial<TicketRow> | null)?.PROJE ??
            (matched as Partial<LocalTicket> | null)?.proje ??
            body.project ??
            null,
          kategori:
            (matched as Partial<TicketRow> | null)?.Uzun_Kategori_Adi ??
            (matched as Partial<LocalTicket> | null)?.kategori_uzun ??
            null,
          kokNeden:
            (matched as Partial<TicketRow> | null)?.Konunun_Kok_Nedeni ??
            (matched as Partial<LocalTicket> | null)?.kok_neden ??
            null,
          aciklama:
            (matched as Partial<TicketRow> | null)?.Bildirim_Aciklamasi ??
            (matched as Partial<LocalTicket> | null)?.aciklama ??
            null,
          freeText: body.freeText ?? null,
        }).catch((err) => {
          // Auto-consult sessiz fail: analist çalışmaya devam etsin.
          console.warn(
            "[notebooklm] auto-consult başarısız:",
            (err as Error).message,
          );
          return null;
        })
      : Promise.resolve(null);

  // 4) analyst — iki ayrı KB grubu (N4B + diğerleri) önce gelmeli ki prompt'a
  // girsin; paralel başlatılır ama analyst başlamadan önce await edilir.
  const [kbChunksN4b, kbChunksOther] = await Promise.all([
    kbN4bPromise,
    kbOtherPromise,
  ]);
  // Geriye uyumluluk: kbChunks UI/persist katmanlarında hâlâ tek dizi
  // kullanıyor → N4B + diğerleri numara çakışmayacak şekilde birleştir.
  const kbChunks: KbContextChunk[] = [
    ...kbChunksN4b,
    ...kbChunksOther.map((c, i) => ({ ...c, number: kbChunksN4b.length + i + 1 })),
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
        bug_group: s.bug_group,
      })),
      taxonomy,
      panoramaScreens,
      kbChunksN4b,
      kbChunksOther,
    }),
    notebookLmPromise,
  ]);

  // 4b) Deterministik post-processing:
  //   1. Menü yolu doğrulama — LLM'in halüsine ettiği "X → Y → Z" yollarını
  //      panorama kılavuzundaki gerçek menuStep'lere karşı kontrol eder.
  //      Geçersizleri ya doğrusuyla değiştirir ya da [tahmin] etiketler.
  //   2. İlk-adım yeniden sıralama — sorun açıklamasında birebir geçen bir
  //      panorama ekranı varsa, suggestedSteps[0] o ekrana yönlendirmek
  //      ZORUNDADIR. Aksi halde diğer adımlardan ilgili olanı 1.'ye taşı veya
  //      başa yeni bir adım ekle.

  const { fixed: fixedSteps, corrections: menuCorrections } =
    validateAndAnnotateSteps(rawAnalysis.suggestedSteps);
  if (menuCorrections.length > 0) {
    console.log(
      `[menu-validator] ${menuCorrections.length} menü yolu düzeltildi/işaretlendi`,
    );
  }

  // Reorderer açıklama metni üzerinde çalışır. Açıklama önceliği:
  // free-text > matched.aciklama. Anonimleştirilmiş hali kullanılabilir
  // ama burada panorama ekran ADI aranıyor (müşteri adı değil) — orijinali
  // kullanmak doğru match için daha güvenli.
  const descForReorder =
    body.freeText ??
    (matched as Partial<TicketRow> | null)?.Bildirim_Aciklamasi ??
    (matched as Partial<LocalTicket> | null)?.aciklama ??
    null;
  const reorder = ensureMentionedScreenFirst(fixedSteps, descForReorder);
  if (reorder.changed) {
    console.log(
      `[step-reorder] adım sırası düzeltildi → ilk adım = "${reorder.targetScreenTitle}"`,
    );
  }

  const analysis: AnalystResult = {
    ...rawAnalysis,
    suggestedSteps: reorder.steps,
  };

  // 5) persist
  const seed = body.bildirimNo
    ? `tk-${body.bildirimNo}`
    : (body.freeText ?? "").slice(0, 40);
  const analysisId = newAnalysisId(seed);
  const record: AnalysisRecord = {
    meta: {
      analysisId,
      createdAt: new Date().toISOString(),
      mode: body.bildirimNo ? "bildirim_no" : "free_text",
      bildirimNo: body.bildirimNo ?? null,
      projectHint: body.project ?? null,
      modelUsed: analysis.meta.modelUsed,
      severity:
        analysis.inferred?.oncelik ??
        ((matched as Partial<TicketRow> | null)?.Oncelik ??
          (matched as Partial<LocalTicket> | null)?.oncelik ??
          null),
      category:
        ((matched as Partial<TicketRow> | null)?.Uzun_Kategori_Adi ??
          (matched as Partial<LocalTicket> | null)?.kategori_uzun ??
          null),
    },
    input: {
      bildirimNo: body.bildirimNo ?? null,
      freeText: body.freeText ?? null,
      project: body.project ?? null,
      queryTextRedacted: queryText,
    },
    analysis: { ...analysis, similar, panoramaScreens },
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
      project: body.project ?? null,
    },
  };
}
