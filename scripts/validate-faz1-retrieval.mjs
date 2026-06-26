// FAZ 1 VALIDATION — kapanış retrieval gerçekten iyileştiriyor mu? (ÖLÇ)
// Corpus = Varuna çözülmüş vakalar (kapanış etiketli). Golden = CaseTaggingReview.
// Her golden vakada top-3 benzer çözülmüş vaka → suggestClose AÇIK/KAPALI → karşılaştır.
// Kullanım: node --env-file=.env scripts/validate-faz1-retrieval.mjs
import { prisma } from "../server/db/client.js";
import { suggestClose, embed, embedBatch } from "../server/kb/kbCore.js";
import { readFileSync } from "node:fs";

const COMPANY = process.env.EVAL_COMPANY_ID || "COMP-UNIVERA";

// 1) Corpus: çözülmüş + kapanış-etiketli Varuna vakaları
const closed = await prisma.case.findMany({
  where: { companyId: COMPANY, status: "Cozuldu" },
  select: { id: true, caseNumber: true, description: true, resolutionNote: true, customFields: true },
});
const corpus = closed
  .map((c) => {
    const cl = c.customFields?.smartTicket?.closure;
    if (!cl?.rootCauseGroupLabel) return null;
    return {
      caseId: c.id,
      text: `${(c.description || "").slice(0, 800)}\n${(c.resolutionNote || "").slice(0, 800)}`,
      grup: cl.rootCauseGroupLabel, detay: cl.rootCauseDetailLabel, tip: cl.resolutionTypeLabel,
    };
  })
  .filter(Boolean);
console.error(`Corpus: ${corpus.length} etiketli çözülmüş vaka — embed ediliyor (model ilk seferde iniyor)...`);

const norm = (v) => { let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m) || 1; return v.map((x) => x / m); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const corpusVecs = (await embedBatch(corpus.map((c) => c.text))).map(norm);
console.error("Corpus embed tamam. Golden set üzerinde ölçülüyor...");

const golden = JSON.parse(readFileSync("data/eval/golden-set.json", "utf8"));
const CLOSE = [["kok_neden_grubu", "kokNedenGrubu"], ["kok_neden_detayi", "kokNedenDetayi"], ["cozum_tipi", "cozumTipi"], ["kalici_onlem", "kaliciOnlem"]];
const nrm = (s) => (s == null ? "" : String(s).trim().toLocaleLowerCase("tr"));
const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "—");

let onF = 0, onT = 0, offF = 0, offT = 0, n = 0;
for (const r of golden) {
  const conf = CLOSE.filter(([, tk]) => r.truth[tk]?.confirmed);
  if (!conf.length) continue;
  n++; process.stderr.write(`\r  ${n} ...`);
  const qv = norm(await embed(`${(r.aciklama || "").slice(0, 800)}\n${(r.cozumAciklamasi || "").slice(0, 800)}`));
  const top = corpus
    .map((c, idx) => ({ c, s: dot(qv, corpusVecs[idx]) }))
    .filter((x) => x.c.caseId !== r.caseId) // leakage guard
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  const examples =
    "BENZER ÇÖZÜLMÜŞ VAKALAR (geçmişten en yakın — aynı tip için doğru kök nedeni örnek al, körü körüne kopyalama):\n" +
    top.map((x) => `  • Sorun: ${x.c.text.replace(/\s+/g, " ").slice(0, 220)}\n    → Kök Neden: ${x.c.grup} · Detay: ${x.c.detay} · Çözüm: ${x.c.tip}`).join("\n");

  const base = { description: r.aciklama, resolution: r.cozumAciklamasi, open_is_sureci: r.truth.isSureci?.label, open_islem_tipi: r.truth.islemTipi?.label };
  const pOff = await suggestClose(base);
  const pOn = await suggestClose({ ...base, closeExamples: examples });
  for (const [pk, tk] of conf) {
    const truth = r.truth[tk].label;
    offT++; if (nrm(pOff[pk]) === nrm(truth)) offF++;
    onT++; if (nrm(pOn[pk]) === nrm(truth)) onF++;
  }
}
process.stderr.write("\r");
console.log(`\n=== FAZ 1 VALIDATION — kapanış retrieval (${n} vaka, corpus ${corpus.length}) ===`);
console.log(`Retrieval KAPALI: ${pct(offF, offT)} (${offF}/${offT})`);
console.log(`Retrieval AÇIK  : ${pct(onF, onT)} (${onF}/${onT})`);
console.log(onF > offF ? `→ retrieval İYİLEŞTİRDİ ✓ (+${onF - offF} alan)` : onF < offF ? `→ retrieval KÖTÜLEŞTİRDİ ✗ (${onF - offF})` : "→ fark yok (örneklem küçük olabilir)");
await prisma.$disconnect();
