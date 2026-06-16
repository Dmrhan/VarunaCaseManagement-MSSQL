/*
 * N4B operatör çözüm notları connector'ı.
 *
 * Kaynak: TBL_N4B_COZUM_ACIKLAMALAR — operatörlerin elle yazdığı detaylı
 * "şu sorunu şöyle çözdük" notları. Lokal sqlite > `cozum_notlari` tablosu
 * sync-n4b-cozumler.mjs ile beslenir (anonimleştirilmiş halde).
 *
 * Her satır → bir KB document. Ham ticket çözümlerine kıyasla daha kürate
 * olduğu için chunk politikası daha cömert (daha az parçaya bölme).
 */

import { getDb } from "../../ticket/local-store";
import { chunkText } from "../chunker";
import { hashContent, upsertDocument, type KbChunkInput } from "../db";

export type N4bIngestResult = {
  lngKod: number;
  bildirimNo: number | null;
  doc_id: string;
  changed: boolean;
  chunks: number;
};

type CozumRow = {
  lng_kod: number;
  bildirim_no: number | null;
  kullanici: string | null;
  gdt: string | null;
  lng_kok_neden: number | null;
  cozum_text: string;
  musteri_sorunu: string | null;
  tespit_sorun: string | null;
  txt_kok_neden: string | null;
  text_hash: string;
};

function buildDocText(r: CozumRow): string {
  const parts: string[] = [];
  parts.push(`# Operatör Çözüm Notu`);

  const meta: string[] = [];
  if (r.bildirim_no) meta.push(`Bildirim: #${r.bildirim_no}`);
  if (r.kullanici) meta.push(`Operatör: ${r.kullanici}`);
  if (r.gdt) meta.push(`Tarih: ${r.gdt.slice(0, 10)}`);
  if (r.txt_kok_neden) meta.push(`Kök Neden: ${r.txt_kok_neden}`);
  if (meta.length) parts.push(meta.join(" · "));

  if (r.musteri_sorunu) parts.push(`## Müşteri Sorunu\n\n${r.musteri_sorunu}`);
  if (r.tespit_sorun) parts.push(`## Tespit Edilen Sorun\n\n${r.tespit_sorun}`);
  parts.push(`## Çözüm Açıklaması\n\n${r.cozum_text}`);

  return parts.join("\n\n");
}

export function ingestN4bCozumler(opts: { limit?: number } = {}): N4bIngestResult[] {
  const db = getDb();

  // Tablo henüz yoksa erken çık — sync-n4b-cozumler.mjs çalıştırılmamış demektir.
  const exists = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='cozum_notlari'`,
    )
    .get();
  if (!exists) {
    throw new Error(
      "cozum_notlari tablosu yok. Önce: node scripts/sync-n4b-cozumler.mjs",
    );
  }

  const limit = opts.limit ?? 1000;
  const rows = db
    .prepare(
      `SELECT lng_kod, bildirim_no, kullanici, gdt, lng_kok_neden,
              cozum_text, musteri_sorunu, tespit_sorun, txt_kok_neden, text_hash
       FROM cozum_notlari
       WHERE cozum_text IS NOT NULL AND length(trim(cozum_text)) > 30
       ORDER BY gdt DESC
       LIMIT ?`,
    )
    .all(limit) as CozumRow[];

  const out: N4bIngestResult[] = [];
  for (const r of rows) {
    const text = buildDocText(r);
    if (!text.trim()) continue;

    const chunks: KbChunkInput[] = chunkText(text, {
      rootHeading: `Çözüm Notu #${r.lng_kod}`,
      // Operatör notları zaten kürate; daha büyük chunk'lar bağlamı korur.
      maxTokens: 1400,
      minTokens: 80,
      overlapTokens: 80,
    }).map((c) => ({
      ord: c.ord,
      heading_path: c.heading_path,
      content: c.content,
      token_count: c.token_count,
    }));
    if (chunks.length === 0) continue;

    const doc_id = `n4b_cozum:${r.lng_kod}`;
    const { changed } = upsertDocument({
      doc_id,
      source_type: "operator_resolution",
      source_uri: r.bildirim_no ? `bildirim_no:${r.bildirim_no}` : `lng_kod:${r.lng_kod}`,
      title: r.bildirim_no
        ? `Bildirim #${r.bildirim_no} Operatör Çözümü`
        : `Operatör Çözüm Notu #${r.lng_kod}`,
      metadata: {
        lng_kod: r.lng_kod,
        bildirim_no: r.bildirim_no,
        kullanici: r.kullanici,
        gdt: r.gdt,
        lng_kok_neden: r.lng_kok_neden,
      },
      content_hash: r.text_hash || hashContent(text),
      chunks,
    });

    out.push({
      lngKod: r.lng_kod,
      bildirimNo: r.bildirim_no,
      doc_id,
      changed,
      chunks: chunks.length,
    });
  }

  return out;
}
