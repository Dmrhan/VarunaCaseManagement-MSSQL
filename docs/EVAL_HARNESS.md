# Smart Ticket Etiketleme — Eval Harness (Referans Test Seti) · Faz 0

[AI Kapanış/RCA Yol Haritası](AI_CLOSURE_RCA_ROADMAP.md) **Faz 0**'ın somut çıktısı:
AI etiketleme doğruluğunu **ölçen** referans test seti + harness. Her prompt /
model / maliyet değişikliğinden sonra koşulur → "puan yükseldi mi, kaliteyi bozdum
mu?" sorusunu **kanıtla** cevaplar (regresyon kalkanı). Bugünkü baseline: **açılış
~%81, kapanış ~%65** (insan-doğrulanmış 100 vaka).

## ⚠️ Veri gizliliği (PII)
Golden set **gerçek müşteri verisi** içerir (firma/kişi adları, ticket metni).
Çıktı `data/eval/golden-set-v1.json` → kök `.gitignore`'daki `data/*` ile **otomatik
dışlanır**, repoya commit'lenmez. Her geliştirici kendi checkout'unda lokal üretir.
Repoda yalnız: scriptler + bu doküman.

## Akış
```bash
# 1) Golden set'i lokalde üret (Excel'den; çıktı data/eval/ → gitignore'lu)
node scripts/build-golden-set.mjs "/path/Başlıksız e-tablo (1).xlsx"

# 2) Mevcut baseline (API YOK — gömülü insan verdict'inden)
node scripts/eval-smart-ticket.mjs --baseline

# 3) Canlı eval (AI'yı çalıştır, truth ile karşılaştır) — ANTHROPIC_API_KEY gerekir
export ANTHROPIC_API_KEY=...
node scripts/eval-smart-ticket.mjs --limit 5    # önce smoke (~sent)
node scripts/eval-smart-ticket.mjs              # tam koşu (~97 vaka, <$1; Haiku+cache)
```

## Ground-truth mantığı (önemli)
Excel'deki etiketler AI **tahminleri**; `AÇILIŞ/KAPANIŞ DOĞRULUK` insanın doğru/yanlış
kararı.
- **Doğru (True)** satır → tahmin = yer-gerçeği (`confirmed`). Harness bunları skorlar.
- **Yanlış (False)** satır → doğru etiket **henüz yok** (`pending`). `duzeltmeNotu*`
  notuna göre insan doğru etiketi doldurup `confirmed` yapar. Kapsam büyüdükçe
  **hard-case** doğruluğu da ölçülür (asıl iyileştirme orada görünür).

Bu 100 vakada: açılış **18**, kapanış **34** satır insan-tamamlama bekliyor.

## Metrikler
- **Alan top-1:** her alanın (açılış 5, kapanış 4) ayrı doğruluğu.
- **Tam-vaka:** bir vakanın tüm alanları doğru mu (daha sıkı).
- **Sapma listesi:** `tahmin ≠ doğru` örnekleri → hata analizi (komşu-kategori karışması vb.).

## Golden set şeması (`data/eval/golden-set-v1.json` — bir satır)
```jsonc
{
  "vakaNo": "VK-...", "musteri": "...", "gun": "22.06.2026",
  "aciklama": "...",            // categorizeV2 + suggestClose girdisi
  "cozumAciklamasi": "...",     // suggestClose girdisi (resolution)
  "truth": {
    "acilis":  { "platform","isSureci","islemTipi","etkilenenNesne","etki" },
    "kapanis": { "kokNedenGrubu","kokNedenDetayi","cozumTipi","kaliciOnlem" }
  },
  "acilisConfirmed": true, "kapanisConfirmed": false,   // skorlanır mı
  "duzeltmeNotuKapanis": "DONANIM, sunucu değil"         // pending'i doldurma ipucu
}
```

## Sonraki adım
Baseline kilitlendi → **Faz 1: kapanışa retrieval** (benzer çözülmüş vakaları
`suggestClose`'a few-shot ver). Her değişiklikten sonra `eval-smart-ticket.mjs` koş;
kapanış puanı %65'ten yukarı gidiyor mu izle.
