// P0.4 — KABUL-SETİ ile yeniden ölçüm. Kapanış: strict (exact) vs kabul (eşdeğer
// grup içi de doğru). Semantik gruplar (sapmalardan değil, anlamdan — taslak,
// ekip genişletir). Calibration'ı da kabul-setine göre yeniden hesaplar.
// node --env-file=.env scripts/eval-acceptable.mjs
import { suggestClose } from "../server/kb/kbCore.js";
import { readFileSync } from "node:fs";

const golden = JSON.parse(readFileSync("data/eval/golden-set.json", "utf8"));
const CLOSE = [["kok_neden_grubu", "kokNedenGrubu"], ["kok_neden_detayi", "kokNedenDetayi"], ["cozum_tipi", "cozumTipi"], ["kalici_onlem", "kaliciOnlem"]];
const nrm = (s) => (s == null ? "" : String(s).trim().toLocaleLowerCase("tr"));

// KABUL-EŞDEĞERLİK (semantik, taslak — ekip doğrular/genişletir)
const KABUL = {
  cozumTipi: [["kullanıcı eğitim", "doküman / sss"]], // rehberlik (sistem değişikliği yok)
  kaliciOnlem: [["bilgi bankası yazısı hazırlanacak", "eğitim içeriği hazırlanacak"]], // içerik üretme
};
const sameGroup = (tk, a, b) => (KABUL[tk] || []).some((g) => g.includes(nrm(a)) && g.includes(nrm(b)));

let strictOk = 0, accOk = 0, tot = 0, n = 0;
const cal = []; // {conf, accCorrect}
for (const r of golden) {
  const conf = CLOSE.filter(([, tk]) => r.truth[tk]?.confirmed);
  if (!conf.length) continue;
  n++; process.stderr.write(`\r  ${n} ...`);
  const p = await suggestClose({ description: r.aciklama, resolution: r.cozumAciklamasi, open_is_sureci: r.truth.isSureci?.label, open_islem_tipi: r.truth.islemTipi?.label });
  const c = typeof p.confidence === "number" ? p.confidence : 0.5;
  for (const [pk, tk] of conf) {
    tot++;
    const exact = nrm(p[pk]) === nrm(r.truth[tk].label);
    const acc = exact || sameGroup(tk, p[pk], r.truth[tk].label);
    if (exact) strictOk++;
    if (acc) accOk++;
    cal.push({ conf: c, ok: acc ? 1 : 0 });
  }
}
process.stderr.write("\r");
const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "—");
// ECE (kabul-setine göre)
const bins = Array.from({ length: 10 }, () => ({ c: 0, ok: 0, sc: 0 }));
for (const s of cal) { const b = Math.min(9, Math.floor(s.conf * 10)); bins[b].c++; bins[b].ok += s.ok; bins[b].sc += s.conf; }
let ece = 0; for (const b of bins) if (b.c) ece += (b.c / cal.length) * Math.abs(b.sc / b.c - b.ok / b.c);
const avgConf = cal.reduce((a, s) => a + s.conf, 0) / cal.length;

console.log(`\n=== KAPANIŞ — STRICT vs KABUL-SETİ (${n} vaka, ${tot} alan) ===`);
console.log(`Strict (exact-match) : ${pct(strictOk, tot)} (${strictOk}/${tot})`);
console.log(`Kabul-seti (eşdeğer) : ${pct(accOk, tot)} (${accOk}/${tot})  ← gerçek tabloya daha yakın`);
console.log(`\nKalibrasyon (kabul-setine göre): ort.conf ${(avgConf * 100).toFixed(0)}% vs doğruluk ${pct(accOk, tot)}  ECE ${(ece * 100).toFixed(1)}% ${ece < 0.07 ? "→ İYİ kalibre" : ece < 0.1 ? "→ makul" : "→ kötü"}`);
console.log("\nNot: gruplar muhafazakâr (sadece 2 net eşdeğer çift). Ekip genişletirse kabul daha da yükselir.");
