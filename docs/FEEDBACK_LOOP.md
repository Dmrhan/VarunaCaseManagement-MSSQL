# Kapalı Geri-Besleme Döngüsü — Etiket Doğrulama → AI

Amaç: **manuel adım (Excel) olmadan**, ekip UI'da yanlış/doğru seçtikçe sistem
kendini beslesin. İki besleme var:

```
  Ajan/uzman                CaseTaggingReview            sync                 harness
  UI'da Doğru/Yanlış  ───►   (per-field: Original/   ───►  golden-set.json ───►  AI doğruluğu
  + doğru etiket seçer        Verdict/Corrected)            (canlı truth)         ÖLÇÜLÜR
                                   │
                                   └──► (Aşama 2) düzeltilen vakalar ──► AI gold few-shot ──► AI İYİLEŞİR
                                                                          (eval-gated!)
```

## Aşama 1 — Ölçüm beslemesi  ✅ (bu PR)
`CaseTaggingReview` (canlı UI verisi) → harness'ın okuduğu per-field golden set.
**Excel/`build-golden-set.mjs` artık gerekmez** — truth canlıdan gelir.

```bash
# SUNUCUDA (DB erişimi) — cron'a koy:
node --env-file=.env scripts/sync-tagging-feedback.mjs     # → data/eval/golden-set.json
node scripts/eval-smart-ticket.mjs                         # AI'yı ölç (ANTHROPIC_API_KEY)
```
- **Ground truth (per-field):** `Verdict=Dogru`→OriginalLabel · `Verdict=Yanlis`→CorrectedLabel · `Belirsiz`→skorlama dışı.
- Harness `golden-set.json` varsa onu (per-field), yoksa `golden-set-v1.json`'u (Excel bootstrap) okur — geri uyumlu.
- **Düzeltmeler biriktikçe zor vakalar da otomatik skorlanır** — Faz 0'daki "wrong-case truth yok" darboğazı kalkar.

## Aşama 2 — AI beslemesi  ⏳ (sonraki, eval-gated)
İnsanın düzelttiği vakalar (`Verdict=Yanlis` + CorrectedLabel) = en değerli öğrenme
sinyali. Bunlar **gold few-shot havuzuna** (`data/cc-gold-examples.json`) eklenince
AI gelecekte aynı tip vakada doğruyu görür → kapanış doğruluğu artar.

**KURAL (Faz 2'de öğrenilen disiplin):** gold havuzu değişikliği AI davranışını
değiştirir → **önce Aşama 1 eval'i kurulmadan eklenmez.** Eklenir → harness önce/sonra
ölçer → puan arttıysa tutulur, artmadıysa atılır. Körlemesine besleme YOK.

## Notlar / TEAM doğrulaması
- **Çözüm metni kaynağı:** `sync-tagging-feedback.mjs` `resolutionNote`'u birincil alır;
  kapalı vakada çözüm metninin gerçek kaynağını (resolutionNote / customFields /
  CaseSolutionStep) sunucuda teyit edin.
- **Code vs Label:** truth Label olarak tutulur (AI çıktısı da Label). Taksonomi
  yeniden adlandırılırsa `CorrectedLabel` güncel TaxonomyDef'ten resolve edilir; eski
  `OriginalLabel` snapshot'ları drift edebilir → gerekirse Code bazlı karşılaştırmaya geç.
- `data/eval/*.json` gitignore'lu (PII — müşteri verisi commit'lenmez).

## Gerçek-zamanlı alternatif (opsiyonel, ileride)
`updateTaggingReview` kaydederken golden-set'i tetikleyen bir hook → batch yerine
anlık. Backend + on-prem deploy gerektirir; şimdilik zamanlanmış sync yeterli.
