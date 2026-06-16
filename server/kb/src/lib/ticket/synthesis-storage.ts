import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/*
 * Sentezlenmiş "bilinen sorun" kayıtları — data/known-issues/<id>/.
 *   meta.json      : { id, groupBy, groupKey, totalInGroup, sampledCount,
 *                      ticketIds, modelUsed, latencyMs, createdAt, updatedAt }
 *   synthesis.json : tam LLM çıktısı (pattern + variants + canonical + edge ...)
 *
 * ID deterministik: groupBy + groupKey → aynı grup için yeniden üretildiğinde
 * üzerine yazılır (yeni dosya oluşmaz).
 */

const ROOT = () => path.resolve(process.cwd(), "data", "known-issues");

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ığşöçü]/g, (c) =>
      ({ ı: "i", ğ: "g", ş: "s", ö: "o", ç: "c", ü: "u" })[c] ?? c,
    )
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function synthesisIdFor(groupBy: string, groupKey: string): string {
  const hash = createHash("sha256")
    .update(`${groupBy}::${groupKey}`)
    .digest("hex")
    .slice(0, 6);
  const sg = slug(groupBy);
  const sk = slug(groupKey) || "noname";
  return `synth-${sg}-${sk}-${hash}`;
}

export type SynthesisMeta = {
  id: string;
  groupBy: string;
  groupKey: string;
  totalInGroup: number;
  sampledCount: number;
  ticketIds: number[];
  modelUsed: string;
  latencyMs: number;
  createdAt: string;
  updatedAt: string;
};

export type SynthesisRecord = {
  meta: SynthesisMeta;
  synthesis: unknown;
};

function dirOf(id: string): string {
  return path.join(ROOT(), id);
}

export function saveSynthesis(rec: SynthesisRecord): string {
  const d = dirOf(rec.meta.id);
  mkdirSync(d, { recursive: true });
  // Eğer mevcut bir kayıt varsa createdAt'i koru, sadece updatedAt güncelle.
  const existingPath = path.join(d, "meta.json");
  if (existsSync(existingPath)) {
    try {
      const prev = JSON.parse(readFileSync(existingPath, "utf8")) as SynthesisMeta;
      rec.meta.createdAt = prev.createdAt;
    } catch {
      // bozuksa olduğu gibi devam
    }
  }
  writeFileSync(existingPath, JSON.stringify(rec.meta, null, 2));
  writeFileSync(
    path.join(d, "synthesis.json"),
    JSON.stringify(rec.synthesis, null, 2),
  );
  return rec.meta.id;
}

export function loadSynthesis(id: string): SynthesisRecord | null {
  const d = dirOf(id);
  if (!existsSync(d)) return null;
  try {
    const meta = JSON.parse(readFileSync(path.join(d, "meta.json"), "utf8")) as SynthesisMeta;
    const synthesis = JSON.parse(
      readFileSync(path.join(d, "synthesis.json"), "utf8"),
    ) as unknown;
    return { meta, synthesis };
  } catch {
    return null;
  }
}

export function listSyntheses(limit = 100): SynthesisMeta[] {
  if (!existsSync(ROOT())) return [];
  const ids = readdirSync(ROOT(), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const out: SynthesisMeta[] = [];
  for (const id of ids) {
    const metaPath = path.join(dirOf(id), "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      out.push(JSON.parse(readFileSync(metaPath, "utf8")) as SynthesisMeta);
    } catch {
      // skip
    }
  }
  return out
    .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
    .slice(0, limit);
}
