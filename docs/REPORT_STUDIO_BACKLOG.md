# Report Studio Backlog

Bu backlog, Operations Dashboard Report Studio icin demo sonrasi donulecek eksik
urun kabiliyetleri ve UI/UX polish maddelerini toplar.

## P0 / Next

### Report Studio UX Redesign / Editorial Polish

Mevcut Report Studio islevsel olsa da dashboard widget'larini fazla tekrar ediyor.
Rapor deneyimi dashboard'dan ayrismali: interaktif operasyon ekrani degil,
yoneticiye gonderilebilir karar dokumani gibi okunmali.

Hedef:
- Yeni backend veya AI endpoint eklemeden mevcut deterministic overview + AI
  narrative verisini daha editoryal bir rapor akisi ile sunmak.
- Widget tekrarini azaltmak; narrative-first, karar odakli bir layout kurmak.
- Print/PDF-friendly gorunumu rapor dokumani gibi cilalamak.

Onerilen rapor akisi:
1. Baslik, tarih araligi, scope rozeti, filter ozeti
2. Yonetici ozeti
3. One cikan 3-5 metrik
4. Riskler ve etkileri
5. Operasyon sagligi
6. SLA ve risk
7. Musteri etkisi
8. Takim/kategori kirilimlari
9. Aksiyon plani
10. Appendix / audit

Tasarim notlari:
- Dashboard'daki 11 KPI'in tamami ana govdede tile olarak tekrar edilmemeli.
- Ana govdede 3-5 kritik metrik; kalan metrikler tablo veya appendix'e gitmeli.
- AI narrative ustte karar akisini kurmali, metrikler bunu desteklemeli.
- Rapor section'lari dashboard kartlarindan farkli olmali.
- Print layout beyaz arka plan, temiz tablo kirilimlari ve okunur tipografi
  ile calismali.

## P1

### XLSX / CSV Export

Report Studio ve/veya drill-down verisini Excel/CSV olarak disari alma.

Onerilen icerik:
- KPI sheet
- Time series sheet
- Breakdown sheets
- Risk accounts sheet
- Drill-down case rows sheet
- Scope/audit appendix sheet

Notlar:
- Buyuk export icin async job altyapisi gerekebilir.
- Tum formatlar ayni deterministic snapshot'tan beslenmeli.

### Server-side PDF

Browser print/PDF yerine sabit formatli kurumsal PDF uretimi.

Notlar:
- Vercel serverless timeout riski degerlendirilmeli.
- Kucuk raporlar sync, buyuk raporlar async job olabilir.
- Markdown/print fallback korunmali.

### Snapshot Locking

Raporun uretildigi andaki deterministic snapshot'i dondurmak.

Neden:
- Ayni rapor daha sonra acildiginda sayilar degismemeli.
- Audit ve yonetim paylasimi icin tekrar uretilebilirlik guclenmeli.

## P2

### Report History

Kullanici ve admin icin uretilen rapor gecmisi.

Kayitlanacak alanlar:
- generatedBy
- generatedAt
- scopeFingerprint
- filterFingerprint
- formulaVersion
- metricAuditId
- AI usageLogId
- lens/report type
- includeAiNarrative

### Scheduled Reports

Haftalik/aylik otomatik rapor uretimi.

Olasiliklar:
- Pazartesi sabahi executive brief
- Haftalik operasyon raporu
- Musteri risk raporu

Gerekenler:
- schedule config
- job runner
- notification veya email kanali
- hata/retry davranisi

### Email / Share

Raporu sistemden mail olarak gonderme veya paylasilabilir link uretme.

Notlar:
- Yetki ve TTL kritik.
- Public share en sona birakilmali.
- Internal signed link daha guvenli ilk adim.

## P3 / Future

### Report Approval / Editing Workflow

AI taslak + deterministic metriklerden gelen raporu kullanicinin duzenleyip
"final" olarak isaretleyebilmesi.

Olasiliklar:
- AI narrative inline edit
- "Taslak" / "Final" durumu
- duzenleyen kisi ve tarih footer'i
- degisiklik audit'i

### AI Narrative Controls

Rapor narrative'i icin kullanici kontrollu ton/uzunluk ayarlari.

Olasiliklar:
- kisa / standart / detayli
- daha resmi / daha operasyonel
- AI'siz pure deterministic mod etiketi

### Offline Evidence Appendix

Drill-down evidence rapor icinde sadece caseNumber linki olarak mi kalsin,
yoksa offline okunabilir ozet case appendix'i mi uretilsin karari.

Trade-off:
- Offline appendix daha faydali ama rapor boyutunu ve gizlilik riskini artirir.

## Acik Urun Kararlari

- Raporun ana hedef formati once PDF mi, XLSX mi?
- AI'siz modun UI etiketi ne olsun: "Yalniz deterministik", "AI narrative dahil
  degil", "Raw KPI raporu"?
- AI narrative kullanici tarafindan duzenlenirse footer'da "Duzenlendi" notu
  zorunlu olsun mu?
- Report history retention suresi ne olmali? Oneri: minimum 1 yil.
- Agent/people-level raporlar HR/audit hassasiyeti nedeniyle hangi rollerde
  gorunmeli?
