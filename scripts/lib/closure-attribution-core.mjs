// Kapanış attribution — SAF mantık (DB/KB yok). attribution-closure.mjs + testler
// bunu import eder. Buradaki classify() üçlüyü (ai/human/verified) kovaya ayırır.

export const BUCKETS = [
  "dogru_herkes",
  "ai_insani_duzeltirdi",
  "model_hatasi_temiz",
  "ortak_hata",
  "ucu_farkli",
  "baglam_hatasi",
  "belirsiz",
];

export const norm = (s) => (s == null ? "" : String(s).trim().toLocaleLowerCase("tr"));

// Step-compose izleri → AI yanlış/eksik bağlam görmüş olabilir (telemetry resolutionSeen).
export const looksStepComposed = (t) =>
  typeof t === "string" &&
  (/\[ÇÖZÜLEN ADIM\]/.test(t) || /Diğer denenen adımlar/.test(t) || t.trim().length === 0);

/**
 * Bir kapanış alanını tek bir kovaya ayırır (çakışmasız).
 * @param verdict   'Dogru' | 'Yanlis' | 'Belirsiz' | null
 * @param verified  doğrulanmış gerçek (Dogru→Original, Yanlis→Corrected)
 * @param human     kapanışta uygulanan (CaseTaggingReview OriginalLabel)
 * @param ai        AI önerisi (telemetry veya rerun)
 * @param contextBad telemetry resolutionSeen step-compose/boş mu (yalnız Mode B)
 */
export function classify({ verdict, verified, human, ai, contextBad }) {
  if (verdict !== "Dogru" && verdict !== "Yanlis") return "belirsiz";
  const aiCorrect = norm(ai) === norm(verified);
  if (verdict === "Dogru") {
    // insan DOĞRU uyguladı
    if (aiCorrect) return "dogru_herkes";
    if (contextBad) return "baglam_hatasi";
    return "model_hatasi_temiz"; // insan doğru, AI yanlış (temiz bağlam) → gerçek model hatası
  }
  // Yanlis — insanın uyguladığı (Original) yanlıştı; verified = Corrected
  if (aiCorrect) return "ai_insani_duzeltirdi"; // AI doğru olanı önerirdi (insanı kurtarırdı)
  if (norm(ai) === norm(human)) return "ortak_hata"; // AI insanın YANLIŞ etiketine katıldı
  if (contextBad) return "baglam_hatasi";
  return "ucu_farkli"; // AI yanlış ama insandan da farklı
}
