IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.ThirdParty') AND name = 'pausesSla'
)
    ALTER TABLE [dbo].[ThirdParty] ADD [pausesSla] BIT NOT NULL DEFAULT 1;
