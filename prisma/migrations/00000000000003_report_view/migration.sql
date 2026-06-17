-- Phase 4 — Saved Views (Report Studio): ReportView tablosu
--
-- tenant-scoped rapor görünümleri (kolon seçimi + filtre + pivot config).
-- Owner CASCADE → kullanıcı silinince view'ları da silinir.
-- Company CASCADE → tenant silinince view'lar da silinir.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[ReportView] (
    [id]          NVARCHAR(450) NOT NULL,
    [companyId]   NVARCHAR(450) NOT NULL,
    [ownerId]     NVARCHAR(450) NOT NULL,
    [name]        NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(MAX),
    [mode]        NVARCHAR(50)  NOT NULL,
    [columns]     NVARCHAR(MAX) NOT NULL,
    [filters]     NVARCHAR(MAX) NOT NULL,
    [pivotConfig] NVARCHAR(MAX),
    [isShared]    BIT           NOT NULL CONSTRAINT [ReportView_isShared_df] DEFAULT 0,
    [createdAt]   DATETIME2     NOT NULL CONSTRAINT [ReportView_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt]   DATETIME2     NOT NULL,
    CONSTRAINT [ReportView_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- Unique: aynı kullanıcı aynı tenant'ta aynı isimde 2 view kaydedemez
CREATE UNIQUE NONCLUSTERED INDEX [ReportView_companyId_ownerId_name_key]
    ON [dbo].[ReportView]([companyId], [ownerId], [name]);

-- List queries: kullanıcının kendi view'ları (private + shared kombinasyonu)
CREATE NONCLUSTERED INDEX [ReportView_companyId_ownerId_idx]
    ON [dbo].[ReportView]([companyId], [ownerId]);

-- Tenant-wide shared view lookup
CREATE NONCLUSTERED INDEX [ReportView_companyId_isShared_idx]
    ON [dbo].[ReportView]([companyId], [isShared]);

-- AddForeignKey: owner (User)
ALTER TABLE [dbo].[ReportView]
    ADD CONSTRAINT [ReportView_ownerId_fkey]
    FOREIGN KEY ([ownerId]) REFERENCES [dbo].[User]([id])
    ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: company
ALTER TABLE [dbo].[ReportView]
    ADD CONSTRAINT [ReportView_companyId_fkey]
    FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id])
    ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
