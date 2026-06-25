# Faz 1 — Kapanışa Retrieval (dynamic few-shot)

En yüksek kaldıraç: `suggestClose`'a, geçmiş **benzer çözülmüş vakaları** (kök
nedenleriyle) getirip dinamik few-shot olarak ver. Ölçtüğümüz ince-taneli
kök-neden ıskalarını (örn. "XSLT şablon eksik" vs "Belge dizaynı eksik") prompt
çözemiyor (kanıtlandı); **retrieval çözer** — benzer vaka örneğiyle.

## Durum
- ✅ **Kod hazır** (`suggestClose`): mevcut `searchSimilarByText` (e5 + sqlite-vec)
  ile top-3 benzer çözülmüş vaka → `getTicket` ile kök-neden/çözüm → few-shot.
- 🚩 **Feature-flag arkasında, default KAPALI** (`CLOSE_RETRIEVAL=1`). Flag kapalıyken
  davranış **birebir aynı** (regresyon yok — doğrulandı). Graceful: embeddings yok/hata
  → sessizce retrieval'sız devam.
- Few-shot **değişken bölüme** (TICKET BAĞLAMI sonrası) eklenir → **prompt caching bozulmaz.**

## Açmak için (SUNUCUDA, eval-gated)
```bash
# 1) Embeddings dolu olmalı (sürekli — aşağı bak)
# 2) Flag aç + ölç (golden set CaseTaggingReview'dan):
CLOSE_RETRIEVAL=1 node --env-file=.env scripts/eval-smart-ticket.mjs
# 3) Kapanış puanı flag KAPALI'ya göre ARTTIYSA prod'a CLOSE_RETRIEVAL=1 ver. Artmadıysa kapalı bırak.
```
**Disiplin:** önce/sonra ölçmeden açma. Harness önce/sonra farkını gösterir.

## Sürekli otomatik embedding (önkoşul — sunucu)
Retrieval ancak corpus tazeyse işe yarar. **Sunucuda sürekli embedding** gerekir:
- Çözülen her vaka + **düzeltilen her vaka (CaseTaggingReview)** embed corpus'una girmeli
  (`ticketsNeedingEmbedding` → `embed` → `upsertEmbeddings` mevcut).
- **Cron/zamanlanmış** koş (örn. 15 dk'da bir) → yeni çözümler + düzeltmeler otomatik embed.
- Böylece döngü kapanır: **düzeltme → embed → retrieval → AI bir dahaki sefere doğru.**
  (Düzeltilen vakaları corpus'a beslemek = retrieval'ın feedback'ten öğrenmesi.)

## Sıradaki (eval-gated, sample ~50+ olunca)
- Reranker ekle (retrieve-then-rerank — IBM deseni: R@3 ↑).
- Düzeltilen vakaları embed corpus'una öncelikli besle (yüksek-kalite sinyal).
