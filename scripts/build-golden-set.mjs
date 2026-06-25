// Golden eval set üretici — Smart Ticket etiketleme REFERANS TEST SETİ (Faz 0).
// İnsan-doğrulanmış Excel (100 vaka) -> data/eval/golden-set-v1.json
//
// Kullanım:
//   node scripts/build-golden-set.mjs "/path/Başlıksız e-tablo (1).xlsx"
//
// ⚠️ ÇIKTI GERÇEK MÜŞTERİ VERİSİ içerir (firma/kişi adları, ticket metni).
//    data/eval/*.json .gitignore'dadır — REPOYA COMMIT'LENMEZ. Lokal/güvenli tut.
//
// Mantık: Excel'deki etiketler AI'nın TAHMİNLERİdir; "AÇILIŞ/KAPANIŞ DOĞRULUK"
// kolonu insanın doğru/yanlış kararıdır. Doğru (True) ise tahmin = yer-gerçeği
// (confirmed). Yanlış (False/metin) ise tahmin yanlış → doğru etiket EKSİK,
// düzeltme notuna göre insan tamamlamalı (harness yalnız confirmed'ı skorlar).
import XLSX from "xlsx";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const src = process.argv[2];
if (!src) {
  console.error('Kullanım: node scripts/build-golden-set.mjs "<xlsx path>"');
  process.exit(1);
}

const wb = XLSX.readFile(src);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

function parseVerdict(v) {
  if (v === true) return { correct: true, note: null };
  if (v === false) return { correct: false, note: null };
  if (v == null) return { correct: null, note: null };
  const s = String(v).trim();
  if (s === "") return { correct: null, note: null };
  const su = s.toLocaleUpperCase("tr");
  if (["TRUE", "DOĞRU", "DOGRU", "D", "EVET", "1"].includes(su)) return { correct: true, note: null };
  if (["FALSE", "YANLIŞ", "YANLIS", "Y", "HAYIR", "0"].includes(su)) return { correct: false, note: null };
  return { correct: false, note: s }; // metin = yanlış + insan düzeltme notu
}
const dayOf = (s) => {
  const m = s && String(s).match(/(\d{2}\.\d{2}\.\d{4})/);
  return m ? m[1] : null;
};
const col = (r, name) => r[name] ?? null;

// Kapanış düzeltme notu, başlıksız ilk kolonda (SheetJS bunu "__EMPTY" der).
const noteCol = Object.keys(rows[0] || {}).find((k) => /^__EMPTY/.test(k)) || null;

const out = [];
for (const r of rows) {
  const vakaNo = col(r, "Vaka No");
  if (!vakaNo) continue;
  const av = parseVerdict(col(r, "AÇILIŞ DOĞRULUK"));
  const kv = parseVerdict(col(r, "KAPANIŞ DOĞRULUK"));
  out.push({
    vakaNo,
    baslik: col(r, "Başlık"),
    sirket: col(r, "Şirket"),
    musteri: col(r, "Müşteri"),
    gun: dayOf(col(r, "Açılış Zamanı")),
    // Etiketleyici girdileri:
    aciklama: col(r, "Açıklama") || "",
    cozumAciklamasi: col(r, "Çözüm Açıklaması") || "",
    // Yer-gerçeği (AI tahmini; insan onayladıysa "confirmed"):
    truth: {
      acilis: {
        platform: col(r, "Platform"),
        isSureci: col(r, "İş Süreci"),
        islemTipi: col(r, "İşlem Tipi"),
        etkilenenNesne: col(r, "Etkilenen Nesne"),
        etki: col(r, "Etki"),
      },
      kapanis: {
        kokNedenGrubu: col(r, "Kök Neden Grubu"),
        kokNedenDetayi: col(r, "Kök Neden Detayı"),
        cozumTipi: col(r, "Çözüm Tipi"),
        kaliciOnlem: col(r, "Kalıcı Önlem"),
      },
    },
    acilisConfirmed: av.correct === true,
    kapanisConfirmed: kv.correct === true,
    acilisVerdict: av.correct, // true | false | null(etiketsiz)
    kapanisVerdict: kv.correct,
    duzeltmeNotuAcilis: av.note || null,
    duzeltmeNotuKapanis: kv.note || (noteCol ? (col(r, noteCol) ? String(col(r, noteCol)) : null) : null),
  });
}

const outPath = "data/eval/golden-set-v1.json";
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");

const at = out.filter((x) => x.acilisVerdict !== null).length;
const kt = out.filter((x) => x.kapanisVerdict !== null).length;
const ao = out.filter((x) => x.acilisConfirmed).length;
const ko = out.filter((x) => x.kapanisConfirmed).length;
const p = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "—");
console.log(`✓ ${out.length} vaka -> ${outPath}`);
console.log(`  BASELINE açılış : ${ao}/${at} = ${p(ao, at)} doğrulanmış`);
console.log(`  BASELINE kapanış: ${ko}/${kt} = ${p(ko, kt)} doğrulanmış`);
console.log(`  İnsan-tamamlama bekleyen (yanlış→doğru truth): açılış ${at - ao}, kapanış ${kt - ko}`);
