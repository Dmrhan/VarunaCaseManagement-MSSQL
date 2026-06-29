// P0.4 — KAPANIŞ HATA TRİYAJI: her "yanlış"ı bağlamıyla dök → gerçek hata mı,
// kabul edilebilir alternatif mi, yakın-ıska mı (insan/uzman sınıflar).
// node --env-file=.env scripts/triage-closure-errors.mjs
import { suggestClose } from "../server/kb/kbCore.js";
import { readFileSync } from "node:fs";

const golden = JSON.parse(readFileSync("data/eval/golden-set.json", "utf8"));
const CLOSE = [["kok_neden_grubu", "kokNedenGrubu", "Grup"], ["kok_neden_detayi", "kokNedenDetayi", "Detay"], ["cozum_tipi", "cozumTipi", "ÇözümTipi"], ["kalici_onlem", "kaliciOnlem", "KalıcıÖnlem"]];
const nrm = (s) => (s == null ? "" : String(s).trim().toLocaleLowerCase("tr"));

const misses = [];
let fieldTot = 0, n = 0;
for (const r of golden) {
  const conf = CLOSE.filter(([, tk]) => r.truth[tk]?.confirmed);
  if (!conf.length) continue;
  n++; process.stderr.write(`\r  ${n} ...`);
  const p = await suggestClose({ description: r.aciklama, resolution: r.cozumAciklamasi, open_is_sureci: r.truth.isSureci?.label, open_islem_tipi: r.truth.islemTipi?.label });
  for (const [pk, tk, lbl] of conf) {
    fieldTot++;
    if (nrm(p[pk]) !== nrm(r.truth[tk].label)) {
      misses.push({ vk: r.vakaNo, alan: lbl, ai: p[pk], dogru: r.truth[tk].label, reason: p.reason, cozum: (r.cozumAciklamasi || "").replace(/\s+/g, " ").slice(0, 240) });
    }
  }
}
process.stderr.write("\r");
console.log(`\n=== KAPANIŞ SAPMALARI (${misses.length}/${fieldTot} alan) — triyaj için ===\n`);
const byField = {};
for (const m of misses) byField[m.alan] = (byField[m.alan] || 0) + 1;
console.log("Alan bazında:", JSON.stringify(byField), "\n");
misses.forEach((m, i) => {
  console.log(`${i + 1}. [${m.vk}] ${m.alan}`);
  console.log(`   AI    : ${m.ai}`);
  console.log(`   DOĞRU : ${m.dogru}`);
  console.log(`   çözüm : ${m.cozum}`);
  console.log("");
});
