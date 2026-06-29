// FAZ 1 — retrieval VARYANT ölçümü (naive kurtulabilir mi?).
// Baseline (OFF) vs Eşik-kapılı (top-1, sim>TH) vs Çözüm-bağlamı (top-3, etiketsiz).
// node --env-file=.env scripts/validate-faz1-variants.mjs
import { prisma } from "../server/db/client.js";
import { suggestClose, embed, embedBatch } from "../server/kb/kbCore.js";
import { readFileSync } from "node:fs";

const COMPANY = process.env.EVAL_COMPANY_ID || "COMP-UNIVERA";
const TH = Number(process.env.SIM_THRESHOLD || 0.86); // eşik

const closed = await prisma.case.findMany({
  where: { companyId: COMPANY, status: "Cozuldu" },
  select: { id: true, description: true, resolutionNote: true, customFields: true },
});
const corpus = closed.map((c) => {
  const cl = c.customFields?.smartTicket?.closure;
  if (!cl?.rootCauseGroupLabel) return null;
  return {
    caseId: c.id,
    text: `${(c.description || "").slice(0, 700)}\n${(c.resolutionNote || "").slice(0, 700)}`,
    cozum: (c.resolutionNote || "").slice(0, 400),
    grup: cl.rootCauseGroupLabel, detay: cl.rootCauseDetailLabel, tip: cl.resolutionTypeLabel,
  };
}).filter(Boolean);
console.error(`Corpus: ${corpus.length} — embed...`);
const norm = (v) => { let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m) || 1; return v.map((x) => x / m); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const cv = (await embedBatch(corpus.map((c) => c.text))).map(norm);
console.error(`embed tamam. eşik=${TH}. ölçülüyor...`);

const golden = JSON.parse(readFileSync("data/eval/golden-set.json", "utf8"));
const CLOSE = [["kok_neden_grubu", "kokNedenGrubu"], ["kok_neden_detayi", "kokNedenDetayi"], ["cozum_tipi", "cozumTipi"], ["kalici_onlem", "kaliciOnlem"]];
const nrm = (s) => (s == null ? "" : String(s).trim().toLocaleLowerCase("tr"));
const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "—");

const S = { off: [0, 0], th: [0, 0], ctx: [0, 0] };
let n = 0, thHits = 0; const sims = [];
for (const r of golden) {
  const conf = CLOSE.filter(([, tk]) => r.truth[tk]?.confirmed);
  if (!conf.length) continue;
  n++; process.stderr.write(`\r  ${n} ...`);
  const qv = norm(await embed(`${(r.aciklama || "").slice(0, 700)}\n${(r.cozumAciklamasi || "").slice(0, 700)}`));
  const ranked = corpus.map((c, i) => ({ c, s: dot(qv, cv[i]) })).filter((x) => x.c.caseId !== r.caseId).sort((a, b) => b.s - a.s);
  sims.push(ranked[0]?.s ?? 0);

  // Varyant promptları
  const top3 = ranked.slice(0, 3);
  const thEx = ranked[0] && ranked[0].s > TH
    ? `ÇOK BENZER ÇÖZÜLMÜŞ VAKA (referans, doğruysa kullan):\n  • ${top3[0].c.text.replace(/\s+/g, " ").slice(0, 220)}\n    → Kök Neden: ${top3[0].c.grup} · Detay: ${top3[0].c.detay} · Çözüm: ${top3[0].c.tip}`
    : "";
  const ctxEx = "BENZER VAKALARDA NE YAPILDI (çözüm metinleri — kendi kararını ver, etiketi kopyalama):\n" +
    top3.map((x) => `  • ${x.c.cozum.replace(/\s+/g, " ").slice(0, 200)}`).join("\n");

  const base = { description: r.aciklama, resolution: r.cozumAciklamasi, open_is_sureci: r.truth.isSureci?.label, open_islem_tipi: r.truth.islemTipi?.label };
  const pOff = await suggestClose(base);
  const pTh = await suggestClose({ ...base, closeExamples: thEx });
  const pCtx = await suggestClose({ ...base, closeExamples: ctxEx });
  if (thEx) thHits++;
  for (const [pk, tk] of conf) {
    const t = nrm(r.truth[tk].label);
    S.off[1]++; if (nrm(pOff[pk]) === t) S.off[0]++;
    S.th[1]++; if (nrm(pTh[pk]) === t) S.th[0]++;
    S.ctx[1]++; if (nrm(pCtx[pk]) === t) S.ctx[0]++;
  }
}
process.stderr.write("\r");
sims.sort((a, b) => b - a);
console.log(`\n=== FAZ 1 VARYANT — kapanış (${n} vaka, corpus ${corpus.length}, eşik ${TH}) ===`);
console.log(`Baseline (OFF)       : ${pct(...S.off)} (${S.off[0]}/${S.off[1]})`);
console.log(`Eşik-kapılı (top-1)  : ${pct(...S.th)} (${S.th[0]}/${S.th[1]})  [eşik üstü ${thHits}/${n} vaka]`);
console.log(`Çözüm-bağlamı (top-3): ${pct(...S.ctx)} (${S.ctx[0]}/${S.ctx[1]})`);
console.log(`Benzerlik dağılımı (top-1 cosine): max ${sims[0]?.toFixed(2)} med ${sims[Math.floor(sims.length / 2)]?.toFixed(2)} min ${sims[sims.length - 1]?.toFixed(2)}`);
const best = Math.max(S.th[0], S.ctx[0]);
console.log(best > S.off[0] ? "→ bir varyant baseline'ı GEÇTİ ✓ — retrieval yaşayabilir" : "→ hiçbiri baseline'ı geçemedi ✗ — retrieval kapanışta kaldıraç DEĞİL");
await prisma.$disconnect();
