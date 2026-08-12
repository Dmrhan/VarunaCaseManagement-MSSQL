-- SLA İş-Saati Takvimi (Faz 1) — WorkCalendar + Holiday tabloları.
--
-- İhtiyaç: SLA süreleri şirket bazlı mesai penceresi (Pzt-Cu 08:30-18:00
-- + öğle molası 12:00-13:00, net 8,5 sa/gün) ve resmi tatillere göre
-- akacak. Param/Finrota/Univera'nın takvimleri FARKLI olabilir.
--
-- Davranış: takvimi olmayan (veya isActive=0) şirket duvar-saati
-- davranışında kalır → şirket şirket kademeli geçiş. Bu migration tek
-- başına shippable; hiçbir mevcut yol bu tablolardan okumaz (Faz 3'te
-- caseRepository.create damgası + Faz 4 tüketicileri bağlanır).
--
-- Karar defteri (kullanıcı, 2026-07-13/14): şirket-bazlı takvim; 7/24
-- yok; arife yarım-gün v1'de (halfDayEndMin, UI default 780=13:00);
-- DAKİKA = tek doğruluk kaynağı; mola tek tanım tüm çalışma günlerine.
--
-- Additive: breaking change yok, backfill gerekmez (tanımlar admin
-- ekranından — Faz 2 — girilecek).

BEGIN TRY

BEGIN TRAN;

-- ───────────── WorkCalendar tablosu ─────────────
CREATE TABLE [dbo].[WorkCalendar] (
  [id]              NVARCHAR(450) NOT NULL,
  [companyId]       NVARCHAR(450) NOT NULL,
  [workDays]        NVARCHAR(Max) NOT NULL, -- json: [{"day":1,"startMin":510,"endMin":1080},...]
  [breakStartMin]   INT NULL,
  [breakEndMin]     INT NULL,
  [isActive]        BIT NOT NULL CONSTRAINT [DF_WorkCalendar_isActive] DEFAULT 1,
  [pauseOnCustomerWait] BIT NOT NULL CONSTRAINT [DF_WorkCalendar_pauseCW] DEFAULT 0, -- K-F parametrik duraklatma
  [effectiveFrom]   DATETIME2 NULL, -- kesim tarihi (duyurulu geçiş)
  [createdByUserId] NVARCHAR(450) NULL,
  [updatedByUserId] NVARCHAR(450) NULL,
  [createdAt]       DATETIME2 NOT NULL CONSTRAINT [DF_WorkCalendar_createdAt] DEFAULT sysutcdatetime(),
  [updatedAt]       DATETIME2 NOT NULL,
  CONSTRAINT [PK_WorkCalendar] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [UQ_WorkCalendar_companyId] UNIQUE ([companyId]),
  CONSTRAINT [FK_WorkCalendar_company] FOREIGN KEY ([companyId])
    REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- ───────────── Holiday tablosu ─────────────
CREATE TABLE [dbo].[Holiday] (
  [id]              NVARCHAR(450) NOT NULL,
  [calendarId]      NVARCHAR(450) NOT NULL,
  [companyId]       NVARCHAR(450) NOT NULL,
  [date]            DATE NOT NULL,
  [name]            NVARCHAR(200) NOT NULL,
  [isHalfDay]       BIT NOT NULL CONSTRAINT [DF_Holiday_isHalfDay] DEFAULT 0,
  [halfDayEndMin]   INT NULL,
  [createdByUserId] NVARCHAR(450) NULL,
  [createdAt]       DATETIME2 NOT NULL CONSTRAINT [DF_Holiday_createdAt] DEFAULT sysutcdatetime(),
  CONSTRAINT [PK_Holiday] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [UQ_Holiday_company_date] UNIQUE ([companyId], [date]),
  -- MSSQL çift-cascade tuzağı (CaseLink deseni): Company tarafı NO ACTION,
  -- takvim silinirse tatiller CASCADE temizlenir.
  CONSTRAINT [FK_Holiday_calendar] FOREIGN KEY ([calendarId])
    REFERENCES [dbo].[WorkCalendar]([id]) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT [FK_Holiday_company] FOREIGN KEY ([companyId])
    REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE NONCLUSTERED INDEX [IX_Holiday_company_date] ON [dbo].[Holiday]([companyId], [date]);
CREATE NONCLUSTERED INDEX [IX_Holiday_calendarId] ON [dbo].[Holiday]([calendarId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
