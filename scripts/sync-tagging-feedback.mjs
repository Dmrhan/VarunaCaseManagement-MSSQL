// GERİ-BESLEME SYNC — Etiket Doğrulama (CaseTaggingReview) → canlı golden eval set.
//
// Manuel Excel adımını ORTADAN KALDIRIR: ekip UI'da yanlış/doğru seçtikçe
// CaseTaggingReview dolar; bu script onu harness'ın okuduğu per-field golden
// set'e çevirir. Cron/zamanlanmış koşturulur → ölçüm canlı geri-beslenir.
//
// Kullanım (SUNUCUDA, DB erişimiyle):
//   node --env-file=.env scripts/sync-tagging-feedback.mjs
//
// Çıktı: data/eval/golden-set.json  (gitignore'lu — gerçek müşteri verisi)
//
// Ground-truth mantığı (per-field):
//   Verdict='Dogru'  → truth = OriginalLabel  (AI doğruydu)
//   Verdict='Yanlis' → truth = CorrectedLabel (insan düzeltti)
//   Verdict='Belirsiz'/null → confirmed=false (skorlama dışı)
import { prisma } from "../server/db/client.js";
import { writeFileSync, mkdirSync } from "node:fs";

const COMPANY = process.env.EVAL_COMPANY_ID || "COMP-UNIVERA";

// CaseTaggingReview kolon-prefix'i -> golden truth alan adı (harness AI çıktısıyla eşleşir)
const FIELDS = [
  ["openingPlatform", "platform"],
  ["openingBusinessProcess", "isSureci"],
  ["openingOperationType", "islemTipi"],
  ["openingAffectedObject", "etkilenenNesne"],
  ["openingImpact", "etki"],
  ["closingRootCauseGroup", "kokNedenGrubu"],
  ["closingRootCauseDetail", "kokNedenDetayi"],
  ["closingResolutionType", "cozumTipi"],
  ["closingPermanentPrevention", "kaliciOnlem"],
];

const reviews = await prisma.caseTaggingReview.findMany({ where: { companyId: COMPANY } });
const cases = await prisma.case.findMany({
  where: { id: { in: reviews.map((r) => r.caseId) } },
  select: { id: true, caseNumber: true, title: true, description: true, resolutionNote: true, customFields: true },
});
const caseById = new Map(cases.map((c) => [c.id, c]));

const out = [];
for (const r of reviews) {
  const c = caseById.get(r.caseId);
  if (!c) continue;
  const truth = {};
  for (const [prefix, key] of FIELDS) {
    const verdict = r[`${prefix}Verdict`];
    let label = null, confirmed = false;
    if (verdict === "Dogru") { label = r[`${prefix}OriginalLabel`]; confirmed = true; }
    else if (verdict === "Yanlis") { label = r[`${prefix}CorrectedLabel`]; confirmed = true; }
    truth[key] = { label: label ?? null, confirmed, verdict: verdict ?? null };
  }
  // Çözüm metni: resolutionNote birincil. TEAM: kapalı vakada çözüm metninin
  // gerçek kaynağını (resolutionNote / customFields / CaseSolutionStep) teyit et.
  const cf = c.customFields || {};
  const resolution =
    c.resolutionNote ||
    cf?.smartTicket?.closure?.resolutionText ||
    cf?.smartTicket?.resolution ||
    "";
  out.push({
    caseId: c.id,
    vakaNo: c.caseNumber,
    baslik: c.title,
    aciklama: c.description || "",
    cozumAciklamasi: resolution,
    truth,
  });
}

mkdirSync("data/eval", { recursive: true });
writeFileSync("data/eval/golden-set.json", JSON.stringify(out, null, 2), "utf8");

const confirmedFields = out.reduce((s, e) => s + Object.values(e.truth).filter((f) => f.confirmed).length, 0);
const corrected = out.reduce((s, e) => s + Object.values(e.truth).filter((f) => f.verdict === "Yanlis").length, 0);
console.log(`✓ ${out.length} vaka -> data/eval/golden-set.json`);
console.log(`  doğrulanmış alan (skorlanabilir): ${confirmedFields}  |  düzeltilmiş (hard-case truth): ${corrected}`);
console.log(`  Sonra ölç: node scripts/eval-smart-ticket.mjs   (ANTHROPIC_API_KEY ile)`);
await prisma.$disconnect();
