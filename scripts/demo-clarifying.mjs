// P1.2 DEMO — clarifying-soru akışı. Hangi vakalar soru tetikliyor + mekanizma.
// node --env-file=.env scripts/demo-clarifying.mjs
import { suggestClose } from "../server/kb/kbCore.js";
import { readFileSync } from "node:fs";

const golden = JSON.parse(readFileSync("data/eval/golden-set.json", "utf8"));
let needs = 0, tot = 0;
const examples = [];
for (const r of golden) {
  if (!CLOSE_CONF(r)) continue;
  tot++;
  const p = await suggestClose({ description: r.aciklama, resolution: r.cozumAciklamasi, open_is_sureci: r.truth.isSureci?.label, open_islem_tipi: r.truth.islemTipi?.label });
  process.stderr.write(`\r  ${tot} ...`);
  if (p.needsClarification) { needs++; if (examples.length < 3) examples.push({ vk: r.vakaNo, baslik: r.baslik, conf: p.confidence, grup: p.kok_neden_grubu, q: p.clarifyingQuestions }); }
}
function CLOSE_CONF(r) { return ["kokNedenGrubu", "kokNedenDetayi", "cozumTipi", "kaliciOnlem"].some((k) => r.truth[k]?.confirmed); }
process.stderr.write("\r");
console.log(`\n=== P1.2 — Clarifying tetiklenme: ${needs}/${tot} vaka (eşik ${process.env.CLOSE_CLARIFY_THRESHOLD || 0.8}) ===\n`);
for (const e of examples) {
  console.log(`[${e.vk}] ${e.baslik}  (conf ${e.conf}, kök neden grubu: ${e.grup ?? "BOŞ"})`);
  console.log("  → AI emin değil, etiket basmadan ÖNCE soruyor:");
  e.q.forEach((q, i) => console.log(`     ${i + 1}. ${q}`));
  console.log("");
}

// Mekanizma: bir belirsiz vakada cevap verince çıktı zenginleşir mi?
const u = golden.find((r) => CLOSE_CONF(r));
if (u) {
  console.log(`=== MEKANİZMA — cevap verince (${u.vakaNo}) ===`);
  const before = await suggestClose({ description: u.aciklama, resolution: u.cozumAciklamasi });
  const ans = "Kök neden: parametre/konfigürasyon kaynaklı; çözüm: ilgili parametre düzeltildi; tekrarı önlemek için kontrol eklenmeli.";
  const after = await suggestClose({ description: u.aciklama, resolution: u.cozumAciklamasi, clarifyingAnswers: ans });
  console.log(`  CEVAPSIZ → grup=${before.kok_neden_grubu} · needsClarification=${before.needsClarification}`);
  console.log(`  CEVAP("${ans.slice(0, 50)}...") → grup=${after.kok_neden_grubu} · tip=${after.cozum_tipi} · needsClarification=${after.needsClarification} (tekrar sormaz)`);
}
