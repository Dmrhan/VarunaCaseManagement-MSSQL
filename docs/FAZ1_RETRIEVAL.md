# Faz 1 — Kapanışa Retrieval (ölçüldü: naive retrieval YARAMADI)

Hedef: `suggestClose`'a benzer çözülmüş vakaları few-shot vererek kapanış
doğruluğunu artırmak. **ÖLÇTÜK — naive haliyle KÖTÜLEŞTİRDİ. Prod'a bağlanmadı.**

## Mimari (güvenli, inert)
`suggestClose` artık `closeExamples?: string` alır — **corpus-agnostik**: retrieval'ı
ÇAĞIRAN (route/eval) yapıp biçimlenmiş few-shot'u geçer. Few-shot değişken bölüme
(TICKET BAĞLAMI sonrası) eklenir → **prompt caching bozulmaz.**
- **Prod'da hiçbir çağıran `closeExamples` beslemiyor → INERT, sıfır risk** (eski davranış).
- `embed`/`embedBatch` bundle'dan export edildi (validation için).

## ÖLÇÜM — naive retrieval (446 Varuna corpus, 18 golden vaka)
```
Retrieval KAPALI: %83 (60/72)   ← baseline
Retrieval AÇIK  : %50 (36/72)   ← top-3 benzer vaka, etiketleriyle few-shot
→ −33 PUAN. KÖTÜLEŞTİRDİ.
```
**Neden:** model, çekilen "benzer" vakaların etiketlerine **demir atıyor (anchoring)**.
Açıklama-benzerliği ≠ kök-neden-benzerliği → yüzeysel benzer ama farklı kök nedenli
vakaları kopyalıyor. Bu, roadmap'in "naive sert retrieval felaket (DBpedia 0.95→0.45)"
öngörüsünün **birebir doğrulanması.**

## Çalıştırma (validation harness — varyant ölçmek için)
```bash
node --env-file=.env scripts/validate-faz1-retrieval.mjs
# 474 çözülmüş vakayı embed eder, golden set'e karşı retrieval AÇIK/KAPALI ölçer.
```

## Sıradaki — denenecek varyantlar (eval-gated, corpus zaten embed'li)
1. **Rerank + eşik:** sadece çok yüksek benzerlikteki örnekleri ver; alakasızı ele
   (roadmap'in "retrieve-then-rerank"i). Naive'i kurtaracaksa bu.
2. **Etiketsiz sunum:** benzer sorunları göster, etiketlerini "cevap" gibi verme → anchoring ↓.
3. **Top-1 + güven eşiği:** tek, en yakın + yüksek güven varsa.

**KURAL:** her varyant validation harness'ında ölçülmeden prod'a bağlanmaz.
Naive felaketini eval yakaladı; bu disiplin korunacak.

## Sürekli embedding (varyant işe yararsa, sunucu önkoşulu)
Corpus = Varuna `Case` (status="Cozuldu", `customFields.smartTicket.closure` etiketli,
474 vaka). Bir varyant kazanırsa: bu vakaları + yeni çözülen/düzeltilenleri **cron'la
sürekli embed** et → retrieval tazelenir, döngü kapanır.
