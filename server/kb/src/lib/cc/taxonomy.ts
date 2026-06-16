/*
 * Taksonomi yükleyici — cc-taxonomy.json + cc-root-causes.json okur,
 * cache'ler, dropdown/LLM için yardımcılar sağlar.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

export type Category = {
  id: string;
  name: string;
  description: string;
  subs: string[];
};

export type RootCause = {
  id: string;
  name: string;
  description: string;
  typical_owner: "L1" | "L2";
  subs: string[];
};

let cachedCategories: Category[] | null = null;
let cachedRootCauses: RootCause[] | null = null;

export function loadCategories(): Category[] {
  if (cachedCategories) return cachedCategories;
  const p = path.resolve(process.cwd(), "data/cc-taxonomy.json");
  const data = JSON.parse(readFileSync(p, "utf8")) as {
    categories: Category[];
  };
  cachedCategories = data.categories;
  return cachedCategories;
}

export function loadRootCauses(): RootCause[] {
  if (cachedRootCauses) return cachedRootCauses;
  const p = path.resolve(process.cwd(), "data/cc-root-causes.json");
  const data = JSON.parse(readFileSync(p, "utf8")) as {
    root_causes: RootCause[];
  };
  cachedRootCauses = data.root_causes;
  return cachedRootCauses;
}

export function getCategoryById(id: string): Category | null {
  return loadCategories().find((c) => c.id === id) ?? null;
}

export function getRootCauseById(id: string): RootCause | null {
  return loadRootCauses().find((r) => r.id === id) ?? null;
}

export function formatCategoriesForPrompt(): string {
  return loadCategories()
    .map(
      (c) =>
        `- ${c.id}: ${c.name} — ${c.description}\n    Alt: ${c.subs.join(" | ")}`,
    )
    .join("\n");
}

export function formatRootCausesForPrompt(): string {
  return loadRootCauses()
    .map(
      (r) =>
        `- ${r.id}: ${r.name} (genelde ${r.typical_owner}) — ${r.description}\n    Alt: ${r.subs.join(" | ")}`,
    )
    .join("\n");
}

/**
 * Verilen (categoryId, sub) geçerli mi? LLM çıktısı doğrulanır.
 */
export function isValidCategory(id: string, sub: string | null): boolean {
  const cat = getCategoryById(id);
  if (!cat) return false;
  if (!sub) return true;
  return cat.subs.includes(sub);
}

export function isValidRootCause(id: string, sub: string | null): boolean {
  const rc = getRootCauseById(id);
  if (!rc) return false;
  if (!sub) return true;
  return rc.subs.includes(sub);
}
