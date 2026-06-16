/*
 * Heading-aware chunker.
 *
 * Strateji:
 *   1. Metni heading hiyerarşisine göre bölümlere ayır (Markdown # ya da
 *      "Bölüm 1.2.3" / "1. Başlık" pattern'i; düz metin için boş satır).
 *   2. Her bölümü hedef token aralığına sığacak şekilde windowla; aşan
 *      bölümleri cümle sınırından böl.
 *   3. Bölümler arası anlam kaybını azaltmak için chunk'lar arasında
 *      `overlapTokens` kadar metin tekrarla (sliding window).
 *
 * Tokenizer: tam BPE değil — kelime + 0.75 katsayı yaklaşımı kullanıyoruz
 * (Türkçe metin için pratikte gemini-embedding-001 token sayımıyla ±%15
 * civarında tutar). Gerekirse tiktoken eklenebilir.
 */

export type Chunk = {
  ord: number;
  heading_path: string | null;
  content: string;
  token_count: number;
};

export type ChunkOpts = {
  maxTokens?: number;
  minTokens?: number;
  overlapTokens?: number;
  rootHeading?: string | null;
};

const DEFAULTS = {
  maxTokens: 800,
  minTokens: 80,
  overlapTokens: 80,
} as const;

/** Hızlı yaklaşık token sayımı (kelime sayısı * 1.3). */
export function approxTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

/** Cümle sınırlarına göre böl (Türkçe nokta/soru/ünlem). */
function splitSentences(text: string): string[] {
  // Tek paragraf, cümleler ile bölünür. Kısaltmaları (örn. "vb.") tam bozmasak
  // da analiz için yeterli granülasyon sağlar.
  const matches = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
  if (!matches) return [text.trim()].filter(Boolean);
  return matches.map((s) => s.trim()).filter(Boolean);
}

/**
 * Metni heading-section'lara ayır. Tanıdığı pattern'ler:
 *  - Markdown başlıkları: `# Başlık`, `## Başlık`, ...
 *  - Bölüm numarası ile: `1. Başlık`, `1.2 Başlık`, `1.2.3 Başlık`
 *  - Tamamen büyük harfli kısa satır (5–80 char) — başlık varsayılır
 *  - Boş satırlar bölüm değil, paragraf ayracı sayılır
 */
type Section = {
  level: number;
  heading: string | null;
  body: string;
};

function detectHeading(line: string): { level: number; text: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Markdown
  const md = trimmed.match(/^(#{1,6})\s+(.+)$/);
  if (md && md[1] && md[2]) return { level: md[1].length, text: md[2].trim() };

  // Numara prefix'i: "1.", "1.2", "1.2.3" gibi
  const numbered = trimmed.match(/^(\d+(?:\.\d+){0,4})\.?\s+([^\s].{1,200})$/);
  if (numbered && numbered[1] && numbered[2]) {
    const depth = numbered[1].split(".").filter(Boolean).length;
    return { level: Math.min(depth + 1, 6), text: numbered[2].trim() };
  }

  // Tamamen büyük harf, kısa satır → büyük olasılıkla başlık
  if (
    /^[\p{Lu}\d\s\-:/()\.,]{5,80}$/u.test(trimmed) &&
    /\p{Lu}/u.test(trimmed) &&
    !/^[\d\s\.\-]+$/.test(trimmed)
  ) {
    return { level: 2, text: trimmed };
  }
  return null;
}

function splitIntoSections(text: string): Section[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: Section[] = [];
  let cur: Section = { level: 0, heading: null, body: "" };

  for (const line of lines) {
    const h = detectHeading(line);
    if (h) {
      if (cur.body.trim() || cur.heading) sections.push(cur);
      cur = { level: h.level, heading: h.text, body: "" };
    } else {
      cur.body += line + "\n";
    }
  }
  if (cur.body.trim() || cur.heading) sections.push(cur);
  return sections.filter((s) => (s.body + (s.heading ?? "")).trim().length > 0);
}

/** Heading path: parent başlıkları zincirle ("A > B > C"). */
function buildHeadingPath(stack: Array<{ level: number; text: string }>): string | null {
  if (stack.length === 0) return null;
  return stack.map((h) => h.text).join(" > ");
}

/**
 * Bir bölümü hedef token aralığına bölme. Cümleleri sırayla biriktirip
 * maxTokens'a yaklaşınca emit eder. Overlap için son N token'ı sonraki
 * window'un başına ekler.
 */
function windowBySentences(
  body: string,
  opts: Required<ChunkOpts> & { rootHeading: string | null },
): string[] {
  const sentences = splitSentences(body);
  if (sentences.length === 0) return [];

  const out: string[] = [];
  let buf: string[] = [];
  let bufTokens = 0;

  function flush(): void {
    if (buf.length === 0) return;
    const text = buf.join(" ").trim();
    if (text) out.push(text);
    buf = [];
    bufTokens = 0;
  }

  for (const s of sentences) {
    const t = approxTokens(s);
    if (bufTokens + t > opts.maxTokens && bufTokens > 0) {
      flush();
      // Overlap: son window'un sonundaki ~overlapTokens kadarını yeni window'a taşı
      if (opts.overlapTokens > 0 && out.length > 0) {
        const lastText = out[out.length - 1] ?? "";
        const lastSentences = splitSentences(lastText);
        const tail: string[] = [];
        let tailTokens = 0;
        for (let i = lastSentences.length - 1; i >= 0; i--) {
          const sent = lastSentences[i];
          if (!sent) continue;
          const ts = approxTokens(sent);
          if (tailTokens + ts > opts.overlapTokens) break;
          tail.unshift(sent);
          tailTokens += ts;
        }
        if (tail.length > 0) {
          buf.push(...tail);
          bufTokens += tailTokens;
        }
      }
    }
    buf.push(s);
    bufTokens += t;
  }
  flush();
  return out;
}

/**
 * Ana entry point. Bir metin (PDF'den çıkarılan tek string ya da bir
 * "panorama_screen" rawText'i) verildiğinde bunu chunk[] olarak böler.
 *
 * `rootHeading` (örn. dosya adı veya ekran adı) tüm chunk'ların heading_path
 * başına eklenir → retrieval cevabında provenance net görünür.
 */
export function chunkText(text: string, opts: ChunkOpts = {}): Chunk[] {
  const o: Required<ChunkOpts> & { rootHeading: string | null } = {
    maxTokens: opts.maxTokens ?? DEFAULTS.maxTokens,
    minTokens: opts.minTokens ?? DEFAULTS.minTokens,
    overlapTokens: opts.overlapTokens ?? DEFAULTS.overlapTokens,
    rootHeading: opts.rootHeading ?? null,
  };

  const normalized = text
    // Çoklu whitespace'i (tab + space) tek boşluğa indir, ama newline'ları koru
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return [];

  const sections = splitIntoSections(normalized);
  const headingStack: Array<{ level: number; text: string }> = [];
  if (o.rootHeading) headingStack.push({ level: 0, text: o.rootHeading });

  const chunks: Chunk[] = [];
  let ord = 0;

  for (const sec of sections) {
    // heading hiyerarşisini güncelle: aynı veya daha yüksek seviyedeki
    // her başlığı stack'ten çıkar, sonra mevcut başlığı it
    while (headingStack.length > 0) {
      const top = headingStack[headingStack.length - 1];
      if (!top) break;
      if (top.level === 0) break; // root'u pop'lama
      if (top.level < sec.level) break;
      headingStack.pop();
    }
    if (sec.heading) headingStack.push({ level: sec.level, text: sec.heading });

    const path = buildHeadingPath(headingStack);
    const body = sec.body.trim();
    if (!body) {
      // sadece başlık varsa, bunu kendi chunk'ı yapmayalım — bağlam zayıf.
      continue;
    }

    const windows = windowBySentences(body, o);
    for (const w of windows) {
      const headerPrefix = path ? `[${path}]\n` : "";
      const content = `${headerPrefix}${w}`.trim();
      const tokenCount = approxTokens(content);
      // çok küçük chunk'ları bir öncekine eklemek mantıklı ama mevcut basit
      // tasarımda her window'u ayrı chunk olarak tutuyoruz; minTokens daha çok
      // gürültü filtresi
      // Kısa chunk'ları öncekine birleştir — AMA SADECE aynı heading_path
      // altındaysa. Aksi takdirde başlık bilgisi kaybolur (test bunu yakaladı).
      if (tokenCount < o.minTokens && chunks.length > 0) {
        const prev = chunks[chunks.length - 1];
        if (prev && prev.heading_path === path) {
          prev.content = `${prev.content}\n\n${content}`;
          prev.token_count = approxTokens(prev.content);
          continue;
        }
      }
      chunks.push({
        ord: ord++,
        heading_path: path,
        content,
        token_count: tokenCount,
      });
    }
  }

  return chunks;
}
