# Agentic Planning Card — G5 Favicon + Brand Polish (lightweight)

- **Work Register ID:** G5
- **Product Planning Matrix ID:** PM-18 (UI Polish / Bundle / Marka)
- **Product capability:** Tarayıcı sekmesi marka tanınırlığı
- **Request source:** WR Backlog quick-win
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-19
- **Protocol versiyonu:** 2.0 (lightweight scope — under 1 saat, < 10 satır kod)

---

## ① Product Fit
- **Problem:** Vite default favicon hâlâ aktif; tarayıcı tab'ında Varuna logosu yok. `<meta description>` ve `theme-color` da yok.
- **Business fit:** PARAM/UNIVERA/FINROTA — marka algısı + demo izlenimi. Müşteri tanıklığında ilk gördükleri yer browser tab'ı.
- **Affected roles:** Tüm kullanıcılar (görüntü).
- **Acceptance criteria:**
  1. Tarayıcı sekmesinde Varuna logosu görünür (PNG favicon).
  2. `<meta name="description">` Türkçe ve anlamlı.
  3. `theme-color` light + dark için tanımlı (Brand 500 = `#3b62f5`, dark = `#0D1117`).
  4. `vite build` clean.
- **Out-of-scope:** Logo yeniden tasarımı, SVG conversion, ICO generation, Apple Touch Icon optimizasyonları, PWA manifest, ek favicon variant'ları (16×16, 32×32 ayrı dosya).
- **Decisions:** Yok.

## ② Architecture Fit
- Schema/API/migration etkisi: **yok**.
- Dokunulan: `index.html` head section (markup only).
- Mevcut asset `public/varuna-logo.png` (1024×1024 PNG, 661KB) referans olarak kullanılır — yeni asset eklenmiyor.
- Backward compat: tam additive; eski path'ler bozulmaz.
- Modeling guardrails: hiçbiri ihlal edilmiyor (FE-only metadata).

## ③ Performance & Architecture Gate
- **Query/index:** Yok.
- **Cache:** Tarayıcı favicon'u zaten cache'liyor; ek strateji gerekmiyor. 661KB PNG ilk yükte cost'lu görünebilir ama tab başına bir kez fetch + uzun cache. Acceptable (alt seçenek: SVG conversion — out of scope).
- **Large query guard:** Yok.
- **Frontend perf:** Favicon async; render bloklamaz. Ek bundle yükü yok (asset public/ üzerinden serve edilir).
- **Concurrency:** Yok.
- **Observability:** Yok.
- **Verdict:** **Pass** — markup-only, single static asset reference. Mitigation gerekmiyor.

## ④ Code Fit
- **File impact:** `index.html` (5-8 satır eklenir). `public/varuna-logo.png` mevcut.
- **Reuse:** Tailwind brand-500 değeri (`#3b62f5`) ve ndark-bg (`#0D1117`) referans alınır.
- **No-touch:** Mevcut script/css link'leri, dark-mode preflight, `<div id="root">`.
- **Risk:** Yok (sadece head markup).
- **Test files:** Yok (manuel vite build doğrulaması).

## ⑤ QA Fit
- **Automated:** `npm run build` → temiz exit + dist/index.html'de favicon link görünür.
- **Manual:** Chrome/Safari/Firefox dev mode'da tab'da Varuna logosu, light/dark sistem temasında theme-color uygulanıyor (Mac Safari + iOS).
- **Seed/data:** Etkilenmez.
- **Rollback:** Revert tek dosya.
- **Production smoke:** Gereksiz.

## ⑥ Decisions — Yok

## ⑦ Ready / Not Ready — Ready

## ⑧ Implementation Prompt
1. `index.html` head section:
   - Title bırakılır (mevcut "Varuna Case Management" zaten doğru).
   - Yeni `<meta name="description">` — Türkçe, 1 cümle.
   - Yeni `<link rel="icon" type="image/png" sizes="any" href="/varuna-logo.png">`.
   - Yeni `<link rel="apple-touch-icon" href="/varuna-logo.png">` (iOS Safari için trivial).
   - Yeni iki `<meta name="theme-color">` (light + dark media query).
2. Validation: `npm run build`; dist/index.html'i grep'le.
3. Branch `feat/favicon-brand-polish` → `dev` PR; release `dev → main` ayrı.

## ⑨ Test Plan
Build + manuel tab inspection.

## ⑩ Rollback
`git revert <merge-sha>` — markup-only.

## ⑪ Register Updates
- [ ] Merge sonrası WR G5: Ready → Shipped + commit hash.

## ⑫ Git Flow / Topology Metadata
- **Current branch:** `feat/favicon-brand-polish`
- **PR base:** `dev`
- **PR head:** `feat/favicon-brand-polish`
- **Branch deletion after merge:** Yes (local + remote)
- **Topology check (pre-PR):** `origin/main..origin/dev` empty ✓ · `origin/dev..origin/main` empty ✓
