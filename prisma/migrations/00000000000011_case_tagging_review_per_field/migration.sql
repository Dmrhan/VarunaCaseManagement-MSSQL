-- Vaka Etiket Doğrulama Ekranı — alan bazlı (per-field) modele geçiş
--
-- Eski model: tek "openingVerdict" + tek "closingVerdict" (5+4 alanı tek
-- karar altında topluyordu). Yeni model: 9 etiketin (5 açılış + 4 kapanış)
-- her biri için ayrı Original{Code,Label} snapshot + Verdict + Corrected{Code,Label}.
-- Mevcut tabloda sadece 1 satır var ve eski şema yeni şemayla uyumsuz —
-- ürün kararı: eski satır(lar) silinir, elle taşınmaz.

BEGIN TRY

BEGIN TRAN;

-- Eski veri yeni şemayla uyumsuz — taşınmadan silinir (tek satır, önemsiz).
DELETE FROM [dbo].[CaseTaggingReview];

-- DropColumn: grouped verdict alanları artık alan bazlı Verdict kolonlarıyla değişiyor
ALTER TABLE [dbo].[CaseTaggingReview] DROP COLUMN [openingVerdict];
ALTER TABLE [dbo].[CaseTaggingReview] DROP COLUMN [closingVerdict];

-- AddColumn: açılış etiketleri (Platform, İş Süreci, İşlem Tipi, Etkilenen Nesne, Etki)
ALTER TABLE [dbo].[CaseTaggingReview] ADD
    [openingPlatformOriginalCode]    NVARCHAR(255),
    [openingPlatformOriginalLabel]   NVARCHAR(MAX),
    [openingPlatformVerdict]         NVARCHAR(50),
    [openingPlatformCorrectedCode]   NVARCHAR(255),
    [openingPlatformCorrectedLabel]  NVARCHAR(MAX),

    [openingBusinessProcessOriginalCode]   NVARCHAR(255),
    [openingBusinessProcessOriginalLabel]  NVARCHAR(MAX),
    [openingBusinessProcessVerdict]        NVARCHAR(50),
    [openingBusinessProcessCorrectedCode]  NVARCHAR(255),
    [openingBusinessProcessCorrectedLabel] NVARCHAR(MAX),

    [openingOperationTypeOriginalCode]   NVARCHAR(255),
    [openingOperationTypeOriginalLabel]  NVARCHAR(MAX),
    [openingOperationTypeVerdict]        NVARCHAR(50),
    [openingOperationTypeCorrectedCode]  NVARCHAR(255),
    [openingOperationTypeCorrectedLabel] NVARCHAR(MAX),

    [openingAffectedObjectOriginalCode]   NVARCHAR(255),
    [openingAffectedObjectOriginalLabel]  NVARCHAR(MAX),
    [openingAffectedObjectVerdict]        NVARCHAR(50),
    [openingAffectedObjectCorrectedCode]  NVARCHAR(255),
    [openingAffectedObjectCorrectedLabel] NVARCHAR(MAX),

    [openingImpactOriginalCode]    NVARCHAR(255),
    [openingImpactOriginalLabel]   NVARCHAR(MAX),
    [openingImpactVerdict]         NVARCHAR(50),
    [openingImpactCorrectedCode]   NVARCHAR(255),
    [openingImpactCorrectedLabel]  NVARCHAR(MAX);

-- AddColumn: kapanış etiketleri (Kök Neden Grubu, Kök Neden Detayı, Çözüm Tipi, Kalıcı Önlem)
ALTER TABLE [dbo].[CaseTaggingReview] ADD
    [closingRootCauseGroupOriginalCode]   NVARCHAR(255),
    [closingRootCauseGroupOriginalLabel]  NVARCHAR(MAX),
    [closingRootCauseGroupVerdict]        NVARCHAR(50),
    [closingRootCauseGroupCorrectedCode]  NVARCHAR(255),
    [closingRootCauseGroupCorrectedLabel] NVARCHAR(MAX),

    [closingRootCauseDetailOriginalCode]   NVARCHAR(255),
    [closingRootCauseDetailOriginalLabel]  NVARCHAR(MAX),
    [closingRootCauseDetailVerdict]        NVARCHAR(50),
    [closingRootCauseDetailCorrectedCode]  NVARCHAR(255),
    [closingRootCauseDetailCorrectedLabel] NVARCHAR(MAX),

    [closingResolutionTypeOriginalCode]   NVARCHAR(255),
    [closingResolutionTypeOriginalLabel]  NVARCHAR(MAX),
    [closingResolutionTypeVerdict]        NVARCHAR(50),
    [closingResolutionTypeCorrectedCode]  NVARCHAR(255),
    [closingResolutionTypeCorrectedLabel] NVARCHAR(MAX),

    [closingPermanentPreventionOriginalCode]   NVARCHAR(255),
    [closingPermanentPreventionOriginalLabel]  NVARCHAR(MAX),
    [closingPermanentPreventionVerdict]        NVARCHAR(50),
    [closingPermanentPreventionCorrectedCode]  NVARCHAR(255),
    [closingPermanentPreventionCorrectedLabel] NVARCHAR(MAX);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
