# P1.2 — Clarifying-Soru Akışı (kapanış)

AI, kapanışı **emin olarak çıkaramadığında** yanlış/boş etiket basmak yerine
operatöre **3 net soru** sorar; operatör cevaplayınca zenginleşmiş girdiyle tekrar
çıkarım yapar. ("Düşük güvende çözüm önermek yerine soru sor" — roadmap'te yok,
özgün katkı.)

## Backend (bu PR — `suggestClose`)
**Çıktıya eklenenler:**
- `needsClarification: boolean` — AI emin değil mi?
- `clarifyingQuestions: string[]` — emin değilse sorulacak 3 soru (kapanışın 4 alanını elicit eder).

**Girdiye eklenen:**
- `clarifyingAnswers?: string` — operatörün cevabı. Verilirse prompt'a eklenir →
  daha iyi etiket; ve **tekrar soru sorulmaz**.

**Tetikleyici** (`needsClarification = true`):
- `kok_neden_grubu` veya `kok_neden_detayi` **null** (AI değer seçemedi), VEYA
- `confidence < CLOSE_CLARIFY_THRESHOLD` (env, default **0.8**).
- Operatör zaten cevap verdiyse (clarifyingAnswers) → tetiklenmez.

> Not (P0.3 bağlamı): ham confidence over-confident/kötü kalibre → **asıl tetik
> sinyali null-alanlar** (gerçek belirsizlik). Eşik ikincil; recalibration (P1.1)
> sonrası iyileşir.

**Geri uyumlu:** eklenen alanlar additive; mevcut çağıranlar etkilenmez (etiketler aynı).
`clarifyingAnswers` opsiyonel.

## Doğrulanmış davranış (demo)
- Güvenli/net vaka → soru SORMAZ (golden set 0/18 — doğru, operatörü meşgul etme).
- Zayıf girdi ("sistem hata veriyor"/"baktık düzeldi") → grup=null, conf=0.1 →
  **3 soru.** Cevap ("parametre eksikti…") → grup=Parametre, tip=Parametre düzeltme,
  önlem=Kontrol/validasyon, needsClarification=false. ✓

## UI entegrasyonu (sıradaki — frontend)
Smart Ticket kapanış akışında:
1. `suggestClose` çağır. `needsClarification` ise → etiket formu yerine **3 soruyu** göster.
2. Operatör cevaplar → `suggestClose`'u `clarifyingAnswers` ile **tekrar** çağır.
3. Dönen etiketleri pre-fill et (artık needsClarification=false).

## Maliyet
İhmal edilebilir: koşullu (~%15-25 belirsiz vaka), Haiku + cache, vaka başına +1 çağrı
(cevap sonrası tekrar). ~$0.20/gün mertebesinde; yanlış-etiket→düzeltme döngüsünü
azalttığı için net ~nötr.

## Ayar
`CLOSE_CLARIFY_THRESHOLD` (env, default 0.8). Sorular: `CLOSE_CLARIFY_QUESTIONS`
(categorizer-v2.ts) — kapanışa göre düzenlenebilir.
