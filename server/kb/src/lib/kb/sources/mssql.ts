/*
 * MSSQL ticket-resolution connector.
 *
 * Strateji: MSSQL view'a doğrudan gitmek YERINE, mevcut lokal sqlite
 * snapshot'tan (`tickets` tablosu — sync-and-embed.ts üretiyor) okur.
 * Bu sayede:
 *   - MSSQL view ağırlığını yeniden ödemeyiz
 *   - sync-and-embed cron'u zaten taze tutuyor
 *   - PII redaction ve text_hash mekanizması mevcut akışta uygulanmış
 *
 * Çözümlenmiş ticket = `cozum` alanı dolu olan kayıtlar. Her biri bir
 * KB doc olur: `ticket:<bildirim_no>`. content_hash text_hash'ten gelir
 * → ticket değişmedikçe yeniden chunk/embed üretilmez.
 *
 * Not: bu connector ticket'ın TÜM cevabını (açıklama + çözüm) tek
 * dökümana koyar; chunker bölmeye gerek görürse böler. Mevcut ticket
 * similarity (cosine kNN) farklı bir kullanım (geçmiş ticket'lar
 * arasında en yakın) — buradaki KB ise "bilgi araması" için.
 */

import { getDb } from "../../ticket/local-store";
import { chunkText } from "../chunker";
import { redact } from "../../ticket/redactor";
import { hashContent, upsertDocument, type KbChunkInput } from "../db";

export type TicketIngestResult = {
  bildirimNo: number;
  doc_id: string;
  changed: boolean;
  chunks: number;
};

export type IngestOpts = {
  limit?: number;
  /** Sadece kapanmış / çözülmüş kayıtlar (cozum dolu) — default true. */
  resolvedOnly?: boolean;
  /** Proje filtresi (opsiyonel). */
  project?: string | null;
};

type LocalTicketRow = {
  bildirim_no: number;
  bildirim_tarihi: string | null;
  bildirim_tipi: string | null;
  oncelik: string | null;
  katman: string | null;
  proje: string | null;
  urun: string | null;
  kategori_uzun: string | null;
  kok_neden: string | null;
  aciklama: string | null;
  cozum: string | null;
  bug_group: string | null;
  tfs_no: number | null;
  tfs_tip: string | null;
  text_hash: string;
};

function buildTicketDocText(t: LocalTicketRow): string {
  const meta: string[] = [];
  if (t.proje) meta.push(`Proje: ${t.proje}`);
  if (t.urun) meta.push(`Ürün: ${t.urun}`);
  if (t.kategori_uzun) meta.push(`Kategori: ${t.kategori_uzun}`);
  if (t.kok_neden) meta.push(`Kök Neden: ${t.kok_neden}`);
  if (t.bug_group) meta.push(`Bug Group: ${t.bug_group}`);
  if (t.tfs_tip) meta.push(`TFS Tip: ${t.tfs_tip}`);

  const parts: string[] = [];
  parts.push(`# Bildirim #${t.bildirim_no}`);
  if (meta.length > 0) parts.push(meta.join(" · "));

  // PII'yı LLM'e gitmeden önce maskele.
  const aciklama = t.aciklama ? redact(t.aciklama).text : null;
  const cozum = t.cozum ? redact(t.cozum).text : null;

  if (aciklama) parts.push(`## Açıklama\n\n${aciklama}`);
  if (cozum) parts.push(`## Uygulanmış Çözüm\n\n${cozum}`);

  return parts.join("\n\n");
}

export function ingestTicketResolutions(
  opts: IngestOpts = {},
): TicketIngestResult[] {
  const db = getDb();
  const resolvedOnly = opts.resolvedOnly ?? true;
  const limit = opts.limit ?? 5000;

  const where: string[] = [];
  const params: Record<string, unknown> = { limit };
  if (resolvedOnly) where.push(`cozum IS NOT NULL AND length(trim(cozum)) > 10`);
  if (opts.project) {
    where.push(`proje = @project`);
    params.project = opts.project;
  }
  const sql = `
    SELECT bildirim_no, bildirim_tarihi, bildirim_tipi, oncelik, katman, proje,
           urun, kategori_uzun, kok_neden, aciklama, cozum, bug_group,
           tfs_no, tfs_tip, text_hash
    FROM tickets
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY bildirim_tarihi DESC, bildirim_no DESC
    LIMIT @limit
  `;
  const rows = db.prepare(sql).all(params) as LocalTicketRow[];

  const out: TicketIngestResult[] = [];
  let changedCount = 0;

  for (const r of rows) {
    const text = buildTicketDocText(r);
    if (!text.trim()) continue;

    const chunks: KbChunkInput[] = chunkText(text, {
      rootHeading: `Bildirim #${r.bildirim_no}`,
      maxTokens: 1000,
      minTokens: 60,
      overlapTokens: 60,
    }).map((c) => ({
      ord: c.ord,
      heading_path: c.heading_path,
      content: c.content,
      token_count: c.token_count,
    }));
    if (chunks.length === 0) continue;

    const doc_id = `ticket:${r.bildirim_no}`;
    const { changed } = upsertDocument({
      doc_id,
      source_type: "ticket_resolution",
      source_uri: `bildirim_no:${r.bildirim_no}`,
      title: `${r.kategori_uzun ?? "Bildirim"} #${r.bildirim_no}`,
      metadata: {
        bildirim_no: r.bildirim_no,
        proje: r.proje,
        kategori: r.kategori_uzun,
        kok_neden: r.kok_neden,
        bildirim_tarihi: r.bildirim_tarihi,
        bug_group: r.bug_group,
        tfs_no: r.tfs_no,
        tfs_tip: r.tfs_tip,
      },
      content_hash: r.text_hash || hashContent(text),
      chunks,
    });
    if (changed) changedCount++;
    out.push({
      bildirimNo: r.bildirim_no,
      doc_id,
      changed,
      chunks: chunks.length,
    });
  }

  console.log(
    `[kb/mssql] ${out.length} ticket (${changedCount} güncellendi, ${out.length - changedCount} değişmemiş)`,
  );
  return out;
}
