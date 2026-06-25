// P0.3 — CONFIDENCE KALİBRASYONU (reliability diagram + ECE).
// "Confidence X diyen tahminlerin gerçekte %kaçı doğru?" → gating eşiğini bu belirler.
// node --env-file=.env scripts/eval-calibration.mjs
import { categorizeV2, suggestClose } from "../server/kb/kbCore.js";
import { readFileSync } from "node:fs";

const golden = JSON.parse(readFileSync("data/eval/golden-set.json", "utf8"));
const OPEN = [["platform", "platform"], ["is_sureci", "isSureci"], ["islem_tipi", "islemTipi"], ["etkilenen_nesne", "etkilenenNesne"], ["etki", "etki"]];
const CLOSE = [["kok_neden_grubu", "kokNedenGrubu"], ["kok_neden_detayi", "kokNedenDetayi"], ["cozum_tipi", "cozumTipi"], ["kalici_onlem", "kaliciOnlem"]];
const nrm = (s) => (s == null ? "" : String(s).trim().toLocaleLowerCase("tr"));

// her örnek: { conf, correct }  (conf = çağrının confidence'ı, alan bazlı doğruluk)
const samplesOpen = [], samplesClose = [];
let n = 0;
for (const r of golden) {
  const oc = OPEN.filter(([, tk]) => r.truth[tk]?.confirmed);
  const cc = CLOSE.filter(([, tk]) => r.truth[tk]?.confirmed);
  if (!oc.length && !cc.length) continue;
  n++; process.stderr.write(`\r  ${n} ...`);
  if (oc.length) {
    const p = await categorizeV2({ description: r.aciklama, project: null, customerName: r.musteri });
    const conf = typeof p.confidence === "number" ? p.confidence : 0.5;
    for (const [pk, tk] of oc) samplesOpen.push({ conf, correct: nrm(p[pk]) === nrm(r.truth[tk].label) ? 1 : 0 });
  }
  if (cc.length) {
    const p = await suggestClose({ description: r.aciklama, resolution: r.cozumAciklamasi, open_is_sureci: r.truth.isSureci?.label, open_islem_tipi: r.truth.islemTipi?.label });
    const conf = typeof p.confidence === "number" ? p.confidence : 0.5;
    for (const [pk, tk] of cc) samplesClose.push({ conf, correct: nrm(p[pk]) === nrm(r.truth[tk].label) ? 1 : 0 });
  }
}
process.stderr.write("\r");

function report(name, S) {
  if (!S.length) { console.log(`\n[${name}] örnek yok`); return; }
  const bins = Array.from({ length: 10 }, () => ({ c: 0, ok: 0, sumConf: 0 }));
  for (const s of S) { const b = Math.min(9, Math.floor(s.conf * 10)); bins[b].c++; bins[b].ok += s.correct; bins[b].sumConf += s.conf; }
  let ece = 0; const N = S.length;
  console.log(`\n=== ${name} KALİBRASYON (${N} alan-örneği) ===`);
  console.log("conf aralığı   n   ort.conf  gerçek-doğruluk  fark");
  for (let i = 0; i < 10; i++) {
    const b = bins[i]; if (!b.c) continue;
    const acc = b.ok / b.c, avgC = b.sumConf / b.c, gap = Math.abs(avgC - acc);
    ece += (b.c / N) * gap;
    const bar = "█".repeat(Math.round(acc * 20));
    console.log(`${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}  ${String(b.c).padStart(3)}   ${avgC.toFixed(2)}     ${(acc * 100).toFixed(0).padStart(3)}%  ${bar}  ${gap > 0.1 ? "⚠️" : ""}`);
  }
  const overallAcc = S.reduce((a, s) => a + s.correct, 0) / N;
  const overallConf = S.reduce((a, s) => a + s.conf, 0) / N;
  console.log(`ECE (kalibrasyon hatası): ${(ece * 100).toFixed(1)}%  ${ece > 0.1 ? "→ KÖTÜ kalibre (gating riskli)" : "→ makul"}`);
  console.log(`ort. confidence ${(overallConf * 100).toFixed(0)}% vs gerçek doğruluk ${(overallAcc * 100).toFixed(0)}% ${overallConf > overallAcc + 0.05 ? "→ AŞIRI-GÜVENLİ" : overallConf < overallAcc - 0.05 ? "→ FAZLA-ÇEKİNGEN" : "→ dengeli"}`);
}
report("AÇILIŞ", samplesOpen);
report("KAPANIŞ", samplesClose);
console.log("\nYorum: gating eşiği, doğruluğun kabul edilebilir seviyeye (örn. ≥%90) çıktığı conf değeridir.");
