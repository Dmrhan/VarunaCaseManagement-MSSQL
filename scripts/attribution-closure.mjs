/**
 * attribution-closure.mjs — Kapanış hatası ATTRIBUTION raporu.
 *
 * Çalıştır:  node --env-file=.env scripts/attribution-closure.mjs
 *            LIMIT=20 node --env-file=.env scripts/attribution-closure.mjs   (hızlı deneme)
 *
 * "%61 tek parça sayı" olmaktan çıkar: kapanış hatasını AI(öneri) vs
 * human(uygulanan) vs verified(gün-sonu doğrulama) üçlüsüyle KOVALARA ayırır.
 *
 * VERİ KAYNAKLARI (üçlü):
 *   - ai       : AI'nın önerisi.
 *                · Tercih: persisted telemetry closureSuggestion.aiSuggested
 *                  (yeni; resolutionSeen ile BAĞLAM hatası da ayrışır).
 *                · Yoksa : kbCore.suggestClose ile YENİDEN koşulur (doğru bağlam
 *                  beslenir → "temiz-bağlam" AI doğruluğu).
 *   - human    : kapanışta uygulanan etiket = CaseTaggingReview OriginalLabel
 *                (telemetry varsa humanApplied).
 *   - verified : gün-sonu doğrulanmış gerçek (Dogru→Original, Yanlis→Corrected,
 *                Belirsiz→ayrıştırılamaz).
 *
 * KOVALAR (alan başına, çakışmasız):
 *   dogru_herkes        AI doğru + insan doğru (verdict Dogru, ai==verified)
 *   ai_insani_duzeltirdi insan kapanışta yanıldı AMA AI doğru olanı önerirdi
 *                        (verdict Yanlis, ai==verified) → AI DEĞER katardı
 *   model_hatasi_temiz  insan DOĞRU uyguladı ama AI yanlış (verdict Dogru, ai!=verified)
 *                        → temiz-bağlam GERÇEK MODEL HATASI (en aksiyon alınası)
 *   ortak_hata          AI insanın YANLIŞ etiketine katılıyor (verdict Yanlis,
 *                        ai==human) → model hatası + güvenlik ağı yok
 *   ucu_farkli          AI yanlış ama insandan da farklı yanlış (üçü ayrı)
 *   baglam_hatasi       (yalnız telemetry) resolutionSeen step-compose/boş + AI yanlış
 *   belirsiz            verdict Belirsiz/null → taksonomi/öznel belirsizlik (hata değil)
 *
 * AI doğruluğu  = (dogru_herkes + ai_insani_duzeltirdi) / confirmed
 * Hata bütçesi  = model_hatasi_temiz + ortak_hata + ucu_farkli (+ baglam_hatasi)
 */
import { prisma } from "../server/db/client.js";
import { suggestClose } from "../server/kb/kbCore.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { BUCKETS, norm, looksStepComposed, classify } from "./lib/closure-attribution-core.mjs";

const COMPANY = process.env.EVAL_COMPANY_ID || "COMP-UNIVERA";
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const CACHE_PATH = "data/eval/ai-predictions-cache.json";

// CaseTaggingReview kapanış prefix → kbCore alan adı + golden field adı
const CLOSE = [
  ["closingRootCauseGroup", "kok_neden_grubu", "Kök Neden Grubu"],
  ["closingRootCauseDetail", "kok_neden_detayi", "Kök Neden Detayı"],
  ["closingResolutionType", "cozum_tipi", "Çözüm Tipi"],
  ["closingPermanentPrevention", "kalici_onlem", "Kalıcı Önlem"],
];
// ── Veri çek ──
const reviews = await prisma.caseTaggingReview.findMany({ where: { companyId: COMPANY } });
const cases = await prisma.case.findMany({
  where: { id: { in: reviews.map((r) => r.caseId) } },
  select: { id: true, caseNumber: true, description: true, resolutionNote: true, customFields: true },
});
const caseById = new Map(cases.map((c) => [c.id, c]));

// ── AI prediction cache (rerun maliyetini bir kez öde) ──
let cache = {};
if (existsSync(CACHE_PATH)) { try { cache = JSON.parse(readFileSync(CACHE_PATH, "utf8")); } catch { cache = {}; } }

async function getAiPrediction(c, persistedAi) {
  // Mode B — persisted telemetry varsa onu kullan (canlı, resolutionSeen ile)
  if (persistedAi?.perField) {
    const pf = persistedAi.perField;
    return {
      kok_neden_grubu: pf.rootCauseGroup?.label ?? null,
      kok_neden_detayi: pf.rootCauseDetail?.label ?? null,
      cozum_tipi: pf.resolutionType?.label ?? null,
      kalici_onlem: pf.permanentPrevention?.label ?? null,
      resolutionSeen: persistedAi.resolutionSeen ?? null,
      source: "telemetry",
    };
  }
  // Mode A — yerel kbCore ile yeniden koş (doğru bağlam beslenir), cache'le
  if (cache[c.id]) return { ...cache[c.id], source: "rerun-cache" };
  const cf = c.customFields || {};
  const st = cf.smartTicket || {};
  const out = await suggestClose({
    description: c.description || "",
    resolution: c.resolutionNote || cf?.smartTicket?.closure?.resolutionText || "",
    open_is_sureci: typeof st.businessProcessLabel === "string" ? st.businessProcessLabel : undefined,
    open_islem_tipi: typeof st.operationTypeLabel === "string" ? st.operationTypeLabel : undefined,
  });
  const pred = {
    kok_neden_grubu: out.kok_neden_grubu ?? null,
    kok_neden_detayi: out.kok_neden_detayi ?? null,
    cozum_tipi: out.cozum_tipi ?? null,
    kalici_onlem: out.kalici_onlem ?? null,
    resolutionSeen: c.resolutionNote || "", // rerun'da doğru bağlam besledik
  };
  cache[c.id] = pred;
  return { ...pred, source: "rerun" };
}

// ── Attribution ──
const tally = () => Object.fromEntries(BUCKETS.map((b) => [b, 0]));
const overall = tally();
const perField = Object.fromEntries(CLOSE.map(([, k, lbl]) => [lbl, tally()]));
let aiDivergesHuman = 0, confirmedTotal = 0, telemetryCases = 0;

const rows = reviews.filter((r) => caseById.has(r.caseId)).slice(0, LIMIT === Infinity ? undefined : LIMIT);
let n = 0;
for (const r of rows) {
  const c = caseById.get(r.caseId);
  const persistedAi = c.customFields?.smartTicket?.closure?.closureSuggestion?.aiSuggested ?? null;
  if (persistedAi) telemetryCases++;
  n++; process.stderr.write(`\r  ${n}/${rows.length} ...`);
  const ai = await getAiPrediction(c, persistedAi);
  const contextBad = ai.source === "telemetry" && looksStepComposed(ai.resolutionSeen);

  for (const [prefix, aiKey, lbl] of CLOSE) {
    const verdict = r[`${prefix}Verdict`];
    if (verdict !== "Dogru" && verdict !== "Yanlis") { overall.belirsiz++; perField[lbl].belirsiz++; continue; }
    const original = r[`${prefix}OriginalLabel`]; // human applied
    const verified = verdict === "Dogru" ? original : r[`${prefix}CorrectedLabel`];
    confirmedTotal++;
    const bucket = classify({ verdict, verified, human: original, ai: ai[aiKey], contextBad });
    overall[bucket]++; perField[lbl][bucket]++;
    if (norm(ai[aiKey]) !== norm(original)) aiDivergesHuman++;
  }
}
process.stderr.write("\r");
mkdirSync("data/eval", { recursive: true });
writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");

// ── Rapor ──
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + "%" : "—");
const confirmed = confirmedTotal;
const aiCorrect = overall.dogru_herkes + overall.ai_insani_duzeltirdi;
const errors = overall.model_hatasi_temiz + overall.ortak_hata + overall.ucu_farkli + overall.baglam_hatasi;

console.log(`\n══════════════════════════════════════════════════════════════`);
console.log(`  KAPANIŞ ATTRIBUTION — ${rows.length} vaka · ${confirmed} doğrulanmış alan`);
console.log(`  AI kaynağı: ${telemetryCases} telemetry / ${rows.length - telemetryCases} rerun(kbCore)`);
console.log(`══════════════════════════════════════════════════════════════`);
console.log(`\n  AI doğruluğu (temiz-bağlam): ${pct(aiCorrect, confirmed)}  (${aiCorrect}/${confirmed})`);
console.log(`  Belirsiz (öznel/taksonomi) : ${pct(overall.belirsiz, confirmed + overall.belirsiz)} alanlar — denominatör DIŞI`);

console.log(`\n  ── 39'luk hata NEREYE gidiyor (kovalar) ──`);
const errBuckets = [
  ["model_hatasi_temiz", "Gerçek model hatası (insan doğru, AI yanlış — temiz)"],
  ["ortak_hata",         "Ortak hata (AI insanın yanlışına katıldı, güvenlik ağı yok)"],
  ["ucu_farkli",         "Üçü farklı (AI≠insan≠doğru — çok zor/öznel vaka)"],
  ["baglam_hatasi",      "Bağlam hatası (AI yanlış metin gördü — yalnız telemetry)"],
];
for (const [k, desc] of errBuckets) {
  console.log(`    ${desc.padEnd(58)} ${String(overall[k]).padStart(4)}  (hata içi ${pct(overall[k], errors)} · tüm alan ${pct(overall[k], confirmed)})`);
}
console.log(`    ${"TOPLAM HATA".padEnd(58)} ${String(errors).padStart(4)}  (${pct(errors, confirmed)})`);

console.log(`\n  ── AI'nın DEĞERİ + insan kapanış kalitesi ──`);
console.log(`    AI insanı düzeltirdi (insan yanıldı, AI doğru): ${overall.ai_insani_duzeltirdi}  → AI bu kapanış hatalarını önlerdi`);
console.log(`    Herkes doğru                                  : ${overall.dogru_herkes}`);
console.log(`    AI ≠ insan (öneri/uygulama AYRIŞMASI, override proxy): ${aiDivergesHuman}/${confirmed} (${pct(aiDivergesHuman, confirmed)})`);

console.log(`\n  ── Alan bazında gerçek model hatası (model_hatasi_temiz + ortak_hata) ──`);
for (const [, , lbl] of CLOSE) {
  const f = perField[lbl];
  const fConf = BUCKETS.filter((b) => b !== "belirsiz").reduce((s, b) => s + f[b], 0);
  const fModel = f.model_hatasi_temiz + f.ortak_hata + f.ucu_farkli;
  console.log(`    ${lbl.padEnd(20)} doğru ${pct(f.dogru_herkes + f.ai_insani_duzeltirdi, fConf).padStart(4)} · model-hata ${String(fModel).padStart(3)} · belirsiz ${f.belirsiz}`);
}

console.log(`\n  ── YORUM ──`);
console.log(`    • "Gerçek model hatası" = modelin TEMİZ bağlamda, insanın doğru yaptığı`);
console.log(`      yerde yanıldığı çekirdek. Aksiyon: taksonomi netleştirme / clarifying / model.`);
console.log(`    • "Belirsiz" denominatör dışı — adil ölçümle AI doğruluğu bundan yüksektir.`);
console.log(`    • Bağlam hatası + gerçek insan-override SAYISI canlı telemetry biriktikçe`);
console.log(`      netleşir (resolutionSeen + closureSuggestion.humanApplied.changedFromAi).`);
console.log(`\n  (AI tahmin cache: ${CACHE_PATH} — tekrar koşu ücretsiz)`);

await prisma.$disconnect();
