# Metric Fixtures — Operations Intelligence Phase 1

Bu doc, `prisma/seedScenarios.ts` ile üretilen DEMO seed veri seti üzerinde
metric formula'larının beklenen değerlerini elle hesaplayıp **regression
fixture** olarak donduran kaynaktır. PR review sırasında "AI bana yanlış
sayı verdi" iddiasını test edebilmek için kullanılır.

Kaynak doc: `docs/OPERATIONS_DASHBOARD_DESIGN.md` §2.6.9 B/D + §2.6.2 dictionary.

---

## Phase 1 fixture scope

- **DEMO seed**: 15 demo müşteri + 18 demo vaka (UNIVERA/FINROTA/PARAM)
- **Scope**: SystemAdmin → tüm 3 şirket
- **Period**: deterministic — `from = 2026-05-13T00:00:00Z`, `to = 2026-05-14T00:00:00Z` *(1 günlük slice — manuel hesabı kolay tutar; gerçek scenario için 7g/30g de hesaplanabilir)*
- **Timezone**: Europe/Istanbul

## Kapsam edilen metric'ler (Phase 1)

| Metric | Status | DEMO fixture değeri |
| --- | --- | --- |
| totalCases | PENDING | (DEMO seed'e karşı hesapla + buraya yaz) |
| openCases | PENDING | … |
| slaRiskCount | PENDING | … |
| createdInPeriod | PENDING | … |
| resolvedInPeriod | PENDING | … |
| slaViolationRatePct | PENDING | … |
| avgResolutionWallClockHours | PENDING | … |
| reopenRatePct | PENDING | … |
| escalationRatePct | PENDING | … |
| transferRatePct | PENDING | … |
| retentionSuccessPct | PENDING | … |

> **PENDING:** Phase 1 PR merge sonrası operasyon ekibi DEMO seed üzerinde
> tek tek doğrulama yapacak; bu tablo o oturumda doldurulacak.

## Hesaplama notları

### `totalCases`
- Sayım: DEMO-* prefixli createdAt period içinde olan vakalar
- DEMO seed createdAt'leri `prisma/seedScenarios.ts` `caseRepository.upsert` ile **bugün** atıldı → period seçimi seed çalıştırma tarihiyle uyumlu olmalı
- Validate: `psql -c "SELECT COUNT(*) FROM \"Case\" WHERE \"caseNumber\" LIKE 'DEMO-%'"`

### `slaViolationRatePct`
- Resolved-based payda (period içinde resolvedAt set olan vakalar)
- DEMO seed yalnız DEMO-FIN-003 = Cozuldu; tek vaka period içinde → min sample (n>=5) altında → **null** beklenir
- Note: Bu metric için fixture testinde "Yetersiz veri (n=1)" sonucu doğrulanmalı

### `avgResolutionWallClockHours`
- Wall-clock (pause çıkarılmaz, Phase 1 karar)
- DEMO seed'de DEMO-FIN-003 için manuel `resolvedAt - createdAt` hesabı

### `reopenRatePct`
- Resolved-based payda
- DEMO seed'de YenidenAcildi statüsünde vaka var mı? — `caseRepository.upsert` ile set ettiklerimizi kontrol et
- Beklenti: muhtemelen 0/1 → null (yetersiz sample)

## Manuel hesap protokolü

1. `npm run db:seed:scenarios` ile DEMO veri DB'ye yazılır
2. Periyot için `from`/`to` Istanbul midnight olarak seç
3. Aşağıdaki SQL'leri Supabase SQL editor'de çalıştır:

```sql
-- Period total created
SELECT COUNT(*) AS total_created
FROM "Case"
WHERE "caseNumber" LIKE 'DEMO-%'
  AND "createdAt" >= '2026-05-13T00:00:00+03'::timestamptz
  AND "createdAt" <  '2026-05-14T00:00:00+03'::timestamptz;

-- Period total resolved
SELECT COUNT(*) AS total_resolved
FROM "Case"
WHERE "caseNumber" LIKE 'DEMO-%'
  AND "resolvedAt" >= '2026-05-13T00:00:00+03'::timestamptz
  AND "resolvedAt" <  '2026-05-14T00:00:00+03'::timestamptz;

-- avgResolutionWallClockHours
SELECT
  AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt"))/3600.0) AS avg_ttr_hours,
  COUNT(*) AS sample_size
FROM "Case"
WHERE "caseNumber" LIKE 'DEMO-%'
  AND "resolvedAt" >= '2026-05-13T00:00:00+03'::timestamptz
  AND "resolvedAt" <  '2026-05-14T00:00:00+03'::timestamptz
  AND "resolvedAt" > "createdAt";

-- Open snapshot
SELECT COUNT(*) AS open_count
FROM "Case"
WHERE "caseNumber" LIKE 'DEMO-%'
  AND "status"::text IN ('Acik','Incelemede','ThirdPartyWaiting','Eskalasyon','YenidenAcildi');
```

4. Sonuçları yukarıdaki tabloya yaz
5. Smoke script ile karşılaştır: `node --env-file=.env scripts/smoke-analytics-overview.js` (özel DEMO scope fixture'ı eklenebilir Phase 2)
6. Mismatch varsa: aggregator SQL'i veya formula helper'ı kontrol et; doc'ta neden farklı olduğunu yaz

## Edge case fixture'ları (Phase 1 — placeholder)

| Edge case | Beklenen davranış | Fixture'a yazılan değer |
| --- | --- | --- |
| Period boundary: 23:59 Istanbul vaka | "Bugün" bucket'ında olmalı | PENDING |
| 0 resolved cases | slaViolationRatePct = null + minSampleViolations'a eklenir | PENDING |
| Cancel edilmiş vaka | TTR hesabına dahil değil; totalCases dahil | PENDING |
| Unassigned vaka (assignedPersonId=null) | agentWorkload'a dahil değil (Phase 2+ için) | N/A — Phase 1 metric yok |
| DST geçişi | Hour bucket'ta NaN üretmemeli | N/A (Phase 1 yalnız day granularity) |

---

## Sonraki adımlar

- [ ] PENDING satırlarının elle doldurulması (Phase 1 PR review)
- [ ] Smoke script'ine DEMO-only scope ekleme (Phase 2 prework)
- [ ] Golden snapshot JSON dosyası (`__tests__/golden/operations-overview.json`) — Phase 2'de
