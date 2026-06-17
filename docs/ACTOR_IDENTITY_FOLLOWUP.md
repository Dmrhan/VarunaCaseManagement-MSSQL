# Actor Identity Hardening — Follow-up Plan (PR-3, PR-5)

Bu doküman 2026-06-17 Actor Identity audit'inin **uygulanmayan** kısımlarını
tasarım olarak kayıt altına alır. PR-1, PR-1.1, PR-2, PR-4 prod'a alındı
(PR #57, #59, #61). PR-3 ve PR-5 schema migration gerektirdiği için ayrı
PR'larda ele alınacak.

---

## PR-3 — Admin taxonomy/config createdByUserId audit

### Sorun

Admin/config create/update flow'ları kim tarafından yapıldığını kaydetmiyor.
Audit gap, governance soruları yanıtsız kalıyor: "Bu SLA policy'i kim
değiştirdi?", "Hangi Admin kategoriyi sildi?".

Etkilenen 6 model (mevcut schema'da `createdByUserId / updatedByUserId`
**hiç yok**):

| Model | Repository | Etkilenen endpoint'ler |
|---|---|---|
| `Team` | `adminRepository.teamRepo` | `POST /api/admin/teams`, `PATCH /api/admin/teams/:id` |
| `CategoryDef` | `adminRepository.categoryRepo` | `POST /api/admin/categories`, `PATCH /api/admin/categories/:id` |
| `SLAPolicy` | `adminRepository.slaRepo` | `POST /api/admin/sla-policies`, `PATCH /api/admin/sla-policies/:id` |
| `FieldDefinition` | `adminRepository.fieldDefRepo` | `POST /api/admin/field-definitions`, `PATCH /api/admin/field-definitions/:id` |
| `TaxonomyDef` | `taxonomyRepository` | `POST /api/admin/taxonomies/:type`, `PATCH /api/admin/taxonomies/:type/:id` |
| `ChecklistTemplate` | `checklistRepository` | `POST /api/admin/checklists`, `PATCH /api/admin/checklists/:id` |

**Zaten audit'li (referans):**
- `ApprovalPolicy.createdByUserId` ✓
- `NotificationTemplate.createdByUserId` ✓
- `NotificationRule.createdByUserId` ✓
- `ImportJob.createdByUserId` ✓
- `ReportView.ownerId` ✓ (Phase 4.1)

### Migration tasarımı

Tek migration, **additive nullable**, tüm 6 model:

```sql
-- 00000000000004_admin_audit.sql
BEGIN TRY
  BEGIN TRAN;

  ALTER TABLE [dbo].[Team]
    ADD [createdByUserId] NVARCHAR(450) NULL,
        [updatedByUserId] NVARCHAR(450) NULL;

  ALTER TABLE [dbo].[CategoryDef]
    ADD [createdByUserId] NVARCHAR(450) NULL,
        [updatedByUserId] NVARCHAR(450) NULL;

  ALTER TABLE [dbo].[SLAPolicy]
    ADD [createdByUserId] NVARCHAR(450) NULL,
        [updatedByUserId] NVARCHAR(450) NULL;

  ALTER TABLE [dbo].[FieldDefinition]
    ADD [createdByUserId] NVARCHAR(450) NULL,
        [updatedByUserId] NVARCHAR(450) NULL;

  ALTER TABLE [dbo].[TaxonomyDef]
    ADD [createdByUserId] NVARCHAR(450) NULL,
        [updatedByUserId] NVARCHAR(450) NULL;

  ALTER TABLE [dbo].[ChecklistTemplate]
    ADD [createdByUserId] NVARCHAR(450) NULL,
        [updatedByUserId] NVARCHAR(450) NULL;

  -- FK NULL action — User silinirse audit history kaybolmasın
  -- (ON DELETE NO ACTION default; SET NULL daha temiz olur ama
  -- MSSQL'de cyclic referans sorunu çıkabilir).
  ALTER TABLE [dbo].[Team]
    ADD CONSTRAINT [Team_createdByUserId_fkey]
    FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
  -- (FK constraint diğer 5 model için aynı pattern; sql kısaltıldı)

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW
END CATCH
```

### Backfill

**Yapılmaz.** Mevcut satırlar `createdByUserId=NULL` kalır (= "legacy/unknown
attribution"). Görüntülemede "—" gösterilir. Gerçek attribution yanlış
yapmaktansa namaz NULL daha iyi.

### Repository değişikliği

Her admin repo `create()` / `update()` method'una `actor` parametresi
ekle (mevcut PR-2 pattern'i ile aynı):

```js
async create(data, actor) {
  assertActor(actor, 'teamRepo.create');
  return prisma.team.create({
    data: {
      ...data,
      createdByUserId: actor.userId,
      updatedByUserId: actor.userId,
    },
  });
}

async update(id, patch, actor) {
  assertActor(actor, 'teamRepo.update');
  return prisma.team.update({
    where: { id },
    data: {
      ...patch,
      updatedByUserId: actor.userId,
    },
  });
}
```

### Route layer

Tüm `/api/admin/*` mutation endpoint'leri `requireActor(req)` çağrılır ve
actor pass edilir.

### Test

- Yeni static smoke: `smoke-admin-audit-static.js`
  - Schema field varlık
  - Repository signature actor zorunlu
  - Route layer actor pass ediyor
- Regression: mevcut admin smokes (varsa)

### Tahmini boyut

| Bileşen | LOC |
|---|---|
| Migration SQL | ~80 |
| schema.prisma updates | ~30 |
| adminRepository changes | ~150 |
| route updates | ~50 |
| Static smoke | ~80 |
| **Toplam** | **~390 LOC + 1 migration** |

---

## PR-5 — Optional FK/backfill for actor display fields

### Sorun

3 alan plain string (User.id FK değil):
- `CaseActivity.actor`
- `CaseAttachment.uploadedBy`
- `CaseCallLog.callerId` — Phase 2A pattern'i string ama semantic User.id;
  PR-1 sonrası ham User.id yazılıyor, FK yok.

Audit için problem:
- Display name değiştiğinde geçmiş kayıtlarda da değişmez (drift)
- "Bu activity'yi kim yazdı?" sorusunu güvenle yanıtlayamayız
- Forensic case: user silindiğinde activity'yi bağlayacak ID yok

### Migration tasarımı

3 nullable FK eklenir, mevcut display string'ler korunur (backwards-compat):

```sql
-- 00000000000005_actor_fk.sql
ALTER TABLE [dbo].[CaseActivity]
  ADD [actorUserId] NVARCHAR(450) NULL;
ALTER TABLE [dbo].[CaseAttachment]
  ADD [uploadedByUserId] NVARCHAR(450) NULL;
-- CaseCallLog.callerId zaten User.id formatında (PR-1 sonrası);
-- callerId'yi NVARCHAR'dan FK'ya promote etmek mevcut data ile uyumsuz olabilir,
-- ayrı bir migration'da consider edilebilir.

ALTER TABLE [dbo].[CaseActivity]
  ADD CONSTRAINT [CaseActivity_actorUserId_fkey]
  FOREIGN KEY ([actorUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[CaseAttachment]
  ADD CONSTRAINT [CaseAttachment_uploadedByUserId_fkey]
  FOREIGN KEY ([uploadedByUserId]) REFERENCES [dbo].[User]([id])
  ON DELETE NO ACTION ON UPDATE NO ACTION;
```

### Backfill stratejisi

**Display name'lerden TAHMIN ETME** (KESIN OLARAK):
- `actor='Demir Han'` → User tablosunda `fullName='Demir Han'` olan kullanıcı
  varsa atama → **YANLIŞ**; aynı isimde 2 user olabilir.
- `actor='Mock User'` → Eski legacy satırlar, `actorUserId=NULL` kalır
  (UI'da "— (eski sistem)" gösterilir).
- `actor=email format` → Yine de TAHMIN ETME; düzenli SQL'le güvenli match
  yapılamıyorsa NULL bırak.

**Backfill SQL (sadece tek-match olan satırlar için, opsiyonel):**
```sql
-- Eğer fullName tek bir User'a match ediyorsa (group by count=1) → bağla.
-- Bu agresif değil; çoğu satır NULL kalır.
UPDATE ca
SET ca.actorUserId = u.id
FROM CaseActivity ca
JOIN User u ON u.fullName = ca.actor
WHERE u.fullName IN (
  SELECT fullName FROM User GROUP BY fullName HAVING COUNT(*) = 1
)
AND ca.actorUserId IS NULL;
```

Düşük safety profile — opsiyonel. Default: backfill yok, mevcut row'lar NULL.

### Repository değişikliği

Forward writes hem display string hem FK alanı doldurur:

```js
// PR-1 sonrası create() actor.displayName yazıyor; ek olarak:
actor: actor.displayName,
actorUserId: actor.userId,
```

### UI etkisi

CaseActivity display öncelik:
1. `actorUserId` dolu → User tablosundan canlı fullName göster (rename'le sync)
2. `actorUserId` null → `actor` string göster (legacy)

Hiç UI breaking change yok.

### Tahmini boyut

| Bileşen | LOC |
|---|---|
| Migration SQL | ~50 |
| schema.prisma updates | ~15 |
| caseRepository forward writes | ~10 |
| Optional backfill SQL | ~30 (opsiyonel) |
| UI display logic | ~30 |
| Static smoke | ~50 |
| **Toplam** | **~185 LOC + 1 migration** |

---

## Sıralama önerisi

1. **PR-3** önce — admin audit en yüksek governance değeri
2. **PR-5** sonra — display layer benefit + forensic capability
3. PR-5 backfill ayrı yapılabilir (operasyonel iş, kod değil)

## Onaylar

- Bu doküman PR-2 + PR-4 PR'ı içinde dev'e merge edildi (commit log)
- Migration SQL'leri **henüz uygulanmadı** — implementation PR'larında yer alır
- Hiçbir destructive değişiklik yok; tüm migration'lar additive nullable
- Backfill yapılsa bile mevcut UI/report flow bozulmaz (display string fallback)
