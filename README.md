# Varuna Case Management

Vaka yönetimi modülü — bağımsız uygulama.
Mevcut durum: **FAZ 0 — Mock UI** (tüm veri `caseMockData.ts`'ten gelir).

## Geliştirme

```bash
npm install
npm run dev          # client (5273) + bff (3101) birlikte
npm run dev:client   # sadece Vite
npm run dev:server   # sadece BFF
```

> Not: VarunaExecutiveCockpit 5173/3001 kullandığı için bu proje 5273/3101'e alındı.
> İki proje aynı anda paralel çalışabilir.

## Yapı

```
src/
  features/cases/          → Cases listesi, NewCaseForm, CaseDetailDrawer, types
  services/caseService.ts  → USE_MOCK flag merkezi (tüm data buradan akar)
  mocks/caseMockData.ts    → Mock vakalar + lookup'lar
  components/ui/           → Badge, StatusPill, Drawer, Modal, Button, Card, Field
  lib/format.ts            → Tarih / boyut formatlayıcılar
server/
  index.js                 → Express, port 3001
  routes/cases.js          → İskelet endpoint'ler (FAZ 2'de doldurulacak)
```

## Faz Planı

- [x] FAZ 0 — Mock UI (Cases liste + NewCase + CaseDetailDrawer)
- [ ] FAZ 1 — 6 admin tanım ekranı (Kategori, SLA Kuralları, 3rd Party, Evrak, Kontrol Listesi, Takım)
- [ ] FAZ 2 — BFF + DB (USE_MOCK=false)
- [ ] FAZ 3 — Liste/form iyileştirmeleri (SLA hesap, auto-load)
- [ ] FAZ 4 — Drawer iyileştirmeleri (supervisor onay, escalation log, SLA countdown)
- [ ] FAZ 5 — KPI Dashboard
