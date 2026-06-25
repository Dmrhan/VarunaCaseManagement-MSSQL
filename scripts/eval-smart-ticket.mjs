// Smart Ticket etiketleme — EVAL HARNESS (Faz 0).
// Golden set'e (referans test seti) karşı AI doğruluğunu ölçer. Her prompt/model
// değişikliğinden sonra bunu koş → puan yükseldi mi düştü mü gör (regresyon kalkanı).
//
// Kullanım:
//   node scripts/eval-smart-ticket.mjs --baseline      # API YOK: gömülü insan verdict'inden mevcut baseline
//   node scripts/eval-smart-ticket.mjs --limit 5       # CANLI ama ilk 5 vaka (smoke / maliyet kontrolü)
//   node scripts/eval-smart-ticket.mjs                 # CANLI tam koşu (ANTHROPIC_API_KEY gerekir)
//
// Canlı mod: AI'yı çalıştırıp YALNIZ insan-doğrulanmış (confirmed) truth ile
// karşılaştırır. Yanlış (pending) satırların doğru etiketi henüz yok → skorlanmaz;
// onları golden-set'te insan tamamladıkça kapsam (ve hard-case ölçümü) büyür.
import { readFileSync } from "node:fs";

const GOLDEN = "data/eval/golden-set-v1.json";
const args = process.argv.slice(2);
const baseline = args.includes("--baseline");
const reviewWrong = args.includes("--review-wrong");
const li = args.indexOf("--limit");
const limit = li >= 0 ? parseInt(args[li + 1], 10) : Infinity;

let data;
try {
  data = JSON.parse(readFileSync(GOLDEN, "utf8"));
} catch {
  console.error(`Golden set yok: ${GOLDEN}\nÖnce üret: node scripts/build-golden-set.mjs "<xlsx>"`);
  process.exit(1);
}
data = data.slice(0, limit);

const norm = (s) => (s == null ? "" : String(s).trim().toLocaleLowerCase("tr"));
const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "—");

if (baseline) {
  // Gömülü insan verdict'lerinden mevcut doğruluk — API çağrısı YOK.
  let ao = 0, at = 0, ko = 0, kt = 0;
  const byDay = {};
  for (const r of data) {
    const d = (byDay[r.gun || "?"] ??= { ao: 0, at: 0, ko: 0, kt: 0 });
    if (r.acilisVerdict !== null) { at++; d.at++; if (r.acilisConfirmed) { ao++; d.ao++; } }
    if (r.kapanisVerdict !== null) { kt++; d.kt++; if (r.kapanisConfirmed) { ko++; d.ko++; } }
  }
  console.log("=== BASELINE (gömülü insan verdict — API yok) ===");
  console.log(`Açılış : ${ao}/${at} = ${pct(ao, at)}`);
  console.log(`Kapanış: ${ko}/${kt} = ${pct(ko, kt)}`);
  console.log("Gün bazlı:");
  for (const d of Object.keys(byDay).sort()) {
    const x = byDay[d];
    console.log(`  ${d}  açılış ${pct(x.ao, x.at)} (${x.ao}/${x.at})  kapanış ${pct(x.ko, x.kt)} (${x.ko}/${x.kt})`);
  }
  process.exit(0);
}

if (reviewWrong) {
  // İnsanın YANLIŞ işaretlediği vakaları AI'ya tekrar etiketlet → eski yanlış
  // etiket + insan notu + AI'nın yeni cevabını yan yana bas. Otomatik skor YOK
  // (doğru truth henüz yok); amaç göz-kararı "düzeldi mi / hâlâ yanlış mı".
  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY gerekli"); process.exit(1); }
  const { categorizeV2, suggestClose } = await import("../server/kb/kbCore.js");
  const wrong = data.filter((r) => r.acilisVerdict === false || r.kapanisVerdict === false);
  console.log(`=== YANLIŞ VAKALAR — AI TEKRAR ETİKETLİYOR (${wrong.length} vaka) ===`);
  console.log(`ORİJİNAL = eski yanlış etiket · NOT = insan düzeltmesi · ŞİMDİ = AI'nın yeni cevabı\n`);
  let i = 0;
  for (const r of wrong) {
    process.stderr.write(`\r  ${++i}/${wrong.length} ...`);
    const L = [`[${r.vakaNo}] ${r.baslik || ""}`];
    if (r.acilisVerdict === false) {
      const p = await categorizeV2({ description: r.aciklama, project: null, customerName: r.musteri });
      const t = r.truth.acilis;
      L.push(`  AÇILIŞ  ORİJİNAL: platform=${t.platform} · is=${t.isSureci} · işlem=${t.islemTipi} · nesne=${t.etkilenenNesne} · etki=${t.etki}`);
      if (r.duzeltmeNotuAcilis) L.push(`          NOT: ${r.duzeltmeNotuAcilis}`);
      L.push(`          ŞİMDİ:    platform=${p.platform} · is=${p.is_sureci} · işlem=${p.islem_tipi} · nesne=${p.etkilenen_nesne} · etki=${p.etki}`);
    }
    if (r.kapanisVerdict === false) {
      const p = await suggestClose({ description: r.aciklama, resolution: r.cozumAciklamasi, open_is_sureci: r.truth.acilis.isSureci, open_islem_tipi: r.truth.acilis.islemTipi });
      const t = r.truth.kapanis;
      L.push(`  KAPANIŞ ORİJİNAL: grup=${t.kokNedenGrubu} · detay=${t.kokNedenDetayi} · tip=${t.cozumTipi} · önlem=${t.kaliciOnlem}`);
      if (r.duzeltmeNotuKapanis) L.push(`          NOT: ${r.duzeltmeNotuKapanis}`);
      L.push(`          ŞİMDİ:    grup=${p.kok_neden_grubu} · detay=${p.kok_neden_detayi} · tip=${p.cozum_tipi} · önlem=${p.kalici_onlem}`);
    }
    console.log(L.join("\n") + "\n");
  }
  process.stderr.write("\r");
  process.exit(0);
}

// ---- CANLI MOD ----
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY gerekli (canlı mod). Sadece baseline için: --baseline");
  process.exit(1);
}
const { categorizeV2, suggestClose } = await import("../server/kb/kbCore.js");

// AI dönüş alanı (snake) -> golden truth alanı (camel)
const OPEN = [["platform", "platform"], ["is_sureci", "isSureci"], ["islem_tipi", "islemTipi"], ["etkilenen_nesne", "etkilenenNesne"], ["etki", "etki"]];
const CLOSE = [["kok_neden_grubu", "kokNedenGrubu"], ["kok_neden_detayi", "kokNedenDetayi"], ["cozum_tipi", "cozumTipi"], ["kalici_onlem", "kaliciOnlem"]];

let oF = 0, oFt = 0, cF = 0, cFt = 0, oC = 0, oCt = 0, cC = 0, cCt = 0;
const miss = [];
let i = 0;
for (const r of data) {
  i++;
  process.stderr.write(`\r  ${i}/${data.length} ...`);
  if (r.acilisConfirmed) {
    const p = await categorizeV2({ description: r.aciklama, project: null, customerName: r.musteri });
    let ok = true;
    for (const [pk, tk] of OPEN) {
      oFt++;
      if (norm(p[pk]) === norm(r.truth.acilis[tk])) oF++;
      else { ok = false; miss.push(`AÇILIŞ.${tk}: AI="${p[pk]}" ≠ "${r.truth.acilis[tk]}" [${r.vakaNo}]`); }
    }
    oCt++; if (ok) oC++;
  }
  if (r.kapanisConfirmed) {
    const p = await suggestClose({
      description: r.aciklama, resolution: r.cozumAciklamasi,
      open_is_sureci: r.truth.acilis.isSureci, open_islem_tipi: r.truth.acilis.islemTipi,
    });
    let ok = true;
    for (const [pk, tk] of CLOSE) {
      cFt++;
      if (norm(p[pk]) === norm(r.truth.kapanis[tk])) cF++;
      else { ok = false; miss.push(`KAPANIŞ.${tk}: AI="${p[pk]}" ≠ "${r.truth.kapanis[tk]}" [${r.vakaNo}]`); }
    }
    cCt++; if (ok) cC++;
  }
}
process.stderr.write("\r");
console.log("=== CANLI EVAL (AI vs doğrulanmış truth) ===");
console.log(`AÇILIŞ  — alan top-1: ${pct(oF, oFt)} (${oF}/${oFt}) | tam-vaka: ${pct(oC, oCt)} (${oC}/${oCt})`);
console.log(`KAPANIŞ — alan top-1: ${pct(cF, cFt)} (${cF}/${cFt}) | tam-vaka: ${pct(cC, cCt)} (${cC}/${cCt})`);
console.log(`\nİlk 20 sapma (hata analizi için):`);
miss.slice(0, 20).forEach((m) => console.log("  " + m));
if (miss.length > 20) console.log(`  ... +${miss.length - 20} sapma daha`);
