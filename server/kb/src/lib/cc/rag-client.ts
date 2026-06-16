/*
 * enroute-rag mikroservisi client'ı.
 *
 * Root CC ticket sınıflandırması için: müşteri açıklamasını RAG servisine
 * gönder, semantik benzer geçmiş ticket'lardan öğrenilmiş kategorileri al.
 *
 * RAG v3 taxonomy döndürür (15 kategori, 15 fiil-bazlı işlem tipi, +platform
 * +self_servis). Bu modül v3 → v2 (root canlı taxonomy) mapping yapar.
 *
 * Avantaj: artık hard-coded hint kuralları ve Anthropic prompt'una bağlı
 * değiliz. Operatör yanlış kategori gördüğünde düzeltir → RAG bunu öğrenir
 * → bir dahaki sefere doğru cevap.
 */

const RAG_URL = process.env.RAG_URL ?? "http://localhost:4000";
const RAG_TIMEOUT_MS = 30_000;

// ─── v3 → v2 MAPPING TABLOLARI ────────────────────────────────────

/** v3 Kategori → v2 İş Süreci */
const KATEGORI_TO_IS_SURECI: Record<string, string> = {
  "Müşteri / Cari İşlemleri": "Müşteri / Cari Kartı ve Gruplama İşlemleri",
  "Ürün / Stok İşlemleri": "Ürün Kartı ve Grup İşlemleri",
  "Sipariş / Satış İşlemleri": "Satış İşlemleri",
  "Alış İşlemleri": "Alış İşlemleri",
  "İade İşlemleri": "İade İşlemleri",
  "E-Belge İşlemleri": "E-Belge (e-fatura / e-arşiv)",
  "Belge Basım / Dizayn": "Belge Basım İşlemleri",
  "Tahsilat / Ödeme": "Finans Tahsilat İşlemleri",
  "Kullanıcı / Yetki Yönetimi": "Kullanıcı / Yetki / Giriş",
  "Satış Ekibi / Rut / Ziyaret": "Satış Ekibi / Rut ve Ziyaret işlemleri",
  "Raporlama / Dashboard": "Sabit Rapor ve Dashboard İşlemleri",
  "Aktarım / SmartConnect": "Smart Connect İşlemleri",
  "İskonto / Promosyon / Fiyat": "İskonto ve Promosyon",
  "Sevkiyat / Stok / Depo": "Sevkiyat / Dağıtım Araç Yükleme İşlemleri",
  "Sözleşme / Hedef / Prim": "Hedef ve Prim Yönetimi İşlemleri",
};

/** v3 İşlem Tipi (fiil) → v2 İşlem Tipi (problem dili) */
const ISLEM_TIPI_V3_TO_V2: Record<string, string> = {
  "Oluşturma / Kayıt": "Oluşturamıyorum",
  "Görüntüleme / Sorgu": "Bilgi Alamıyorum",
  "Güncelleme / Düzeltme": "Güncelleyemiyorum",
  "İptal Etme / Silme": "Düzeltemiyorum",
  "Onaylama": "Onaylayamıyorum",
  "E-Belge Gönderme": "E-Belge gönderemiyorum",
  "Aktarma (Ticari Pakete)": "Aktaramıyorum (muhasebeye / ticari pakete)",
  "Yazdırma / Basım": "Yazdıramıyorum",
  "Bilgi Gönderme (Mobil Senkron)": "Bilgi gönderemiyorum",
  "Bilgi Alma (Mobil Senkron)": "Senkron olmuyor (veri gelmiyor)",
  "Giriş / Bağlanma": "Giremiyorum",
  "Rapor Alma": "Rapor alamıyorum",
  "Hesaplama / Tutar Kontrolü": "Hesaplama yanlış",
  "Bilgilendirme Talebi": "Bilgi alabilir miyim",
  "Hata Aldım": "Hata mesajı alıyorum",
};

/** v3 Platform → v2 Platform (v2 sadece Backoffice/Mobil; v3'ün diğer 2'si Backoffice'e fallback) */
const PLATFORM_V3_TO_V2: Record<string, string> = {
  "Backoffice": "Backoffice",
  "Mobil": "Mobil",
  "El Terminali": "Mobil", // mobil ile en yakın
  "Unidox / 3.Parti Portal": "Backoffice", // backoffice üzerinden açılan portal
};

/** v3 Etki → v2 Etki (aynı isimler) */
const ETKI_V3_TO_V2: Record<string, string> = {
  "İş tamamen durdu": "İş tamamen durdu",
  "Tüm kullanıcılar / distribütör etkileniyor": "Tüm kullanıcılar / distribütör etkileniyor",
  "Tek kullanıcı etkileniyor": "Tek kullanıcı etkileniyor",
};

/**
 * v3 etkilenen_nesne → v2 etkilenen_nesne — CONTEXT-AWARE.
 *
 * v2'de 218 değer var (çok detaylı, ekran/işlem adları). v3 sadece 30 yüksek
 * seviye nesne döndürür. Doğru eşleştirme için işlem_tipi'ne BAKMAK ŞART.
 *
 * Örnek: v3 "E-Fatura" tek başına anlamsız, çünkü v2'de "E-Fatura" yok.
 * Ama bağlamına göre:
 *   - İşlem "E-Belge Gönderme" → "E-Belge Gönderim"
 *   - İşlem "Yazdırma / Basım" → "E-Belge Dizaynı"
 *   - İşlem "Görüntüleme" → "E-Belge Gönderim" (default — listeleme buradan yapılır)
 */
function mapEtkilenenNesneContext(v3Nesne: string, v3IslemTipi: string): string | null {
  // E-Belge ailesi — bağlama göre rafine et
  if (v3Nesne === "E-Fatura" || v3Nesne === "E-Arşiv") {
    if (v3IslemTipi === "E-Belge Gönderme") return "E-Belge Gönderim";
    if (v3IslemTipi === "Yazdırma / Basım") return "E-Belge Dizaynı";
    if (v3IslemTipi === "Görüntüleme / Sorgu") return "E-Belge Gönderim";
    if (v3IslemTipi === "Güncelleme / Düzeltme") return "E-Belge Ayarları";
    return "E-Belge Gönderim"; // default
  }

  // Diğer nesneler — düz mapping
  const directMap: Record<string, string> = {
    "Müşteri / Cari Kartı": "Müşteri Kartı",
    "Ürün / Stok Kartı": "Ürün Kartı",
    "Fiyat Listesi": "Fiyat Listesi",
    "Sipariş": "Sipariş",
    "Satış Faturası": "Satış Faturası",
    "Alış Faturası": "Alış Faturası",
    "İade Faturası": "İade Faturası",
    "İrsaliye": "İrsaliye",
    "Matbu / Seri No": "Matbu No",
    "Belge Dizaynı": "Belge Dizaynı",
    "Tahsilat": "Tahsilat",
    "Kredi Kartı / POS": "Kredi Kartı",
    "Banka / EFT / Havale": "Banka",
    "Çek / Senet": "Çek",
    "Kullanıcı / Şifre": "Kullanıcı",
    "Yetki / Rol": "Yetki",
    "Lisans": "Lisans",
    "Satış Temsilcisi": "Satış Temsilcisi",
    "Rut / Ziyaret": "Rut",
    "Rapor": "Rapor",
    "Dashboard": "Dashboard",
    "SmartConnect / Aktarım": "Smart Connect",
    "İskonto / Promosyon": "İskonto",
    "Depo / Stok Yeri": "Depo",
    "Sevkiyat": "Sevkiyat",
    "Sözleşme / Hedef": "Sözleşme",
    "Cihaz / Mobil": "Mobil Cihaz",
    "Diğer": "Diğer",
  };
  return directMap[v3Nesne] ?? null;
}

/** Ürün — v3'te henüz alan yok, metinden tahmin et veya default EnRoute */
function guessUrun(text: string): "EnRoute" | "Quest" | "Stokbar" | "Calldesk" {
  const lower = text.toLowerCase();
  if (lower.includes("quest")) return "Quest";
  if (lower.includes("stokbar")) return "Stokbar";
  if (lower.includes("calldesk")) return "Calldesk";
  return "EnRoute"; // default — en yaygın
}

// ─── RAG response tipleri ─────────────────────────────────────────

export type RagResponse = {
  labels: {
    kategori: string;
    etkilenen_nesne: string;
    platform: string;
    islem_tipi: string;
    etki: string;
    kok_neden_grup: string;
    kok_neden_detay: string;
    cozum_tipi: string;
    self_servis: string;
  };
  confidence: number;
  reasoning: string;
  similarExamples: Array<{
    bildirimNo: number;
    similarity: number;
    musteriSorunu: string;
    labels: { kategori: string | null; islem_tipi: string | null; kok_neden_grup: string | null };
  }>;
  meta: { model: string; similarSearchMs: number; aiMs: number; k: number };
};

// ─── v2 mapped output ─────────────────────────────────────────────

export type V2MappedResult = {
  urun: string | null;
  platform: string | null;
  is_sureci: string | null;
  islem_tipi: string | null;
  etkilenen_nesne: string | null;
  etki: string | null;
  confidence: number;
  reasoning: string;
  similar_examples: Array<{ bildirim_no: number; similarity: number; musteri_sorunu: string }>;
};

// ─── RAG çağrısı ──────────────────────────────────────────────────

export async function callRag(text: string): Promise<RagResponse> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), RAG_TIMEOUT_MS);

  try {
    const res = await fetch(`${RAG_URL}/api/categorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, k: 10 }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`RAG ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as RagResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/** v3 RAG cevabını v2 vocab'a map et (root CC için). */
export function mapV3ToV2(rag: RagResponse, sourceText: string): V2MappedResult {
  const v3 = rag.labels;
  return {
    urun: guessUrun(sourceText),
    platform: PLATFORM_V3_TO_V2[v3.platform] ?? null,
    is_sureci: KATEGORI_TO_IS_SURECI[v3.kategori] ?? null,
    islem_tipi: ISLEM_TIPI_V3_TO_V2[v3.islem_tipi] ?? null,
    etkilenen_nesne: mapEtkilenenNesneContext(v3.etkilenen_nesne, v3.islem_tipi),
    etki: ETKI_V3_TO_V2[v3.etki] ?? "Tek kullanıcı etkileniyor",
    confidence: rag.confidence,
    reasoning: rag.reasoning,
    similar_examples: rag.similarExamples.slice(0, 3).map((s) => ({
      bildirim_no: s.bildirimNo,
      similarity: s.similarity,
      musteri_sorunu: s.musteriSorunu,
    })),
  };
}
