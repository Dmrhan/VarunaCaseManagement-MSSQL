-- AlterTable: CompanySettings — requireKbAnalysis flag
ALTER TABLE [dbo].[CompanySettings] ADD [requireKbAnalysis] BIT NOT NULL CONSTRAINT [CompanySettings_requireKbAnalysis_df] DEFAULT 0;
