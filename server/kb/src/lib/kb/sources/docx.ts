/*
 * DOCX connector — Word dosyalarını (.docx) mammoth ile düz metin olarak
 * çıkartıp KB'ye ingest eder. Aynı PDF connector'a paralel akışı izler.
 *
 * Mammoth tipik DOCX'i Markdown'a yakın bir formata çevirir; biz HTML değil
 * `convertToMarkdown` çıktısını kullanıyoruz çünkü chunker zaten markdown
 * başlıklarını (`#`, `##`) tanıyor.
 *
 * Doc_id: `docx:<slug>` — PDF ile karışmasın diye ayrı namespace.
 */

import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { chunkText } from "../chunker";
import { upsertDocument, type KbChunkInput } from "../db";

export type DocxIngestResult = {
  file: string;
  doc_id: string;
  changed: boolean;
  chunks: number;
  tokens: number;
  warnings: number;
};

const DEFAULT_DOCS_DIR = "data/kb/docs";

function sha256File(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 32);
}

function makeDocId(filename: string): string {
  const slug = filename
    .toLowerCase()
    .replace(/\.(pdf|docx?|md|txt)$/i, "")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `docx:${slug}`;
}

/**
 * mammoth HTML çıktısını chunker-dostu markdown-benzeri metne çevir.
 * Sadece başlıkları (`<h1..6>`) `#` prefixiyle korumalı, liste/paragraf
 * boşluklarını normalize eder. Tablolar ve mizanpaj atılır (RAG için
 * gürültü).
 */
function htmlToMarkdownish(html: string): string {
  let out = html
    // Heading'leri "# Heading" formatına
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, (_, t: string) => `\n\n# ${stripTags(t)}\n\n`)
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, (_, t: string) => `\n\n## ${stripTags(t)}\n\n`)
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, (_, t: string) => `\n\n### ${stripTags(t)}\n\n`)
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, (_, t: string) => `\n\n#### ${stripTags(t)}\n\n`)
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, (_, t: string) => `\n\n##### ${stripTags(t)}\n\n`)
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, (_, t: string) => `\n\n###### ${stripTags(t)}\n\n`)
    // Liste item'larını "- " ile
    .replace(/<li[^>]*>(.*?)<\/li>/gi, (_, t: string) => `\n- ${stripTags(t)}`)
    // Paragrafları çift newline ile ayır
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n");
  // Geriye kalan tüm HTML tag'lerini sil
  out = out.replace(/<[^>]+>/g, "");
  // HTML entity'leri decode
  out = out
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ouml;/g, "ö")
    .replace(/&uuml;/g, "ü")
    .replace(/&ccedil;/g, "ç")
    .replace(/&Ccedil;/g, "Ç")
    .replace(/&ouml;/g, "ö")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&scaron;/g, "š")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  // Aşırı boşlukları normalize et
  return out
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

export async function ingestDocxFile(filePath: string): Promise<DocxIngestResult> {
  const mammothMod = (await import("mammoth")) as unknown as {
    default?: { convertToHtml: (input: { buffer: Buffer }) => Promise<{ value: string; messages: Array<{ type: string; message: string }> }> };
    convertToHtml: (input: { buffer: Buffer }) => Promise<{ value: string; messages: Array<{ type: string; message: string }> }>;
  };
  const mammoth = mammothMod.default ?? mammothMod;
  const filename = path.basename(filePath);
  const data = readFileSync(filePath);
  const stat = statSync(filePath);
  const fileHash = sha256File(data);

  const result = await mammoth.convertToHtml({ buffer: data });
  const markdown = htmlToMarkdownish(result.value);
  const warnings = result.messages ?? [];

  const rootHeading = filename.replace(/\.docx?$/i, "");
  const chunks: KbChunkInput[] = chunkText(markdown, {
    rootHeading,
    maxTokens: 800,
    minTokens: 80,
    overlapTokens: 80,
  }).map((c) => ({
    ord: c.ord,
    heading_path: c.heading_path,
    content: c.content,
    token_count: c.token_count,
  }));

  const { changed } = upsertDocument({
    doc_id: makeDocId(filename),
    source_type: "pdf", // DOCX'leri "pdf" tipinde tutuyoruz (UI'da aynı kategori).
    // Eğer ayrı bir "docx" tipi istenirse db.ts SourceType'a eklenmeli.
    source_uri: filePath,
    title: rootHeading,
    metadata: {
      filename,
      mtime: stat.mtime.toISOString(),
      size: stat.size,
      mammoth_warnings: warnings.length,
      file_format: "docx",
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
    warnings: warnings.length,
  };
}

/**
 * Belirtilen dizindeki tüm .docx dosyalarını ingest eder. Klasör yoksa
 * sessizce atlanır (UX: kullanıcı zorunda kalmasın).
 */
export async function ingestAllDocx(
  dir: string = DEFAULT_DOCS_DIR,
): Promise<DocxIngestResult[]> {
  const root = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
  if (!existsSync(root)) {
    console.warn(`[kb/docx] dizin yok: ${root} — atlanıyor`);
    return [];
  }
  const files = readdirSync(root)
    .filter((f) => /\.docx$/i.test(f))
    .map((f) => path.join(root, f));

  const results: DocxIngestResult[] = [];
  for (const file of files) {
    try {
      const r = await ingestDocxFile(file);
      results.push(r);
      console.log(
        `[kb/docx] ${path.basename(file)}: ${r.changed ? "✓ updated" : "= unchanged"} (${r.chunks} chunk, ${r.tokens} token${r.warnings > 0 ? `, ${r.warnings} uyarı` : ""})`,
      );
    } catch (err) {
      console.error(
        `[kb/docx] ${path.basename(file)}: hata — ${(err as Error).message}`,
      );
    }
  }
  return results;
}
