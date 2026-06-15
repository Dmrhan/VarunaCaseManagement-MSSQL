-- MSSQL: orijinal onDelete davranislarini geri getirir (Cascade/SetNull)
-- 3 istisna NoAction kaldi: AccountProduct.product, CaseNote.parent, CaseLink.linkedCase
BEGIN TRY

BEGIN TRAN;

-- DropForeignKey
ALTER TABLE [dbo].[AccountCompany] DROP CONSTRAINT [AccountCompany_accountId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[AccountCompany] DROP CONSTRAINT [AccountCompany_companyId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[AccountContact] DROP CONSTRAINT [AccountContact_accountId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[AccountProduct] DROP CONSTRAINT [AccountProduct_accountCompanyId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[AccountProject] DROP CONSTRAINT [AccountProject_accountCompanyId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[Address] DROP CONSTRAINT [Address_accountId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[AISuggestion] DROP CONSTRAINT [AISuggestion_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseActivity] DROP CONSTRAINT [CaseActivity_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseApproval] DROP CONSTRAINT [CaseApproval_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseAttachment] DROP CONSTRAINT [CaseAttachment_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseCallLog] DROP CONSTRAINT [CaseCallLog_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseLink] DROP CONSTRAINT [CaseLink_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseMention] DROP CONSTRAINT [CaseMention_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseNote] DROP CONSTRAINT [CaseNote_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseNoteReaction] DROP CONSTRAINT [CaseNoteReaction_noteId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseNotification] DROP CONSTRAINT [CaseNotification_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseOfferedSolution] DROP CONSTRAINT [CaseOfferedSolution_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseReminder] DROP CONSTRAINT [CaseReminder_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseReminder] DROP CONSTRAINT [CaseReminder_userId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseResolutionApproval] DROP CONSTRAINT [CaseResolutionApproval_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseSolutionStep] DROP CONSTRAINT [CaseSolutionStep_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseTransfer] DROP CONSTRAINT [CaseTransfer_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[CaseWatcher] DROP CONSTRAINT [CaseWatcher_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[ExternalKbSetting] DROP CONSTRAINT [ExternalKbSetting_companyId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[ImportJob] DROP CONSTRAINT [ImportJob_companyId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[ImportJobRow] DROP CONSTRAINT [ImportJobRow_importJobId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[NotificationDispatch] DROP CONSTRAINT [NotificationDispatch_caseId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[Package] DROP CONSTRAINT [Package_companyId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[PackageItem] DROP CONSTRAINT [PackageItem_packageId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[Product] DROP CONSTRAINT [Product_companyId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[ProductGroup] DROP CONSTRAINT [ProductGroup_companyId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[TaxonomyDef] DROP CONSTRAINT [TaxonomyDef_companyId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[UserCompany] DROP CONSTRAINT [UserCompany_userId_fkey];

-- AddForeignKey
ALTER TABLE [dbo].[UserCompany] ADD CONSTRAINT [UserCompany_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExternalKbSetting] ADD CONSTRAINT [ExternalKbSetting_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountCompany] ADD CONSTRAINT [AccountCompany_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountCompany] ADD CONSTRAINT [AccountCompany_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountProject] ADD CONSTRAINT [AccountProject_accountCompanyId_fkey] FOREIGN KEY ([accountCompanyId]) REFERENCES [dbo].[AccountCompany]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountProduct] ADD CONSTRAINT [AccountProduct_accountCompanyId_fkey] FOREIGN KEY ([accountCompanyId]) REFERENCES [dbo].[AccountCompany]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountContact] ADD CONSTRAINT [AccountContact_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Address] ADD CONSTRAINT [Address_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ProductGroup] ADD CONSTRAINT [ProductGroup_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Product] ADD CONSTRAINT [Product_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Package] ADD CONSTRAINT [Package_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PackageItem] ADD CONSTRAINT [PackageItem_packageId_fkey] FOREIGN KEY ([packageId]) REFERENCES [dbo].[Package]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TaxonomyDef] ADD CONSTRAINT [TaxonomyDef_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseSolutionStep] ADD CONSTRAINT [CaseSolutionStep_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseReminder] ADD CONSTRAINT [CaseReminder_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseReminder] ADD CONSTRAINT [CaseReminder_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseActivity] ADD CONSTRAINT [CaseActivity_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseNote] ADD CONSTRAINT [CaseNote_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseNoteReaction] ADD CONSTRAINT [CaseNoteReaction_noteId_fkey] FOREIGN KEY ([noteId]) REFERENCES [dbo].[CaseNote]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseAttachment] ADD CONSTRAINT [CaseAttachment_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseCallLog] ADD CONSTRAINT [CaseCallLog_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseOfferedSolution] ADD CONSTRAINT [CaseOfferedSolution_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseApproval] ADD CONSTRAINT [CaseApproval_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseResolutionApproval] ADD CONSTRAINT [CaseResolutionApproval_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseNotification] ADD CONSTRAINT [CaseNotification_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseMention] ADD CONSTRAINT [CaseMention_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AISuggestion] ADD CONSTRAINT [AISuggestion_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseTransfer] ADD CONSTRAINT [CaseTransfer_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseWatcher] ADD CONSTRAINT [CaseWatcher_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseLink] ADD CONSTRAINT [CaseLink_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ImportJob] ADD CONSTRAINT [ImportJob_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ImportJobRow] ADD CONSTRAINT [ImportJobRow_importJobId_fkey] FOREIGN KEY ([importJobId]) REFERENCES [dbo].[ImportJob]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NotificationDispatch] ADD CONSTRAINT [NotificationDispatch_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

