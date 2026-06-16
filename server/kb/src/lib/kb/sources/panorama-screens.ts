/*
 * Panorama screens connector — mevcut `data/panorama-docs/screens.json` (440
 * ekran kılavuzu) içeriğini KB'ye ingest eder. Her ekran kendi doc_id'sine
 * sahip olur; çoğunda tek chunk yeterli (rawText ortalama küçük), uzun
 * olanlar chunker tarafından bölünür.
 *
 * Avantaj: ekran zaten yapılı (breadcrumb, menuStep, fields, buttons) —
 * bu metadata heading_path olarak chunk'lara ekleniyor, retrieval'da
 * provenance açık.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { chunkText } from "../chunker";
import { hashContent, upsertDocument, type KbChunkInput } from "../db";

type PanoramaField = { name: string; description: string };
type PanoramaScreen = {
  id: string;
  breadcrumb: string[];
  modulePath: string[];
  title: string;
  menuStep: string | null;
  summary: string | null;
  fields: PanoramaField[];
  buttons: PanoramaField[];
  rawText: string;
};

const DEFAULT_PATH = "data/panorama-docs/screens.json";

export type ScreenIngestResult = {
  screenId: string;
  doc_id: string;
  changed: boolean;
  chunks: number;
};

function buildScreenText(s: PanoramaScreen): string {
  const parts: string[] = [];

  if (s.menuStep) parts.push(`# ${s.title}\n\nMenü: ${s.menuStep}`);
  else parts.push(`# ${s.title}`);

  if (s.summary) parts.push(`## Özet\n\n${s.summary}`);

  if (s.fields.length > 0) {
    parts.push(
      `## Alanlar\n\n${s.fields
        .map((f) => `- **${f.name}**: ${f.description}`)
        .join("\n")}`,
    );
  }
  if (s.buttons.length > 0) {
    parts.push(
      `## Butonlar\n\n${s.buttons
        .map((b) => `- **${b.name}**: ${b.description}`)
        .join("\n")}`,
    );
  }

  // rawText'i de bağlam olarak ekle ama mükerrer kelimeleri filtrele:
  // Çoğunlukla yukarıdaki alan/buton listelerinin daha gürültülü hali. Yine
  // de retrieval recall'ı için tut.
  if (s.rawText) {
    const cleaned = s.rawText
      .replace(/\s+/g, " ")
      .replace(/[\r\n]+/g, "\n")
      .trim();
    if (cleaned.length > 50) {
      parts.push(`## Ham İçerik\n\n${cleaned}`);
    }
  }

  return parts.join("\n\n");
}

export function ingestPanoramaScreens(
  jsonPath: string = DEFAULT_PATH,
): ScreenIngestResult[] {
  const full = path.resolve(process.cwd(), jsonPath);
  if (!existsSync(full)) {
    console.warn(`[kb/screens] dosya yok: ${full} — atlanıyor`);
    return [];
  }
  const raw = readFileSync(full, "utf8");
  const screens = JSON.parse(raw) as PanoramaScreen[];

  const out: ScreenIngestResult[] = [];
  let changedCount = 0;

  for (const s of screens) {
    const text = buildScreenText(s);
    if (!text.trim()) continue;

    const rootHeading = [s.breadcrumb.join(" > "), s.title]
      .filter(Boolean)
      .join(" — ");
    const chunks: KbChunkInput[] = chunkText(text, {
      rootHeading,
      maxTokens: 800,
      minTokens: 60,
      overlapTokens: 60,
    }).map((c) => ({
      ord: c.ord,
      heading_path: c.heading_path,
      content: c.content,
      token_count: c.token_count,
    }));

    if (chunks.length === 0) continue;

    const docId = `screen:${s.id}`;
    const { changed } = upsertDocument({
      doc_id: docId,
      source_type: "panorama_screen",
      source_uri: jsonPath,
      title: s.title,
      metadata: {
        screen_id: s.id,
        breadcrumb: s.breadcrumb,
        modulePath: s.modulePath,
        menuStep: s.menuStep,
        fields_count: s.fields.length,
        buttons_count: s.buttons.length,
      },
      content_hash: hashContent(text),
      chunks,
    });
    if (changed) changedCount++;
    out.push({
      screenId: s.id,
      doc_id: docId,
      changed,
      chunks: chunks.length,
    });
  }

  console.log(
    `[kb/screens] ${out.length} ekran (${changedCount} güncellendi, ${out.length - changedCount} değişmemiş)`,
  );
  return out;
}
