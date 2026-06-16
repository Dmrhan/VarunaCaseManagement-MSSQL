import type { TicketRow } from "./types";
import type { Taxonomy } from "./taxonomy";
import type { LocalTicket } from "./local-store";
import type { PanoramaScreen } from "./panorama-docs";

/*
 * Sistem talimatı + kullanıcı prompt'unu inşa eder. Tek Gemini çağrısında
 * JSON şemalı çıktı bekleniyor (responseMimeType: application/json).
 *
 * İki mod var:
 *   - matched=null  → freeText modu, etiketler de tahmin edilir (`inferred` set)
 *   - matched=row   → bildirimNo modu, etiketler gerçektir, sadece analiz
 */

export const SYSTEM_INSTRUCTION = `
Sen EnRoute ERP/CRM ürününün destek hattında çalışan kıdemli bir destek
analistisin. Görevin: gelen bir bildirim (ticket) için kök neden hipotezleri
çıkarmak, adım adım çözüm yolu önermek, müşteriye gönderilebilecek nazik bir
yanıt taslağı yazmak ve gerekirse yazılım ekibine aktarılacak teknik özeti
üretmektir.

Kurallar:
- Türkçe yaz; OPERASYONEL ol — adımlarda alan/buton/parametre adlarını AÇIK
  şekilde belirt. Generic "ilgili sekme" gibi muğlak ifade KULLANMA.
- Verilen benzer geçmiş kayıtlardaki uygulanmış çözümleri (COZUM) güçlü
  ipucu olarak kullan; aynı kategori + kök neden eşleşmesi varsa onu adım
  olarak öner.
- **PANORAMA KULLANIM KILAVUZU** sağlandıysa, "suggestedSteps" alanını
  oluştururken kılavuzdaki "Menü Adımı" yollarını ve alan/buton adlarını
  ADRES OLARAK kullan. Müşteri yanıt taslağına da net "X → Y → Z" menü
  yolu eklenmesini tercih et.

  ⛔ MENÜ YOLU KURALLARI — KESİN:
  1) Bir ekran adından bahsedeceksen, o ekranın menü yolunu KILAVUZ
     listesinde verilen "Menü :" satırından AYNEN KOPYALA — bir tek
     karakter değiştirme.
  2) İki farklı ekranın menü hiyerarşilerini ASLA KARIŞTIRMA. "X → Y → Z"
     menü yolunu o yolun ait olduğu ekran dışında başka bir ekrana
     YAKIŞTIRMA. Örnek hata: ekran A'nın menüsü "Modül1 → Alt1 → A" iken,
     ekran B için "Modül1 → Alt1 → B" diye UYDURMA. Her ekranın kendi
     hiyerarşisi vardır; satırdan oku, asla TÜRETME.
  3) Kılavuzda hiç bahsi geçmeyen bir ekrana yönlendireceksen, menü yolu
     YAZMA — sadece ekran adıyla geç ve [tahmin] etiketi koy.
  4) Şüpheli isen menü yolunu söyleme; "ilgili ekran" diye geç + rationale
     içinde "menü yolu kılavuzda bulunamadı" notu düş.

  ⭐ İLK ADIM (suggestedSteps[0]):
     - Kılavuzdaki [1] numaralı ekran lexical+kategori skoru ile bu ticket
       için ASIL HEDEF olarak hesaplandı.
     - Eğer ilk adım bir ekrana yönlendiriyorsa, o ekran KILAVUZ [1]
       OLMALI ve menü yolu [1]'in "Menü :" satırından AYNEN kopyalanmalı.
     - [1]'i atlayıp [2]/[3]/[4]'e gitmek YASAK — bunlar ikincil/alternatif
       yardımcılardır. Sadece [1] sorunun KESİNLİKLE bu ekranla ilgili
       olmadığına dair somut kanıt varsa kullanılır.
- **BİLGİ BANKASI (KB) ALINTILARI** sağlandıysa, çözüm önerilerinde bu
  alıntılara dayan ve hangi kaynaktan geldiğini metin içinde belirt
  (örn. "(KB#3'e göre)"). KB dışından teknik detay UYDURMA. KB ile
  benzer geçmiş kayıtlar çelişiyorsa KB'ye güven.

SORUYU ANLAMA — ÇİFT YÖN:
- "X'i Y'ye BAĞLA / ATA / EŞLEŞTİR" türü sorularda **iki olası yön** vardır:
  (a) X'in ekranından Y referansı verilir (örn. Rut Tanım ekranında "Takip Kodu" alanı)
  (b) Y'nin ekranından X eklenir (örn. Satış Temsilcisi kartında "Rut Bilgileri" tab)
- Kullanıcı dilinde sıklıkla **Y'nin perspektifi** beklenir ("rut'u temsilciye bağla"
  → temsilcinin kartından yönetilen yöntem daha doğal).
- KB chunk'larında her iki yönü de tara; öncelikle Y'nin (hedefin) ekranındaki
  yöntemi tarif et. Diğer yön VARSA "Alternatif yöntem" olarak ekle.
- Aynı sorun için sadece bir yön gösterip "diğeri yoktur" şeklinde tıkanma —
  KB'de yoksa belirt.

ADIM AYRINTILILIĞI (suggestedSteps için kritik):
- Bir ekrana / sekmeye yönlendiriyorsan, o ekrandaki **doldurulacak ANAHTAR
  ALANLARI** ayrı bir adım olarak yaz. Örnek: "Rut Bilgileri" sekmesini açan
  bir adımdan sonra mutlaka şunu da ekle: "Rut Kodu, Başlangıç Tarihi, Bitiş
  Tarihi, Frekans, Frekans Birimi alanlarını doldur".
- "X butonuna tıklayın" adımından sonra, o butonun açtığı ekranın
  içeriğini/alanlarını ayrı adım yap (varsa kaynakta).
- **Koşullu davranışları** (parametre etkili olduğunda iş akışı değişikliği,
  yetki gereksinimi vb.) ayrı bir adım veya rationale olarak ekle. Örn:
  "Merkez Onaylı Rut İşlemleri Kullanılsın Mı? parametresi aktifse atama
  yöneticinin onayına düşer".
- Granülarite hedefi: bir teknik destek operatörü adımları takip ederek
  hiçbir tahmin yapmadan işi tamamlayabilmeli.
- Gerektiğinde 10+ adım üret; yapay olarak kısaltma.

DİĞER:
- Yanıtı KESİNLİKLE geçerli bir JSON olarak ver. Açıklama, kod bloğu, baş/sona
  metin EKLEME. Sadece JSON.
- Belirsizlik varsa confidence değerini düşür; uydurma yapma.
- Müşteri yanıtı taslağında özür/empati cümlesi olabilir; kibirli olma.
- Mühendislik özeti teknik dili kullanmalı; modül adı, sahnenin nerede
  tetiklendiği, beklenen-gözlemlenen davranış, varsa muhtemel kök neden.
- "suggestedBugGroup" ve "suggestedTfsTip" alanları için sadece verilen
  taksonomi içinden seç; uygun bir aday yoksa null bırak.
`.trim();

export type KbContextChunk = {
  number: number;
  source_type: "pdf" | "panorama_screen" | "ticket_resolution" | "operator_resolution";
  title: string | null;
  heading_path: string | null;
  excerpt: string;
};

export type PromptInputs = {
  freeText: string | null; // null ise matched modunda
  matched: TicketRow | LocalTicket | null;
  similar: Array<{
    bildirim_no: number;
    score: number;
    proje: string | null;
    kategori_uzun: string | null;
    kok_neden: string | null;
    aciklama: string | null;
    cozum: string | null;
    tfs_tip: string | null;
    bug_group: string | null;
  }>;
  taxonomy: Taxonomy;
  panoramaScreens?: PanoramaScreen[];
  /**
   * KB retrieval — iki kaynak grubu ayrı tutulur ki analyst hangi
   * tarafa ne kadar dayandığı görünür olsun.
   *  - kbChunksN4b: yalnız operatör çözüm notları (TBL_N4B_COZUM_ACIKLAMALAR)
   *  - kbChunksOther: panorama_screen + ticket_resolution + pdf
   */
  kbChunksN4b?: KbContextChunk[];
  kbChunksOther?: KbContextChunk[];
};

const RESPONSE_SCHEMA = `
Beklenen JSON şeması (alanları aynen kullan):

{
  "inferred": {                         // Sadece freeText modunda zorunlu;
    "bildirim_tipi": string,            // matched modunda null geç.
    "oncelik": "Normal" | "Yüksek" | "Kritik",
    "katman": string,
    "kok_neden": string,
    "confidence": number                // 0..1
  } | null,
  "rootCauseHypotheses": [              // 1-4 madde, en olası önce
    { "text": string, "confidence": number }
  ],
  "suggestedSteps": [                   // 3-10 adım — operasyonel detayı koru,
                                        // alan/buton/koşulları ayrı adım yap
    { "step": string, "rationale": string | null }
  ],
  "customerReplyDraft": string,         // Türkçe, en fazla 6 cümle
  "engineeringHandoff": string,         // Türkçe, kısa teknik özet (4-8 cümle)
  "suggestedBugGroup": string | null,
  "suggestedTfsTip": string | null,

  // ─── KAYNAK-AYRIMLI REHBERLİK ──────────────────────────────────────
  // Bu iki alan, hangi KB kaynağının analizine ne kattığını gösterir.
  // KURAL: yalnızca verilen alıntılara dayan; başka kaynak/uydurmaca yok.
  // İlgili bölümde alıntı yoksa veya soruyla bağlantı kuramıyorsan null bırak;
  //   - null demek "bu kaynakta ilgili bilgi yok" anlamına gelir.
  //   - Boş string ya da "bilgi yok" diye yazma; sadece null kullan.
  //
  // n4bGuidance: yalnızca [N4B#] alıntılarına dayanan, 2-6 cümlelik bir
  //   rehberlik özeti. Doğrudan operatör notuna referans verin
  //   ("Çözüm Notu #24'te belirtildiği gibi…" gibi). Notta cevap yoksa null.
  //
  // otherDocsGuidance: yalnızca [DOC#] alıntılarına dayanan, 2-6 cümlelik
  //   bir rehberlik özeti. Kaynak türünü cümle içinde belirt
  //   ("Panorama 7.3 farklar dokümanına göre…", "Bildirim #3247xxxx
  //   çözümünde…"). İlgili bilgi yoksa null.
  "n4bGuidance": string | null,
  "otherDocsGuidance": string | null
}
`.trim();

function formatTicket(t: TicketRow | LocalTicket | null): string {
  if (!t) return "(yok)";
  // TicketRow ve LocalTicket alan adları farklı; ikisini de destekle.
  const get = <A, B>(rowKey: keyof TicketRow, localKey: keyof LocalTicket): string => {
    const anyT = t as Partial<TicketRow> & Partial<LocalTicket>;
    const v = (anyT[rowKey] as A) ?? (anyT[localKey] as B);
    return v == null ? "-" : String(v);
  };
  return [
    `Bildirim_No   : ${get("Bildirim_No", "bildirim_no")}`,
    `Tarih         : ${get("Bildirim_Tarihi_", "bildirim_tarihi")}`,
    `Tipi          : ${get("Bildirim_Tipi", "bildirim_tipi")}`,
    `Oncelik       : ${get("Oncelik", "oncelik")}`,
    `Acil          : ${get("Acil_Ticket", "acil_ticket")}`,
    `Katman        : ${get("Katman", "katman")}`,
    `Urun          : ${get("Urun", "urun")}`,
    `Proje         : ${get("PROJE", "proje")}`,
    `Kategori      : ${get("Uzun_Kategori_Adi", "kategori_uzun")}`,
    `Kok Neden     : ${get("Konunun_Kok_Nedeni", "kok_neden")}`,
    `BugGroup      : ${get("BugGroup", "bug_group")}`,
    `TfsTip        : ${get("TfsTip", "tfs_tip")}`,
    ``,
    `--- Aciklama ---`,
    get("Bildirim_Aciklamasi", "aciklama"),
    ``,
    `--- Cozum (geçmiş kayıt) ---`,
    get("Cozum_Aciklamasi", "cozum"),
  ].join("\n");
}

function formatSimilar(items: PromptInputs["similar"]): string {
  if (items.length === 0) return "(benzer kayıt bulunamadı)";
  return items
    .map((s, i) => {
      const lines = [
        `[${i + 1}] #${s.bildirim_no}  skor=${s.score.toFixed(3)}  proje=${s.proje ?? "-"}`,
        `    kategori : ${s.kategori_uzun ?? "-"}`,
        `    kok_neden: ${s.kok_neden ?? "-"}`,
        `    bug_grup : ${s.bug_group ?? "-"}   tfs_tip: ${s.tfs_tip ?? "-"}`,
        `    aciklama : ${truncate(s.aciklama, 400)}`,
        `    cozum    : ${truncate(s.cozum, 400)}`,
      ];
      return lines.join("\n");
    })
    .join("\n\n");
}

function truncate(s: string | null, n: number): string {
  if (!s) return "-";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatKbChunks(
  chunks: KbContextChunk[] | undefined,
  prefix: "N4B" | "DOC",
): string {
  if (!chunks || chunks.length === 0) {
    return prefix === "N4B"
      ? "(N4B operatör çözüm notlarında ilgili kayıt bulunamadı)"
      : "(diğer dökümanlarda ilgili kayıt bulunamadı)";
  }
  return chunks
    .map((c) => {
      const head = `[${prefix}#${c.number}] ${c.title ?? c.heading_path ?? "(başlıksız)"} · ${c.source_type}`;
      return `${head}\n${truncate(c.excerpt, 600)}`;
    })
    .join("\n\n");
}

function formatPanoramaScreens(screens: PanoramaScreen[] | undefined): string {
  if (!screens || screens.length === 0) return "(kılavuz önerisi yok)";
  return screens
    .map((s, i) => {
      const fields = s.fields
        .slice(0, 6)
        .map((f) => f.name)
        .filter(Boolean)
        .join(", ");
      const buttons = s.buttons
        .slice(0, 6)
        .map((b) => b.name)
        .filter(Boolean)
        .join(", ");
      const lines = [
        `[${i + 1}] ${s.title}`,
        `    Menü     : ${s.menuStep ?? "—"}`,
      ];
      if (s.summary) lines.push(`    Açıklama : ${truncate(s.summary, 200)}`);
      if (fields) lines.push(`    Alanlar  : ${fields}`);
      if (buttons) lines.push(`    Butonlar : ${buttons}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatTaxonomy(tx: Taxonomy): string {
  const limit = 50;
  return [
    `Bildirim_Tipi adayları   : ${tx.tipler.slice(0, 8).join(" | ") || "-"}`,
    `Oncelik adayları         : ${tx.oncelikler.slice(0, 5).join(" | ") || "-"}`,
    `Katman adayları          : ${tx.katmanlar.slice(0, 8).join(" | ") || "-"}`,
    `Kok_Neden adayları       : ${tx.kokNedenler.slice(0, limit).join(" | ") || "-"}`,
    `BugGroup adayları        : ${tx.bugGroups.slice(0, limit).join(" | ") || "-"}`,
    `TfsTip adayları          : ${tx.tfsTipler.slice(0, 8).join(" | ") || "-"}`,
  ].join("\n");
}

export function buildUserPrompt(inputs: PromptInputs): string {
  const mode = inputs.matched ? "BILDIRIM_NO" : "SERBEST_METIN";
  const sections = [
    `MOD: ${mode}`,
    ``,
    `=== Taksonomi (sadece bu listelerden değer seç) ===`,
    formatTaxonomy(inputs.taxonomy),
    ``,
    `=== Mevcut Bildirim Kaydı ===`,
    formatTicket(inputs.matched),
  ];
  if (inputs.freeText) {
    sections.push(``, `=== Kullanıcının Yazdığı Sorun ===`, inputs.freeText);
  }
  sections.push(
    ``,
    `=== Benzer Geçmiş Kayıtlar (en yakın -> en uzak) ===`,
    formatSimilar(inputs.similar),
    ``,
    `=== Panorama Kullanım Kılavuzu — İlgili Ekranlar ===`,
    formatPanoramaScreens(inputs.panoramaScreens),
    ``,
    `=== Bilgi Bankası — N4B Operatör Çözüm Notları ===`,
    `(yalnız bu bloğa dayanarak n4bGuidance üret; aksi halde null bırak)`,
    formatKbChunks(inputs.kbChunksN4b, "N4B"),
    ``,
    `=== Bilgi Bankası — Diğer Dökümanlar (Kılavuz / Ticket Geçmişi / PDF) ===`,
    `(yalnız bu bloğa dayanarak otherDocsGuidance üret; aksi halde null bırak)`,
    formatKbChunks(inputs.kbChunksOther, "DOC"),
    ``,
    `=== Görev ===`,
    `Yukarıdaki bilgiyle yalnızca aşağıdaki JSON şemasına uygun bir yanıt üret.`,
    `Markdown, kod bloğu, açıklama metni EKLEME. Sadece geçerli JSON döndür.`,
    ``,
    RESPONSE_SCHEMA,
  );
  return sections.join("\n");
}
