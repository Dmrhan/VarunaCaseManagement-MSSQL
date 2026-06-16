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
 * Yerli çözüm bankası — data/solutions/<id>/.
 *
 * meta.json: { id, title, tags[], categories[], severity?, createdAt }
 * solution.md: Markdown gövde
 *
 * MVP'de basit substring araması. İleride embedding ile semantic search.
 */

const ROOT = () => path.resolve(process.cwd(), "data", "solutions");

export type SolutionMeta = {
  id: string;
  title: string;
  tags: string[];
  categories: string[];
  severity?: string | null;
  createdAt: string;
};

export type Solution = SolutionMeta & { body: string };

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

export function newSolutionId(title: string): string {
  const hash = createHash("sha256")
    .update(title + Date.now())
    .digest("hex")
    .slice(0, 6);
  return `${slug(title) || "cozum"}-${hash}`;
}

function dirOf(id: string): string {
  return path.join(ROOT(), id);
}

export function listSolutions(): SolutionMeta[] {
  if (!existsSync(ROOT())) return [];
  const ids = readdirSync(ROOT(), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const out: SolutionMeta[] = [];
  for (const id of ids) {
    const metaPath = path.join(dirOf(id), "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      out.push(JSON.parse(readFileSync(metaPath, "utf8")) as SolutionMeta);
    } catch {
      // skip
    }
  }
  return out.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
}

export function getSolution(id: string): Solution | null {
  const d = dirOf(id);
  if (!existsSync(d)) return null;
  const meta = JSON.parse(readFileSync(path.join(d, "meta.json"), "utf8")) as SolutionMeta;
  const body = readFileSync(path.join(d, "solution.md"), "utf8");
  return { ...meta, body };
}

export function saveSolution(input: {
  title: string;
  body: string;
  tags?: string[];
  categories?: string[];
  severity?: string | null;
}): Solution {
  const id = newSolutionId(input.title);
  const meta: SolutionMeta = {
    id,
    title: input.title,
    tags: input.tags ?? [],
    categories: input.categories ?? [],
    severity: input.severity ?? null,
    createdAt: new Date().toISOString(),
  };
  const d = dirOf(id);
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, "meta.json"), JSON.stringify(meta, null, 2));
  writeFileSync(path.join(d, "solution.md"), input.body);
  return { ...meta, body: input.body };
}

/** Basit substring araması — title + tag + body üzerinde. */
export function searchSolutions(query: string, limit = 20): SolutionMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return listSolutions().slice(0, limit);
  const all = listSolutions();
  const hits: Array<{ meta: SolutionMeta; score: number }> = [];
  for (const m of all) {
    let score = 0;
    if (m.title.toLowerCase().includes(q)) score += 3;
    if (m.tags.some((t) => t.toLowerCase().includes(q))) score += 2;
    if (m.categories.some((c) => c.toLowerCase().includes(q))) score += 2;
    if (score === 0) {
      try {
        const body = readFileSync(path.join(dirOf(m.id), "solution.md"), "utf8");
        if (body.toLowerCase().includes(q)) score += 1;
      } catch {
        // skip
      }
    }
    if (score > 0) hits.push({ meta: m, score });
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((h) => h.meta);
}
