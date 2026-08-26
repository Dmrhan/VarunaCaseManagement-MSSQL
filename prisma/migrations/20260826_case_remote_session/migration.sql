-- CaseRemoteSession (2026-08-26) — L1 uzak destek (TeamViewer) oturumu ↔ vaka bağı.
--
-- NEDEN: L1 temsilcileri çağrı içinde TeamViewer ile bağlanıp destek veriyor;
-- bu oturumların hangi vakaya ait olduğu ve ne kadar sürdüğü raporlanamıyordu.
-- "Bağlantı Al" butonu bu tabloya bir işaret satırı yazar (vaka + temsilci +
-- müşteri TeamViewer ID + başlangıç). Süre butonda ölçülmez; gece reconcile
-- job'ı TeamViewer bağlantı raporundan (deviceid == customerTvId + temsilci +
-- zaman) gerçek start/end/süreyi bulup satırı günceller.
--
-- Additive: yalnızca YENİ tablo + FK + index. Mevcut tablolar/veri/davranış
-- hiç değişmez. Geri alınabilir (DROP TABLE).

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[CaseRemoteSession] (
    [id]             NVARCHAR(450) NOT NULL,
    [caseId]         NVARCHAR(450) NOT NULL,
    [companyId]      NVARCHAR(450) NOT NULL,
    [agentUserId]    NVARCHAR(450),
    [agentName]      NVARCHAR(max) NOT NULL,
    [customerTvId]   NVARCHAR(64)  NOT NULL,
    [tool]           NVARCHAR(50)  NOT NULL CONSTRAINT [CaseRemoteSession_tool_df] DEFAULT 'TeamViewer',
    [startedAt]      DATETIME2     NOT NULL CONSTRAINT [CaseRemoteSession_startedAt_df] DEFAULT sysutcdatetime(),
    [launchedVia]    NVARCHAR(50),
    [tvConnectionId] NVARCHAR(128),
    [tvStartDate]    DATETIME2,
    [tvEndDate]      DATETIME2,
    [durationSec]    INT,
    [matchState]     NVARCHAR(20)  NOT NULL CONSTRAINT [CaseRemoteSession_matchState_df] DEFAULT 'pending',
    [matchedAt]      DATETIME2,
    [note]           NVARCHAR(max),
    [createdAt]      DATETIME2     NOT NULL CONSTRAINT [CaseRemoteSession_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt]      DATETIME2     NOT NULL,
    CONSTRAINT [CaseRemoteSession_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseRemoteSession_caseId_idx] ON [dbo].[CaseRemoteSession]([caseId]);
CREATE NONCLUSTERED INDEX [CaseRemoteSession_companyId_startedAt_idx] ON [dbo].[CaseRemoteSession]([companyId], [startedAt]);
CREATE NONCLUSTERED INDEX [CaseRemoteSession_customerTvId_idx] ON [dbo].[CaseRemoteSession]([customerTvId]);
CREATE NONCLUSTERED INDEX [CaseRemoteSession_matchState_idx] ON [dbo].[CaseRemoteSession]([matchState]);

-- AddForeignKey
ALTER TABLE [dbo].[CaseRemoteSession]
    ADD CONSTRAINT [CaseRemoteSession_caseId_fkey]
    FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
