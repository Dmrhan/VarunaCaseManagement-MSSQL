-- AloTech çağrı kaydı (CallLog) — gelen çağrı webhook'u (incoming-call-start / -end)
-- ile müşteri × ticket × agent × süre çağrı-merkezi raporlaması.
--
-- ADDITIVE / geriye-dönük güvenli: YALNIZCA yeni bir tablo (dbo.CallLog) + index'ler
-- oluşturur. Hiçbir mevcut tablo/kolon/constraint/veri değişmez. İzole tasarım —
-- Account/Case/Company'ye FK YOK (scalar kolonlar; join uygulama katmanında).
--
-- Idempotent: tablo zaten varsa hiçbir şey yapmaz (tekrar deploy güvenli).

BEGIN TRY

BEGIN TRAN;

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE [name] = 'CallLog' AND [schema_id] = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE [dbo].[CallLog] (
    [id]               NVARCHAR(450)  NOT NULL,
    [companyId]        NVARCHAR(450)  NOT NULL,
    [callId]           NVARCHAR(255)  NOT NULL,
    [callerId]         NVARCHAR(64)   NULL,
    [customerPassword] NVARCHAR(255)  NULL,
    [direction]        NVARCHAR(16)   NOT NULL CONSTRAINT [DF_CallLog_direction] DEFAULT ('inbound'),
    [queue]            NVARCHAR(128)  NULL,
    [agentEmail]       NVARCHAR(255)  NULL,
    [matchedAccountId] NVARCHAR(450)  NULL,
    [caseId]           NVARCHAR(450)  NULL,
    [status]           NVARCHAR(32)   NULL,
    [startedAt]        DATETIME2      NULL,
    [answeredAt]       DATETIME2      NULL,
    [endedAt]          DATETIME2      NULL,
    [durationSec]      INT            NULL,
    [raw]              NVARCHAR(MAX)  NULL,
    [createdAt]        DATETIME2      NOT NULL CONSTRAINT [DF_CallLog_createdAt] DEFAULT (sysutcdatetime()),
    [updatedAt]        DATETIME2      NOT NULL CONSTRAINT [DF_CallLog_updatedAt] DEFAULT (sysutcdatetime()),
    CONSTRAINT [CallLog_pkey] PRIMARY KEY CLUSTERED ([id])
  );

  CREATE UNIQUE NONCLUSTERED INDEX [CallLog_companyId_callId_key]
    ON [dbo].[CallLog] ([companyId], [callId]);
  CREATE NONCLUSTERED INDEX [CallLog_companyId_callerId_idx]
    ON [dbo].[CallLog] ([companyId], [callerId]);
  CREATE NONCLUSTERED INDEX [CallLog_companyId_matchedAccountId_idx]
    ON [dbo].[CallLog] ([companyId], [matchedAccountId]);
  CREATE NONCLUSTERED INDEX [CallLog_caseId_idx]
    ON [dbo].[CallLog] ([caseId]);
  CREATE NONCLUSTERED INDEX [CallLog_startedAt_idx]
    ON [dbo].[CallLog] ([startedAt]);
END;

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  ;THROW;
END CATCH
