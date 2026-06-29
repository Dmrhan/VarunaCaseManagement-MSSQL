# Kapanış Hata Attribution

**Amaç:** "%61 kapanış doğruluğu" tek parça bir sayı olmaktan çıksın. Hatanın
NEREYE gittiğini (model mi, taksonomi belirsizliği mi, insan mı, bağlam mı)
ayırır — çünkü her dilimin **farklı sahibi ve farklı çözümü** var.

## Üçlü karşılaştırma

| Sinyal | Kaynak | Anlamı |
|---|---|---|
| **ai** | `closureSuggestion.aiSuggested` (canlı) ya da `kbCore.suggestClose` rerun | AI ne önerdi |
| **human** | `CaseTaggingReview.*OriginalLabel` (telemetry varsa `humanApplied`) | Kapanışta ne uygulandı |
| **verified** | `CaseTaggingReview` verdict (Dogru→Original, Yanlis→Corrected) | Gün-sonu doğrulanmış gerçek |

> **Mode A (bugün):** telemetry henüz canlı veride yok → AI yerel `kbCore` ile
> **yeniden koşulur** (doğru bağlam beslenir = "temiz-bağlam" doğruluğu).
> **Mode B (telemetry biriktikçe):** persisted `aiSuggested.resolutionSeen` +
> `humanApplied.changedFromAi` okunur → **bağlam hatası** ve **gerçek insan
> override** sayıları da netleşir.

## Kovalar (alan başına, çakışmasız)

| Kova | Koşul | Ne demek / Aksiyon |
|---|---|---|
| `dogru_herkes` | Dogru + ai==verified | Temiz başarı |
| `ai_insani_duzeltirdi` | Yanlis + ai==verified | İnsan kapanışta yanıldı ama **AI doğruyu önerirdi** → AI'nın değeri; clarifying/pre-fill bunu yakalar |
| `model_hatasi_temiz` | Dogru + ai!=verified | **Gerçek model hatası** — insan doğru yaptı, AI temiz bağlamda yanıldı. Aksiyon: taksonomi netleştirme / clarifying / model |
| `ortak_hata` | Yanlis + ai==human | AI insanın **yanlış** etiketine katıldı (güvenlik ağı yok). Aksiyon: model + süreç |
| `ucu_farkli` | Yanlis + ai≠human≠verified | Çok zor/öznel vaka |
| `baglam_hatasi` | (Mode B) resolutionSeen step-compose/boş + AI yanlış | AI yanlış metin gördü. Aksiyon: pipeline (resolutionOverride fix) |
| `belirsiz` | verdict Belirsiz/null | Taksonomi/öznel belirsizlik — **denominatör DIŞI** (hata sayılmaz) |

**AI doğruluğu** = (`dogru_herkes` + `ai_insani_duzeltirdi`) / doğrulanmış alan
**Hata bütçesi** = `model_hatasi_temiz` + `ortak_hata` + `ucu_farkli` (+ `baglam_hatasi`)

## Çalıştırma

```bash
# Tam (145 vaka); AI tahminleri data/eval/ai-predictions-cache.json'a cache'lenir
node --env-file=.env scripts/attribution-closure.mjs
LIMIT=20 node --env-file=.env scripts/attribution-closure.mjs   # hızlı deneme

# Mantık testi (DB/KB gerektirmez)
node scripts/smoke-attribution-logic.mjs
```

## Nasıl okunur (örnek yorum)

- `belirsiz` yüksekse → ölçüm haksız; **adil doğruluk %61'den yüksek**. Aksiyon:
  kabul-eşdeğerlik setleri (metrik düzeltme), model değil.
- `model_hatasi_temiz` baskınsa → asıl çekirdek burada; **taksonomi/clarifying**
  yatırımı buraya.
- `ai_insani_duzeltirdi` yüksekse → AI **insan kapanış hatalarını önleyebilir**;
  GM mesajı: "AI etiketi %X insan hatasını yakalardı."
- Alan bazında en kötü alan (genelde **Kök Neden Detayı**, 57-yönlü bağımsız) →
  oraya odaklan.

> Not: bu telemetry/rapor **prompt'a beslenmez** (anchoring bulgusu). Yalnız
> hata-tipi ayrımı + yatırım yönü içindir.
