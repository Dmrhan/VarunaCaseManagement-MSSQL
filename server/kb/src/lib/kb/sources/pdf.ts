/*
 * PDF connector — `data/kb/pdfs/` altındaki PDF dosyalarını sayfa metniyle
 * çıkartır, chunklar, KB'ye upsert eder.
 *
 * - pdf-parse v2 (pdfjs-dist tabanlı) sayfa bazında metin döner.
 * - Her PDF tek bir doc_id'ye sahiptir (`pdf:<filename>`).
 * - Metadata: dosya adı, sayfa sayısı, varsa info (yazar, başlık), mtime.
 * - content_hash dosyanın SHA256'sından türetilir → tekrar ingest'te
 *   değişmemiş PDF'ler yeniden chunk/embed edilmez.
 */

import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { chunkText } from "../chunker";
import { upsertDocument, type KbChunkInput } from "../db";

export type PdfIngestResult = {
  file: string;
  doc_id: string;
  changed: boolean;
  chunks: number;
  tokens: number;
  pages: number;
};

const DEFAULT_PDF_DIR = "data/kb/pdfs";

function sha256File(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 32);
}

function makeDocId(filename: string): string {
  // PDF'in kanonik ID'si dosya adından — aynı dosya yeniden ingest edilirse
  // upsert davranışı tetiklenir.
  const slug = filename
    .toLowerCase()
    .replace(/\.(pdf|docx?|md|txt)$/i, "")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `pdf:${slug}`;
}

/**
 * Bir PDF dosyasını ingest et.
 */
export async function ingestPdfFile(filePath: string): Promise<PdfIngestResult> {
  const { PDFParse } = await import("pdf-parse");
  const filename = path.basename(filePath);
  const data = readFileSync(filePath);
  const stat = statSync(filePath);
  const fileHash = sha256File(data);

  // pdf-parse v2 Uint8Array bekliyor
  const parser = new PDFParse({ data: new Uint8Array(data) });
  let pageTexts: string[] = [];
  let info: Record<string, unknown> | null = null;
  try {
    const textResult = await parser.getText();
    pageTexts = (textResult.pages ?? []).map((p) => p.text ?? "");
    try {
      const infoResult = await parser.getInfo();
      info = (infoResult.info as Record<string, unknown>) ?? null;
    } catch {
      info = null;
    }
  } finally {
    await parser.destroy().catch(() => {});
  }

  // Her sayfayı kendi başlığı altında birleştir (sayfa numarası heading olarak)
  // Sonra chunkText heading-aware bölme yapacak.
  const combined = pageTexts
    .map((t, i) => {
      const trimmed = (t ?? "").replace(/\s+\n/g, "\n").trim();
      if (!trimmed) return "";
      return `## Sayfa ${i + 1}\n\n${trimmed}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const rootHeading = filename.replace(/\.pdf$/i, "");
  const chunks: KbChunkInput[] = chunkText(combined, {
    rootHeading,
  }).map((c) => ({
    ord: c.ord,
    heading_path: c.heading_path,
    content: c.content,
    token_count: c.token_count,
  }));

  const { changed } = upsertDocument({
    doc_id: makeDocId(filename),
    source_type: "pdf",
    source_uri: filePath,
    title: rootHeading,
    metadata: {
      filename,
      pages: pageTexts.length,
      mtime: stat.mtime.toISOString(),
      size: stat.size,
      pdf_info: info,
    },
    content_hash: fileHash,
    chunks,
  });

  return {
    file: filename,
    doc_id: makeDocId(filename),
    changed,
    chunks: chunks.length,
    tokens: chunks.reduce((s, c) => s + c.token_count, 0),
    pages: pageTexts.length,
  };
}

/**
 * data/kb/pdfs/ klasöründeki tüm PDF'leri ingest et.
 */
export async function ingestAllPdfs(
  dir: string = DEFAULT_PDF_DIR,
): Promise<PdfIngestResult[]> {
  const root = path.resolve(process.cwd(), dir);
  if (!existsSync(root)) {
    console.warn(`[kb/pdf] dizin yok: ${root} — atlanıyor`);
    return [];
  }
  const files = readdirSync(root)
    .filter((f) => /\.pdf$/i.test(f))
    .map((f) => path.join(root, f));

  const results: PdfIngestResult[] = [];
  for (const file of files) {
    try {
      const r = await ingestPdfFile(file);
      results.push(r);
      console.log(
        `[kb/pdf] ${path.basename(file)}: ${r.changed ? "✓ updated" : "= unchanged"} (${r.pages} sayfa, ${r.chunks} chunk, ${r.tokens} token)`,
      );
    } catch (err) {
      console.error(
        `[kb/pdf] ${path.basename(file)}: hata — ${(err as Error).message}`,
      );
    }
  }
  return results;
}
