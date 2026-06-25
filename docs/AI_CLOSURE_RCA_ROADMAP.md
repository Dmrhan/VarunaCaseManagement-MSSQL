# AI Kapanış / Kök-Neden (RCA) Sınıflandırması — Yol Haritası

**Durum:** Faz 0 başlamadı (planlama tamamlandı).
**Sahip:** Varuna AI hattı (RUNA AI / gömülü KB).
**Temel:** Adversarial-doğrulanmış derin araştırma (25 iddia → 12 onay, 13 çürütüldü) + kod-tabanı boşluk analizi.

> Bu doküman **canlı plan**dır. Fazlar ilerledikçe checkbox'lar işaretlenir, "Durum" güncellenir.

---

## 0. Problem

- **Açılış** taksonomi sınıflandırması ~**%90** doğru; **kapanış** (kök-neden grubu/detayı, çözüm tipi, kalıcı önlem) ~**%50**.
- Kapanış/RCA, açılış triage'dan **yapısal olarak daha zor** (çözüm metninden *neden* çıkarımı, açıklamayı yapısal kategoriye eşlemekten zor).
- **Kısıtlar:** Cloud LLM serbest (veri yerleşimi katı kısıt değil). Dil: **Türkçe**. Geçmiş etiketli veri **kısmi / tutarsız**.

## 1. Kilitli kararlar (kanıta dayalı)

| Karar | Gerekçe (kanıt) |
|---|---|
| **Decouple KALIR** (grup→detay kısıtı geri gelmez) | "Detayı gruba kısıtla en iyisidir" iddiası **çürütüldü (0-3)**. Single-path hiyerarşi ≈ flat (ComFaSyn 0.98 vs 0.97; DBpedia 0.97 vs 0.96 — IEEE BigData 2024). UI serbest kalır; düzeltme *decode stratejisi*nde. |
| **Sert budama YOK** | Naif iki-aşamalı sert budama felaket: DBpedia F1 0.95→0.45. AI önerisi tek-geçiş path decode **veya** detayı gruba göre *yumuşak* yeniden sıralama. |
| **En yüksek kaldıraç = çözülmüş-vaka retrieval'ını kapanışa bağla** | Açılış retrieval+enforcement kullanıyor, kapanış kullanmıyor (kod bulgusu). IBM: reranker R@3 %30→%43 (arXiv 2409.13707). |
| **Önce ÖLÇ (eval-first)** | Bugün eval YOK → "%50" doğrulanamıyor/atfedilemiyor. Türkçe golden eval set şart (diller-arası fark ~%40, arXiv 2502.11830). |
| **Confidence-gating** | Zendesk her alana confidence iliştirip düşük-güveni insana yönlendiriyor. Sizde confidence üretiliyor ama **kullanılmıyor**. |
| **Model seçimi A/B ile** | "Fine-tuned > few-shot+RAG LLM" **kanıtlanamıyor** (araştırma yalnız zero-shot test etti). Hibrit en güvenli; karar Türkçe golden set'te A/B. Veri hijyeni önce. |
| **Agentic/ReAct'e aşırı yatırım yok** | ReAct'in RCA güvenilirliğinde RAG'ı yendiği iddiası **çürütüldü**. |

## 2. Mevcut durum — boşluk haritası

`server/kb/src/lib/cc/categorizer-v2.ts`: `categorizeV2` (açılış) vs `suggestClose` (kapanış).

| Best-practice | Açılış | Kapanış | Faz |
|---|---|---|---|
| Gold few-shot | ✓ | ✓ | — |
| Structured/JSON çıktı | ✓ | ✓ | — |
| **Çözülmüş-vaka retrieval (RAG)** | ✓ `similar_examples` | **✗** | **1** |
| **Retrieve-then-rerank** | kısmi | **✗** | 1 |
| Deterministik enforcement | ✓ `enforcePlatformFromHints` | **✗** | 2 |
| **Confidence-gating / abstention** | ✗ | **✗** | 2 |
| Budamasız hiyerarşik decode | flat tek-shot | flat tek-shot (~60+ aday) | 2 |
| **Golden eval set (Türkçe)** | ✗ | **✗** | **0** |
| **Veri hijyeni** | ? | kısmi/tutarsız | 0/3 |
| **Feedback loop (accept/reject)** | ✗ | **✗** | 0/4 |

## 3. Fazlar ve adımlar

### Faz 0 — ÖLÇ (önkoşul, ~3-5 gün)
- [ ] **Türkçe golden eval set:** ~150-300 uzman-doğrulanmış kapanmış vaka; çok-annotator + "kabul edilebilir etiketler" seti; inter-annotator agreement (IAA) ölç. Kaynak: `Case.customFields.smartTicketClosure`.
- [ ] **Closure accept/reject telemetri:** mevcut `AIUsageLog` + `markUsageAccepted` pattern'ini kapanış önerisine bağla (feedback loop temeli).
- [ ] **Eval harness:** `scripts/` altında smoke — golden set'e karşı top-1 / top-3 accuracy + per-alan F1 + confidence kalibrasyon eğrisi.

### Faz 1 — EN YÜKSEK KALDIRAÇ: kapanışa retrieval (~1 hafta)
- [ ] `suggestClose`'a `data/embeddings.sqlite` (`cc_*`) üzerinden **benzer ÇÖZÜLMÜŞ vakaları** (doğrulanmış kapanış etiketleriyle) top-k çek → prompt'a **dinamik few-shot**.
- [ ] `cc/rag-client.ts`'i kapanışa genişlet (şu an yalnız açılışta).
- [ ] **Reranker** ekle (retrieve-then-rerank). Faz 0 eval'iyle önce/sonra ölç.

### Faz 2 — confidence-gating + decode fix (~1 hafta)
- [ ] **Gate:** yüksek confidence → öneriyi otomatik uygula; düşük → "insan onayı" rozeti (abstention). UI serbest.
- [ ] **Grup→detay:** tek-geçiş path decode **veya** detay adaylarını gruba göre yumuşak ağırlıklandırma (sert budama YOK).

### Faz 3 — veri hijyeni + model A/B (~1-2 hafta)
- [ ] Etiket gürültüsü temizliği (cleanlab tarzı) + taksonomi hijyeni.
- [ ] Golden set'te **A/B:** few-shot+RAG LLM (mevcut) vs **SetFit / e5+classifier-head** → veriyle karar.

### Faz 4 — feedback-driven sürekli iyileştirme
- [ ] Accept/reject telemetri → active learning → periyodik golden set + few-shot havuzu güncelleme.

## 4. Adaylar — modeller / teknikler (hatırlanacaklar)

- **Retrieval:** mevcut lokal `multilingual-e5-large` embedding + `data/embeddings.sqlite`; **+ fine-tuned bi-encoder reranker** (IBM Slate deseni).
- **Sınıflandırıcı adayları (A/B için):** (a) few-shot+RAG LLM (mevcut, tiered Gemini wrapper); (b) **SetFit** (prompt-free few-shot Sentence-Transformer fine-tuning); (c) **e5 + classifier head**; (d) **hibrit (RAG + classifier)** — en güvenli.
- **Decode:** single-pass hierarchical (HDC tarzı seviye-seviye) veya soft group-conditioned rerank.
- **Veri kalitesi:** cleanlab (label noise tespiti), "acceptable labels" çoklu-ground-truth.
- **Değerlendirme:** top-1/top-3, per-alan F1, confidence kalibrasyonu, abstention/insan-onay oranı, canlı A/B.

## 5. Açık sorular (deneyle kapatılacak)

- %50'nin ne kadarı (i) etiket-gürültüsü, (ii) kapanışta retrieval yokluğu, (iii) decouple-genişlemesi? → **hata ablasyonu** (Faz 0 sonrası her müdahaleyi tek tek aç).
- few-shot+RAG LLM mi fine-tuned encoder mi? → Türkçe golden set'te head-to-head A/B (en yüksek öncelikli deney).
- single-path decode mı soft group-conditioned rerank mı? → Türkçe kapanışta doğrudan karşılaştırma yok.
- Türkçe confidence kalibrasyon eğrisi / abstention eşiği? → canlı A/B.

## 6. Kaynaklar

- IBM RAG/IT-support (retrieval+rerank, veri hijyeni): arXiv 2409.13707
- Hiyerarşik sınıflandırma (single-path ≈ flat; sert-budama çöküşü): IEEE BigData 2024 — payberah.github.io/files/download/papers/llm_classification.pdf
- HDC (budamasız seviye-seviye decode): arXiv 2507.12930
- LLM vs custom classifier (multilingual, few-shot ROI): arXiv 2502.11830
- SetFit: arXiv 2209.11055
- Zendesk confidence/triage: destek dokümanları

> Çürütülenler (kullanma): "detayı gruba kısıtla en iyisi", "structured decoding zorunlu", "ReAct RCA'da RAG'ı yener", "retriever %60 darboğaz", "RCA-KB madenciliği RCA'yı ölçülebilir hızlandırır".

## 7. Veri tedariki — Next4biz tarihsel corpus (Faz 0/1 yakıtı)

Yılların n4b ticket verisi var ama **etiketsiz/kategorisiz** (DB erişimi mevcut, ~100-300 ile başlanacak).

- **Mevcut altyapı:** `kb/sources/mssql.ts` (çözümlenmiş ticket'lar) + `kb/sources/n4b-cozumler.ts` (operatör çözüm notları, **`txt_kok_neden` dahil**) → lokal sqlite snapshot → embed. **Ayrı store; operasyonel MSSQL'e dokunmaz**; PII redaction + idempotent (text_hash) + batch. n4b bağlantısı `TICKET_MSSQL_*` env. Snapshot-doldurma script'leri (`sync-and-embed`, `sync-n4b-cozumler.mjs`) **doğrulanmalı/ölçeklenmeli** (scripts/ altında görünmüyor).
- **Etiketleme = few-shot bootstrap:** ~100-300 uzman-etiketli **gold seed** → few-shot (LLM veya SetFit) + RAG (en yakın seed) ile corpus'un geri kalanını etiketle; **confidence-gated** (yüksek→oto, düşük→insan/active-learning); held-out ile accuracy ölç.
- **Avantaj:** n4b `txt_kok_neden` = zayıf-etiket sinyali; Varuna taksonomisi hazır → etiketleme = **eşleme** (yeni taksonomi icat etmek değil).
- **KURAL:** ham ticket'lar operasyonel `Case` tablosuna **YÜKLENMEZ** — ayrı corpus'ta kalır.
- **İlk adım:** kalibrasyon batch'i (10-30 ticket + taksonomi + 5-10 gold örnek) → AI etiketler (gerekçe + confidence) → insan doğrular → accuracy → "otomatik mi insan-onaylı mı" kararı.
