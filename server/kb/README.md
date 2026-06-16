# Gömülü KB (Bilgi Bankası) — Varuna CSM

Bu klasör, Varuna'nın içine gömülü KB/RAG motorunun **hem kaynağını hem derlenmiş
halini** barındırır. KB ayrı bir servis/process **değildir**; Varuna sürecinin
içinde (in-process, port 3101) çalışır. `ExternalKbSetting.baseUrl = http://127.0.0.1:3101`
yani "external KB" aslında Varuna'nın kendisidir (loopback).

## Yapı

- **`src/lib/**`** — KB'nin framework-bağımsız TypeScript **kaynağı** (kategorizasyon,
  kapanış önerisi, RAG retrieve/ask, embedder, taksonomi). **Canonical kaynak budur.**
- **`kb-bundle-entry.ts`** — esbuild bundle giriş noktası; `kbV1` router'ın ihtiyaç
  duyduğu fonksiyonları export eder (`categorizeV2`, `suggestClose`, `ask`, `retrieve`, …).
- **`kbCore.js`** — **OTOMATİK ÜRETİLEN** tek dosyalık ESM bundle. **ELLE DÜZENLEMEYİN.**
  `server/routes/kbV1.js` bunu import eder; `/api/v1/*` endpoint'leri buradan beslenir.

## Kaynağı değiştirip yeniden üretme

1. `server/kb/src/lib/**` içinde değişiklik yapın.
2. `node scripts/build-kb-core.mjs` → `kbCore.js` yeniden üretilir (esbuild, npm paketleri external).
3. `node --env-file=.env scripts/smoke-smart-ticket-closure-suggest.js` ile doğrulayın.

## Tarihçe / notlar

- Kaynak eskiden ayrı **`ticket-analiz`** reposunda (`onurege/ticket-analiz`) tutuluyor,
  build oradan okuyordu. Tek-repo / sağlıklı geliştirme için kaynak **buraya taşındı**;
  ticket-analiz artık KB için kullanılmaz.
- Runtime taksonomi datası repo kökündeki `data/cc-taxonomy-v2.json` (+ `cc-taxonomy-hints.json`)
  dosyalarından `process.cwd()` üzerinden okunur — bundle'a gömülmez.
- npm bağımlılıkları `kbCore.js`'e gömülmez (`packages: 'external'`); Varuna'nın
  `node_modules`'undan çözülür.
