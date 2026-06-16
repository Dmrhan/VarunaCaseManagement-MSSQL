import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

/*
 * Filesystem storage — analizler, feedback, handoff.
 *
 * Dizinler:
 *   data/ticket-analysis/<analysisId>/
 *     meta.json
 *     input.json       redact edilmiş giriş
 *     analysis.json    LLM çıktısı + similar liste
 *     run.json         opsiyonel debug — üretilen SQL'ler, timing
 *     feedback.jsonl   append-only
 */

const ROOT = () => path.resolve(process.cwd(), "data");

function analysisDir(analysisId: string): string {
  return path.join(ROOT(), "ticket-analysis", analysisId);
}

function handoffPath(analysisId: string): string {
  return path.join(ROOT(), "handoffs", `${analysisId}.md`);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ığşöçü]/g, (c) =>
      ({ ı: "i", ğ: "g", ş: "s", ö: "o", ç: "c", ü: "u" })[c] ?? c,
    )
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function newAnalysisId(seed?: string): string {
  const hash = createHash("sha256")
    .update(seed ?? randomBytes(8))
    .digest("hex")
    .slice(0, 6);
  const slug = seed ? slugify(seed) : randomBytes(4).toString("hex");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${stamp}-${slug || "analiz"}-${hash}`;
}

export type AnalysisMeta = {
  analysisId: string;
  createdAt: string;
  mode: "bildirim_no" | "free_text";
  bildirimNo: number | null;
  projectHint: string | null;
  modelUsed: string;
  severity: string | null;
  category: string | null;
};

export type AnalysisRecord = {
  meta: AnalysisMeta;
  input: unknown;
  analysis: unknown;
};

export function saveAnalysis(rec: AnalysisRecord): string {
  const dir = analysisDir(rec.meta.analysisId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify(rec.meta, null, 2));
  writeFileSync(path.join(dir, "input.json"), JSON.stringify(rec.input, null, 2));
  writeFileSync(path.join(dir, "analysis.json"), JSON.stringify(rec.analysis, null, 2));
  return rec.meta.analysisId;
}

export function loadAnalysis(analysisId: string): AnalysisRecord | null {
  const dir = analysisDir(analysisId);
  if (!existsSync(dir)) return null;
  const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as AnalysisMeta;
  const input = JSON.parse(readFileSync(path.join(dir, "input.json"), "utf8")) as unknown;
  const analysis = JSON.parse(
    readFileSync(path.join(dir, "analysis.json"), "utf8"),
  ) as unknown;
  return { meta, input, analysis };
}

export function listAnalyses(limit = 50): AnalysisMeta[] {
  const dir = path.join(ROOT(), "ticket-analysis");
  if (!existsSync(dir)) return [];
  const ids = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse()
    .slice(0, limit);
  const metas: AnalysisMeta[] = [];
  for (const id of ids) {
    const metaFile = path.join(dir, id, "meta.json");
    if (!existsSync(metaFile)) continue;
    try {
      metas.push(JSON.parse(readFileSync(metaFile, "utf8")) as AnalysisMeta);
    } catch {
      // skip corrupt
    }
  }
  return metas;
}

export type Feedback = {
  feedbackId: string;
  analysisId: string;
  verdict: "solved" | "not_solved" | "escalate_engineering";
  note?: string;
  appliedSolutionId?: string;
  createdAt: string;
};

export function appendFeedback(fb: Feedback): void {
  const dir = analysisDir(fb.analysisId);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, "feedback.jsonl"), JSON.stringify(fb) + "\n");
}

export function writeHandoff(analysisId: string, markdown: string): string {
  const p = handoffPath(analysisId);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, markdown);
  return p;
}
