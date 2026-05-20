/**
 * WR-KB2 — External Knowledge Base frontend adapter (MOCK ONLY).
 *
 * Bu modül ileride external KB / Vector DB API'sini çağıracak. Şu an SADECE
 * mock yanıt döndürür; gerçek network çağrısı YOKTUR. API kontratı netleşince
 * bu modül gerçek fetch ile değiştirilecek; UI tarafı imzayı korur.
 *
 * Tasarım kuralları (config & privacy):
 *  - Bu modül `AIUsageLog` yazmaz, `caseService.update`'i çağırmaz, hiçbir
 *    case mutation tetiklemez.
 *  - Mock yanıt local state'tir; backend round-trip yok.
 *  - WR-KB1 admin ekranı (ExternalKbSetting) bağlantı configuration'ını
 *    saklar; bu adapter ileride o ayarları okuyacak.
 *
 * TODO: Replace mock with POST /api/kb/external-ask when external API
 * contract is ready. Real implementation will:
 *  - Read `ExternalKbSetting.enabled` per company; reject if false.
 *  - Forward `query`, `companyId`, `caseNumber?` to external API via BFF proxy.
 *  - Honor `defaultTopK`, `showCitations`, `allow*Use` role gates.
 *  - Use `apiKeySecretName` lookup at BFF (raw secret never leaves env).
 *  - Surface `confidence` and `citations` from external response.
 */

export interface ExternalKbCitation {
  title?: string;
  excerpt?: string;
  url?: string;
}

export interface ExternalKbAnswer {
  title?: string;
  answer: string;
  confidence?: number | null;
  citations?: ExternalKbCitation[];
}

export interface ExternalKbAskInput {
  query: string;
  companyId?: string | null;
  caseNumber?: string | null;
}

export interface ExternalKbAskResponse {
  answers: ExternalKbAnswer[];
}

/**
 * Mock yanıt üretici. Gerçek API hazır olmadığı için her sorgu için tek bir
 * placeholder answer döndürür. Latency taklit etmek için minik bir
 * setTimeout (UI loading state'ini doğrulamak için faydalı) — fakat hiçbir
 * gerçek I/O yapılmaz.
 */
export async function askExternalKbMock(
  input: ExternalKbAskInput,
): Promise<ExternalKbAskResponse> {
  // Hafif gecikme — UI loading davranışını test edebilmek için. Hiçbir network
  // veya backend round-trip yok.
  await new Promise((r) => setTimeout(r, 300));

  void input; // Query/context şu an mock yanıtı etkilemiyor; gerçek API hazır olunca kullanılacak.

  return {
    answers: [
      {
        title: 'Örnek KB Yanıtı',
        answer:
          "Dış bilgi bankası API'si bağlandığında cevaplar bu alanda gösterilecek.",
        confidence: null,
        citations: [],
      },
    ],
  };
}
