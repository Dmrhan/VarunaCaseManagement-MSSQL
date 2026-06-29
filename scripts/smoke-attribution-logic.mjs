/**
 * smoke-attribution-logic.mjs — attribution classify() doğruluk-tablosu testi.
 * DB/KB GEREKTİRMEZ (saf mantık). Çalıştır: node scripts/smoke-attribution-logic.mjs
 *
 * Her kovanın doğru tetiklendiğini + Türkçe normalize + öncelik sırasını kanıtlar.
 */
import { classify, norm } from "./lib/closure-attribution-core.mjs";

let pass = 0, fail = 0;
const eq = (name, got, exp) => {
  if (got === exp) { pass++; console.log(`✓ ${name} → ${got}`); }
  else { fail++; console.log(`✗ ${name} → ${got} (beklenen ${exp})`); }
};

// ── Doğruluk tablosu (her kova) ──
eq("Dogru + ai==verified", classify({ verdict: "Dogru", verified: "A", human: "A", ai: "A" }), "dogru_herkes");
eq("Dogru + ai!=verified (temiz)", classify({ verdict: "Dogru", verified: "A", human: "A", ai: "B" }), "model_hatasi_temiz");
eq("Dogru + ai!=verified + contextBad", classify({ verdict: "Dogru", verified: "A", human: "A", ai: "B", contextBad: true }), "baglam_hatasi");
eq("Yanlis + ai==verified (insanı düzeltir)", classify({ verdict: "Yanlis", verified: "A", human: "B", ai: "A" }), "ai_insani_duzeltirdi");
eq("Yanlis + ai==human (ortak hata)", classify({ verdict: "Yanlis", verified: "A", human: "B", ai: "B" }), "ortak_hata");
eq("Yanlis + ai!=human!=verified", classify({ verdict: "Yanlis", verified: "A", human: "B", ai: "C" }), "ucu_farkli");
eq("Yanlis + üçü farklı + contextBad", classify({ verdict: "Yanlis", verified: "A", human: "B", ai: "C", contextBad: true }), "baglam_hatasi");
eq("Belirsiz", classify({ verdict: "Belirsiz", verified: null, human: "A", ai: "A" }), "belirsiz");
eq("verdict null", classify({ verdict: null, verified: null, human: "A", ai: "B" }), "belirsiz");

// ── Öncelik: ai DOĞRU iken contextBad yok sayılır (bağlam ancak AI yanlışken) ──
eq("Dogru + ai==verified + contextBad → yine dogru_herkes", classify({ verdict: "Dogru", verified: "A", human: "A", ai: "A", contextBad: true }), "dogru_herkes");
eq("Yanlis + ai==verified + contextBad → yine düzeltir", classify({ verdict: "Yanlis", verified: "A", human: "B", ai: "A", contextBad: true }), "ai_insani_duzeltirdi");

// ── Türkçe normalize: case-insensitive + trim eşleşmeli ──
eq("Türkçe case: 'Yetki / Rol' == 'yetki / rol'", classify({ verdict: "Dogru", verified: "Yetki / Rol", human: "Yetki / Rol", ai: "yetki / rol" }), "dogru_herkes");
eq("trim: 'A ' == 'A'", classify({ verdict: "Dogru", verified: "A", human: "A", ai: "A " }), "dogru_herkes");
const normOk = norm("  İŞ Süreci ") === norm("iş süreci") && norm(null) === "";
normOk ? (pass++, console.log("✓ norm() Türkçe lowercase + trim + null-safe")) : (fail++, console.log("✗ norm() yanlış"));

// ── Gerçekçi senaryo: AI insanın yanlış 'Parametre' etiketine katılıyor ──
eq("gerçek: human=Parametre(yanlış), verified=Hesaplama, ai=Parametre",
  classify({ verdict: "Yanlis", verified: "Hesaplama / İş Kuralı", human: "Parametre / Konfigürasyon", ai: "Parametre / Konfigürasyon" }), "ortak_hata");

console.log(`\n── Summary ─────────────────────────────────────────────`);
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
