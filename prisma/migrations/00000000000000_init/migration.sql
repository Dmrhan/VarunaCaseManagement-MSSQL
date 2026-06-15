BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] NVARCHAR(450) NOT NULL,
    [email] NVARCHAR(255) NOT NULL,
    [fullName] NVARCHAR(max) NOT NULL,
    [role] NVARCHAR(50) NOT NULL CONSTRAINT [User_role_df] DEFAULT 'Agent',
    [isActive] BIT NOT NULL CONSTRAINT [User_isActive_df] DEFAULT 1,
    [personId] NVARCHAR(450),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[UserCompany] (
    [id] NVARCHAR(450) NOT NULL,
    [userId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [role] NVARCHAR(50) NOT NULL CONSTRAINT [UserCompany_role_df] DEFAULT 'Agent',
    [isActive] BIT NOT NULL CONSTRAINT [UserCompany_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UserCompany_createdAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [UserCompany_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UserCompany_userId_companyId_key] UNIQUE NONCLUSTERED ([userId],[companyId])
);

-- CreateTable
CREATE TABLE [dbo].[Company] (
    [id] NVARCHAR(450) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [Company_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Company_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Company_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Company_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[FieldDefinition] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [label] NVARCHAR(max) NOT NULL,
    [fieldKey] NVARCHAR(100) NOT NULL,
    [fieldType] NVARCHAR(50) NOT NULL,
    [caseType] NVARCHAR(50),
    [isRequired] BIT NOT NULL CONSTRAINT [FieldDefinition_isRequired_df] DEFAULT 0,
    [displayOrder] INT NOT NULL CONSTRAINT [FieldDefinition_displayOrder_df] DEFAULT 0,
    [options] NVARCHAR(max),
    [isActive] BIT NOT NULL CONSTRAINT [FieldDefinition_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [FieldDefinition_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FieldDefinition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [FieldDefinition_companyId_fieldKey_key] UNIQUE NONCLUSTERED ([companyId],[fieldKey])
);

-- CreateTable
CREATE TABLE [dbo].[CompanySettings] (
    [companyId] NVARCHAR(450) NOT NULL,
    [logoUrl] NVARCHAR(max),
    [primaryColor] NVARCHAR(max),
    [appName] NVARCHAR(max),
    [supportEmail] NVARCHAR(max),
    [requireCustomerOnCaseCreate] BIT NOT NULL CONSTRAINT [CompanySettings_requireCustomerOnCaseCreate_df] DEFAULT 0,
    [projectsEnabled] BIT NOT NULL CONSTRAINT [CompanySettings_projectsEnabled_df] DEFAULT 0,
    [projectsRequired] BIT NOT NULL CONSTRAINT [CompanySettings_projectsRequired_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CompanySettings_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CompanySettings_pkey] PRIMARY KEY CLUSTERED ([companyId])
);

-- CreateTable
CREATE TABLE [dbo].[ExternalKbSetting] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [ExternalKbSetting_enabled_df] DEFAULT 0,
    [providerName] NVARCHAR(max),
    [baseUrl] NVARCHAR(max),
    [askEndpointPath] NVARCHAR(max) NOT NULL CONSTRAINT [ExternalKbSetting_askEndpointPath_df] DEFAULT '/api/v1/kb/ask',
    [searchEndpointPath] NVARCHAR(max) NOT NULL CONSTRAINT [ExternalKbSetting_searchEndpointPath_df] DEFAULT '/api/v1/kb/search',
    [healthEndpointPath] NVARCHAR(max) NOT NULL CONSTRAINT [ExternalKbSetting_healthEndpointPath_df] DEFAULT '/api/v1/health',
    [statsEndpointPath] NVARCHAR(max) NOT NULL CONSTRAINT [ExternalKbSetting_statsEndpointPath_df] DEFAULT '/api/v1/stats',
    [categorizeEndpointPath] NVARCHAR(max) NOT NULL CONSTRAINT [ExternalKbSetting_categorizeEndpointPath_df] DEFAULT '/api/v1/categorize',
    [categorizeV2EndpointPath] NVARCHAR(max) NOT NULL CONSTRAINT [ExternalKbSetting_categorizeV2EndpointPath_df] DEFAULT '/api/v1/categorize-v2',
    [suggestCloseEndpointPath] NVARCHAR(max) NOT NULL CONSTRAINT [ExternalKbSetting_suggestCloseEndpointPath_df] DEFAULT '/api/v1/suggest-close',
    [analyzeEndpointPath] NVARCHAR(max) NOT NULL CONSTRAINT [ExternalKbSetting_analyzeEndpointPath_df] DEFAULT '/api/v1/analyze',
    [authType] NVARCHAR(255) NOT NULL CONSTRAINT [ExternalKbSetting_authType_df] DEFAULT 'none',
    [apiKeySecretName] NVARCHAR(max),
    [timeoutMs] INT NOT NULL CONSTRAINT [ExternalKbSetting_timeoutMs_df] DEFAULT 30000,
    [defaultTopK] INT NOT NULL CONSTRAINT [ExternalKbSetting_defaultTopK_df] DEFAULT 8,
    [defaultStrictness] NVARCHAR(max) NOT NULL CONSTRAINT [ExternalKbSetting_defaultStrictness_df] DEFAULT 'lenient',
    [defaultRerank] BIT NOT NULL CONSTRAINT [ExternalKbSetting_defaultRerank_df] DEFAULT 1,
    [defaultVerify] BIT NOT NULL CONSTRAINT [ExternalKbSetting_defaultVerify_df] DEFAULT 1,
    [showCitations] BIT NOT NULL CONSTRAINT [ExternalKbSetting_showCitations_df] DEFAULT 1,
    [allowAgentUse] BIT NOT NULL CONSTRAINT [ExternalKbSetting_allowAgentUse_df] DEFAULT 1,
    [allowSupervisorUse] BIT NOT NULL CONSTRAINT [ExternalKbSetting_allowSupervisorUse_df] DEFAULT 1,
    [allowCsmUse] BIT NOT NULL CONSTRAINT [ExternalKbSetting_allowCsmUse_df] DEFAULT 1,
    [notes] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ExternalKbSetting_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ExternalKbSetting_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ExternalKbSetting_companyId_key] UNIQUE NONCLUSTERED ([companyId])
);

-- CreateTable
CREATE TABLE [dbo].[Account] (
    [id] NVARCHAR(450) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [vkn] NVARCHAR(20),
    [companyId] NVARCHAR(450),
    [email] NVARCHAR(255),
    [phone] NVARCHAR(max),
    [phoneE164] NVARCHAR(20),
    [phoneType] NVARCHAR(255),
    [phoneExtension] NVARCHAR(max),
    [phone2] NVARCHAR(max),
    [phone2E164] NVARCHAR(20),
    [phone2Type] NVARCHAR(255),
    [phone2Extension] NVARCHAR(max),
    [phone3] NVARCHAR(max),
    [phone3E164] NVARCHAR(20),
    [phone3Type] NVARCHAR(255),
    [phone3Extension] NVARCHAR(max),
    [primaryPhoneSlot] INT,
    [isActive] BIT NOT NULL CONSTRAINT [Account_isActive_df] DEFAULT 1,
    [customerType] NVARCHAR(50) NOT NULL CONSTRAINT [Account_customerType_df] DEFAULT 'Corporate',
    [legalName] NVARCHAR(max),
    [registrationNo] NVARCHAR(max),
    [taxOffice] NVARCHAR(max),
    [tcknHash] NVARCHAR(64),
    [tcknLast4] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Account_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Account_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AccountCompany] (
    [id] NVARCHAR(450) NOT NULL,
    [accountId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [externalCustomerCode] NVARCHAR(255),
    [packageName] NVARCHAR(max),
    [packageId] NVARCHAR(450),
    [contractStartAt] DATETIME2,
    [contractEndAt] DATETIME2,
    [segment] NVARCHAR(max),
    [status] NVARCHAR(255) NOT NULL CONSTRAINT [AccountCompany_status_df] DEFAULT 'active',
    [notes] NVARCHAR(max),
    [preferredResponseChannel] NVARCHAR(255),
    [responseEmail] NVARCHAR(max),
    [responsePhone] NVARCHAR(max),
    [allowCustomerNotifications] BIT NOT NULL CONSTRAINT [AccountCompany_allowCustomerNotifications_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AccountCompany_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AccountCompany_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AccountCompany_accountId_companyId_key] UNIQUE NONCLUSTERED ([accountId],[companyId])
);

-- CreateTable
CREATE TABLE [dbo].[AccountProject] (
    [id] NVARCHAR(450) NOT NULL,
    [accountCompanyId] NVARCHAR(450) NOT NULL,
    [code] NVARCHAR(255) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [status] NVARCHAR(50) NOT NULL CONSTRAINT [AccountProject_status_df] DEFAULT 'Active',
    [startDate] DATETIME2,
    [endDate] DATETIME2,
    [description] NVARCHAR(max),
    [isActive] BIT NOT NULL CONSTRAINT [AccountProject_isActive_df] DEFAULT 1,
    [sourceExternalId] NVARCHAR(450),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AccountProject_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AccountProject_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AccountProject_accountCompanyId_code_key] UNIQUE NONCLUSTERED ([accountCompanyId],[code])
);

-- CreateTable
CREATE TABLE [dbo].[AccountProduct] (
    [id] NVARCHAR(450) NOT NULL,
    [accountCompanyId] NVARCHAR(450) NOT NULL,
    [productId] NVARCHAR(450),
    [productName] NVARCHAR(max) NOT NULL,
    [productCode] NVARCHAR(255),
    [isActive] BIT NOT NULL CONSTRAINT [AccountProduct_isActive_df] DEFAULT 1,
    [startedAt] DATETIME2,
    [endedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AccountProduct_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AccountProduct_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AccountContact] (
    [id] NVARCHAR(450) NOT NULL,
    [accountId] NVARCHAR(450) NOT NULL,
    [fullName] NVARCHAR(max) NOT NULL,
    [title] NVARCHAR(max),
    [email] NVARCHAR(max),
    [phone] NVARCHAR(max),
    [phoneE164] NVARCHAR(20),
    [phoneType] NVARCHAR(255),
    [phoneExtension] NVARCHAR(max),
    [isPrimary] BIT NOT NULL CONSTRAINT [AccountContact_isPrimary_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [AccountContact_isActive_df] DEFAULT 1,
    [preferredChannel] NVARCHAR(255),
    [sourceExternalId] NVARCHAR(450),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AccountContact_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AccountContact_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Address] (
    [id] NVARCHAR(450) NOT NULL,
    [accountId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [type] NVARCHAR(50) NOT NULL,
    [label] NVARCHAR(max),
    [line1] NVARCHAR(max) NOT NULL,
    [line2] NVARCHAR(max),
    [district] NVARCHAR(max),
    [city] NVARCHAR(max),
    [state] NVARCHAR(255),
    [postalCode] NVARCHAR(255),
    [country] NVARCHAR(max) NOT NULL CONSTRAINT [Address_country_df] DEFAULT 'TR',
    [isDefault] BIT NOT NULL CONSTRAINT [Address_isDefault_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [Address_isActive_df] DEFAULT 1,
    [sourceExternalId] NVARCHAR(450),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Address_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Address_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ProductGroup] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [code] NVARCHAR(255) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [description] NVARCHAR(max),
    [sortOrder] INT NOT NULL CONSTRAINT [ProductGroup_sortOrder_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [ProductGroup_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ProductGroup_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ProductGroup_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ProductGroup_companyId_code_key] UNIQUE NONCLUSTERED ([companyId],[code])
);

-- CreateTable
CREATE TABLE [dbo].[Product] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [productGroupId] NVARCHAR(450) NOT NULL,
    [code] NVARCHAR(255) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [description] NVARCHAR(max),
    [supportLevel] NVARCHAR(50) NOT NULL CONSTRAINT [Product_supportLevel_df] DEFAULT 'L1',
    [sortOrder] INT NOT NULL CONSTRAINT [Product_sortOrder_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [Product_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Product_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Product_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Product_companyId_code_key] UNIQUE NONCLUSTERED ([companyId],[code])
);

-- CreateTable
CREATE TABLE [dbo].[Package] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [code] NVARCHAR(255) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [description] NVARCHAR(max),
    [supportLevel] NVARCHAR(50) NOT NULL CONSTRAINT [Package_supportLevel_df] DEFAULT 'L1',
    [sortOrder] INT NOT NULL CONSTRAINT [Package_sortOrder_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [Package_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Package_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Package_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Package_companyId_code_key] UNIQUE NONCLUSTERED ([companyId],[code])
);

-- CreateTable
CREATE TABLE [dbo].[PackageItem] (
    [packageId] NVARCHAR(450) NOT NULL,
    [productId] NVARCHAR(450) NOT NULL,
    [sortOrder] INT NOT NULL CONSTRAINT [PackageItem_sortOrder_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PackageItem_createdAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [PackageItem_pkey] PRIMARY KEY CLUSTERED ([packageId],[productId])
);

-- CreateTable
CREATE TABLE [dbo].[TaxonomyDef] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [taxonomyType] NVARCHAR(255) NOT NULL,
    [code] NVARCHAR(255) NOT NULL,
    [label] NVARCHAR(max) NOT NULL,
    [parentId] NVARCHAR(450),
    [isActive] BIT NOT NULL CONSTRAINT [TaxonomyDef_isActive_df] DEFAULT 1,
    [sortOrder] INT NOT NULL CONSTRAINT [TaxonomyDef_sortOrder_df] DEFAULT 0,
    [metadata] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TaxonomyDef_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TaxonomyDef_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TaxonomyDef_companyId_taxonomyType_code_key] UNIQUE NONCLUSTERED ([companyId],[taxonomyType],[code])
);

-- CreateTable
CREATE TABLE [dbo].[CaseSolutionStep] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [stepIndex] INT NOT NULL,
    [source] NVARCHAR(255) NOT NULL,
    [sourceRef] NVARCHAR(255),
    [sourceTitle] NVARCHAR(max),
    [title] NVARCHAR(max) NOT NULL,
    [description] NVARCHAR(max),
    [status] NVARCHAR(255) NOT NULL CONSTRAINT [CaseSolutionStep_status_df] DEFAULT 'suggested',
    [note] NVARCHAR(max),
    [triedAt] DATETIME2,
    [triedByUserId] NVARCHAR(450),
    [outcomeAt] DATETIME2,
    [outcomeByUserId] NVARCHAR(450),
    [createdByUserId] NVARCHAR(450),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CaseSolutionStep_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CaseSolutionStep_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Team] (
    [id] NVARCHAR(450) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [description] NVARCHAR(max),
    [companyId] NVARCHAR(450) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [Team_isActive_df] DEFAULT 1,
    [defaultSupportLevel] NVARCHAR(50) NOT NULL CONSTRAINT [Team_defaultSupportLevel_df] DEFAULT 'L1',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Team_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Team_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Person] (
    [id] NVARCHAR(450) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [email] NVARCHAR(max),
    [teamId] NVARCHAR(450),
    [isActive] BIT NOT NULL CONSTRAINT [Person_isActive_df] DEFAULT 1,
    [isTeamLead] BIT NOT NULL CONSTRAINT [Person_isTeamLead_df] DEFAULT 0,
    [supportLevel] NVARCHAR(50) NOT NULL CONSTRAINT [Person_supportLevel_df] DEFAULT 'L1',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Person_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Person_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ThirdParty] (
    [id] NVARCHAR(450) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(max),
    [isActive] BIT NOT NULL CONSTRAINT [ThirdParty_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ThirdParty_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ThirdParty_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ThirdParty_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[DocumentType] (
    [id] NVARCHAR(450) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(max),
    [isActive] BIT NOT NULL CONSTRAINT [DocumentType_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DocumentType_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [DocumentType_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DocumentType_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[CategoryDef] (
    [id] NVARCHAR(450) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [description] NVARCHAR(max),
    [parentId] NVARCHAR(450),
    [companyId] NVARCHAR(450),
    [isActive] BIT NOT NULL CONSTRAINT [CategoryDef_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CategoryDef_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CategoryDef_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[OfferedSolutionDef] (
    [id] NVARCHAR(450) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [description] NVARCHAR(max),
    [isActive] BIT NOT NULL CONSTRAINT [OfferedSolutionDef_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [OfferedSolutionDef_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [OfferedSolutionDef_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SLAPolicy] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [companyName] NVARCHAR(max) NOT NULL,
    [productGroup] NVARCHAR(200) NOT NULL,
    [categoryName] NVARCHAR(255) NOT NULL,
    [subCategoryName] NVARCHAR(255) NOT NULL,
    [requestType] NVARCHAR(50) NOT NULL,
    [responseHours] INT NOT NULL,
    [resolutionHours] INT NOT NULL,
    [description] NVARCHAR(max),
    [isActive] BIT NOT NULL CONSTRAINT [SLAPolicy_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SLAPolicy_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SLAPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ChecklistTemplate] (
    [id] NVARCHAR(450) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [companyName] NVARCHAR(max) NOT NULL,
    [productGroup] NVARCHAR(200) NOT NULL,
    [categoryName] NVARCHAR(255) NOT NULL,
    [description] NVARCHAR(max),
    [items] NVARCHAR(max) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [ChecklistTemplate_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ChecklistTemplate_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ChecklistTemplate_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Case] (
    [id] NVARCHAR(450) NOT NULL,
    [caseNumber] NVARCHAR(50) NOT NULL,
    [title] NVARCHAR(max) NOT NULL,
    [description] NVARCHAR(max) NOT NULL,
    [caseType] NVARCHAR(50) NOT NULL,
    [status] NVARCHAR(50) NOT NULL CONSTRAINT [Case_status_df] DEFAULT 'Acik',
    [priority] NVARCHAR(50) NOT NULL,
    [origin] NVARCHAR(50) NOT NULL,
    [originDescription] NVARCHAR(255),
    [companyId] NVARCHAR(450) NOT NULL,
    [companyName] NVARCHAR(max) NOT NULL,
    [accountId] NVARCHAR(450),
    [accountName] NVARCHAR(max),
    [accountProjectId] NVARCHAR(450),
    [accountProjectName] NVARCHAR(max),
    [category] NVARCHAR(255) NOT NULL,
    [subCategory] NVARCHAR(255) NOT NULL,
    [requestType] NVARCHAR(50) NOT NULL,
    [productGroup] NVARCHAR(max),
    [productId] NVARCHAR(450),
    [productName] NVARCHAR(max),
    [packageId] NVARCHAR(450),
    [packageName] NVARCHAR(max),
    [assignedTeamId] NVARCHAR(450),
    [assignedTeamName] NVARCHAR(max),
    [assignedPersonId] NVARCHAR(450),
    [assignedPersonName] NVARCHAR(max),
    [escalationLevel] NVARCHAR(50) NOT NULL CONSTRAINT [Case_escalationLevel_df] DEFAULT 'Yok',
    [supportLevel] NVARCHAR(50) NOT NULL CONSTRAINT [Case_supportLevel_df] DEFAULT 'L1',
    [thirdPartyId] NVARCHAR(450),
    [thirdPartyName] NVARCHAR(max),
    [financialStatus] NVARCHAR(50),
    [productUsage] NVARCHAR(50),
    [usageChangeAlert] NVARCHAR(50),
    [responseLevel] NVARCHAR(50),
    [cancellationRequest] BIT,
    [offeredSolutions] NVARCHAR(max),
    [offerExpiryDate] DATETIME2,
    [offerOutcome] NVARCHAR(50),
    [offerRejectionReason] NVARCHAR(max),
    [actionTaken] NVARCHAR(max),
    [churnResult] NVARCHAR(50),
    [retentionStatus] NVARCHAR(50),
    [followUpDate] DATETIME2,
    [resolutionNote] NVARCHAR(max),
    [cancellationReason] NVARCHAR(max),
    [approvalState] NVARCHAR(50),
    [communicationState] NVARCHAR(255),
    [communicationChannelOverride] NVARCHAR(255),
    [slaResponseDueAt] DATETIME2,
    [slaResolutionDueAt] DATETIME2,
    [slaViolation] BIT NOT NULL CONSTRAINT [Case_slaViolation_df] DEFAULT 0,
    [slaPausedAt] DATETIME2,
    [slaPausedDurationMin] INT NOT NULL CONSTRAINT [Case_slaPausedDurationMin_df] DEFAULT 0,
    [slaThirdPartyWaitMin] INT NOT NULL CONSTRAINT [Case_slaThirdPartyWaitMin_df] DEFAULT 0,
    [customerMatchPending] BIT NOT NULL CONSTRAINT [Case_customerMatchPending_df] DEFAULT 0,
    [customerContactName] NVARCHAR(max),
    [customerContactPhone] NVARCHAR(max),
    [customerContactEmail] NVARCHAR(max),
    [customerCompanyName] NVARCHAR(max),
    [aiSummary] NVARCHAR(max),
    [aiCategoryPrediction] NVARCHAR(max),
    [aiPriorityPrediction] NVARCHAR(50),
    [aiDuplicateScore] FLOAT(53),
    [aiConfidenceScore] FLOAT(53),
    [aiGeneratedFlag] BIT NOT NULL CONSTRAINT [Case_aiGeneratedFlag_df] DEFAULT 0,
    [aiRejectReason] NVARCHAR(max),
    [aiCallBrief] NVARCHAR(max),
    [aiFollowupRecommendation] NVARCHAR(max),
    [aiRetentionOfferSuggestion] NVARCHAR(max),
    [checklistItems] NVARCHAR(max),
    [customFields] NVARCHAR(max),
    [snoozeUntil] DATETIME2,
    [snoozeReason] NVARCHAR(50),
    [snoozePreviousStatus] NVARCHAR(50),
    [qaEmpathyScore] INT,
    [qaClarityScore] INT,
    [qaSpeedScore] INT,
    [qaFeedback] NVARCHAR(max),
    [qaScoredAt] DATETIME2,
    [transferCount] INT NOT NULL CONSTRAINT [Case_transferCount_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Case_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    [resolvedAt] DATETIME2,
    CONSTRAINT [Case_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Case_caseNumber_key] UNIQUE NONCLUSTERED ([caseNumber])
);

-- CreateTable
CREATE TABLE [dbo].[CaseReminder] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450),
    [userId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [remindAt] DATETIME2 NOT NULL,
    [message] NVARCHAR(max),
    [sentAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CaseReminder_createdAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [CaseReminder_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CaseActivity] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [action] NVARCHAR(max) NOT NULL,
    [actionType] NVARCHAR(50),
    [fieldName] NVARCHAR(max),
    [fromValue] NVARCHAR(max),
    [toValue] NVARCHAR(max),
    [note] NVARCHAR(max),
    [actor] NVARCHAR(max) NOT NULL,
    [at] DATETIME2 NOT NULL CONSTRAINT [CaseActivity_at_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [CaseActivity_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CaseNote] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [authorName] NVARCHAR(max) NOT NULL,
    [authorId] NVARCHAR(450),
    [content] NVARCHAR(max) NOT NULL,
    [visibility] NVARCHAR(50) NOT NULL CONSTRAINT [CaseNote_visibility_df] DEFAULT 'Internal',
    [parentNoteId] NVARCHAR(450),
    [replyCount] INT NOT NULL CONSTRAINT [CaseNote_replyCount_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CaseNote_createdAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [CaseNote_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CaseNoteReaction] (
    [id] NVARCHAR(450) NOT NULL,
    [noteId] NVARCHAR(450) NOT NULL,
    [userId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [emoji] NVARCHAR(50) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CaseNoteReaction_createdAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [CaseNoteReaction_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CaseNoteReaction_noteId_userId_emoji_key] UNIQUE NONCLUSTERED ([noteId],[userId],[emoji])
);

-- CreateTable
CREATE TABLE [dbo].[MetricQueryAudit] (
    [id] NVARCHAR(450) NOT NULL,
    [userId] NVARCHAR(450) NOT NULL,
    [userRole] NVARCHAR(255) NOT NULL,
    [endpoint] NVARCHAR(255) NOT NULL,
    [scopeFingerprint] NVARCHAR(255) NOT NULL,
    [scopeKind] NVARCHAR(255) NOT NULL,
    [filterFingerprint] NVARCHAR(max) NOT NULL,
    [formulaVersion] NVARCHAR(max) NOT NULL,
    [generatedAt] DATETIME2 NOT NULL CONSTRAINT [MetricQueryAudit_generatedAt_df] DEFAULT sysutcdatetime(),
    [durationMs] INT NOT NULL,
    [recordsScanned] INT,
    [responseHash] NVARCHAR(max),
    CONSTRAINT [MetricQueryAudit_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CaseAttachment] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [fileName] NVARCHAR(max) NOT NULL,
    [fileSize] INT NOT NULL,
    [mimeType] NVARCHAR(255) NOT NULL,
    [fileUrl] NVARCHAR(max),
    [uploadedBy] NVARCHAR(max) NOT NULL,
    [uploadedAt] DATETIME2 NOT NULL CONSTRAINT [CaseAttachment_uploadedAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [CaseAttachment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CaseCallLog] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [callDate] DATETIME2 NOT NULL,
    [durationMin] INT NOT NULL,
    [callDisposition] NVARCHAR(50) NOT NULL,
    [callOutcome] NVARCHAR(50) NOT NULL,
    [description] NVARCHAR(max),
    [callerId] NVARCHAR(450) NOT NULL,
    [callerName] NVARCHAR(max) NOT NULL,
    [nextFollowupDate] DATETIME2,
    [lastInteractionDate] DATETIME2,
    CONSTRAINT [CaseCallLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CaseOfferedSolution] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [solutionDefId] NVARCHAR(450) NOT NULL,
    [offeredAt] DATETIME2 NOT NULL CONSTRAINT [CaseOfferedSolution_offeredAt_df] DEFAULT sysutcdatetime(),
    [offeredBy] NVARCHAR(max) NOT NULL,
    [outcome] NVARCHAR(50) NOT NULL CONSTRAINT [CaseOfferedSolution_outcome_df] DEFAULT 'Beklemede',
    [expiryDate] DATETIME2,
    [rejectionReason] NVARCHAR(max),
    CONSTRAINT [CaseOfferedSolution_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CaseApproval] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [approvalType] NVARCHAR(255) NOT NULL,
    [requestedBy] NVARCHAR(max) NOT NULL,
    [requestedAt] DATETIME2 NOT NULL CONSTRAINT [CaseApproval_requestedAt_df] DEFAULT sysutcdatetime(),
    [decision] NVARCHAR(50) NOT NULL CONSTRAINT [CaseApproval_decision_df] DEFAULT 'Bekliyor',
    [decidedBy] NVARCHAR(max),
    [decidedAt] DATETIME2,
    [decisionReason] NVARCHAR(max),
    CONSTRAINT [CaseApproval_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ResolutionApprovalPolicy] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [description] NVARCHAR(max),
    [isActive] BIT NOT NULL CONSTRAINT [ResolutionApprovalPolicy_isActive_df] DEFAULT 1,
    [sortOrder] INT NOT NULL CONSTRAINT [ResolutionApprovalPolicy_sortOrder_df] DEFAULT 100,
    [matchScope] NVARCHAR(max) NOT NULL,
    [approverType] NVARCHAR(50) NOT NULL,
    [approverPersonId] NVARCHAR(450),
    [allowSelfApprove] BIT NOT NULL CONSTRAINT [ResolutionApprovalPolicy_allowSelfApprove_df] DEFAULT 0,
    [rejectionBehavior] NVARCHAR(50) NOT NULL CONSTRAINT [ResolutionApprovalPolicy_rejectionBehavior_df] DEFAULT 'ReturnToAssignee',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ResolutionApprovalPolicy_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    [createdByUserId] NVARCHAR(450),
    CONSTRAINT [ResolutionApprovalPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CaseResolutionApproval] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [policyId] NVARCHAR(450),
    [policyNameSnapshot] NVARCHAR(max) NOT NULL,
    [state] NVARCHAR(50) NOT NULL CONSTRAINT [CaseResolutionApproval_state_df] DEFAULT 'Pending',
    [submittedByUserId] NVARCHAR(450) NOT NULL,
    [submittedAt] DATETIME2 NOT NULL CONSTRAINT [CaseResolutionApproval_submittedAt_df] DEFAULT sysutcdatetime(),
    [resolutionSummary] NVARCHAR(max) NOT NULL,
    [customerMessageDraft] NVARCHAR(max),
    [expectedApproverPersonId] NVARCHAR(450),
    [decidedByUserId] NVARCHAR(450),
    [decidedAt] DATETIME2,
    [rejectionReason] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CaseResolutionApproval_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CaseResolutionApproval_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CaseNotification] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [eventType] NVARCHAR(255) NOT NULL,
    [channel] NVARCHAR(50) NOT NULL,
    [recipient] NVARCHAR(255) NOT NULL,
    [payload] NVARCHAR(max),
    [sentAt] DATETIME2 NOT NULL CONSTRAINT [CaseNotification_sentAt_df] DEFAULT sysutcdatetime(),
    [readAt] DATETIME2,
    CONSTRAINT [CaseNotification_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[KnowledgeSource] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [sourceType] NVARCHAR(50) NOT NULL,
    [contentCount] INT NOT NULL CONSTRAINT [KnowledgeSource_contentCount_df] DEFAULT 0,
    [description] NVARCHAR(max),
    [isActive] BIT NOT NULL CONSTRAINT [KnowledgeSource_isActive_df] DEFAULT 1,
    [lastUpdated] DATETIME2 NOT NULL CONSTRAINT [KnowledgeSource_lastUpdated_df] DEFAULT sysutcdatetime(),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [KnowledgeSource_createdAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [KnowledgeSource_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[QAScoreLog] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [scoredAt] DATETIME2 NOT NULL CONSTRAINT [QAScoreLog_scoredAt_df] DEFAULT sysutcdatetime(),
    [empathy] INT NOT NULL,
    [clarity] INT NOT NULL,
    [speed] INT NOT NULL,
    [feedback] NVARCHAR(max),
    CONSTRAINT [QAScoreLog_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QAScoreLog_caseId_key] UNIQUE NONCLUSTERED ([caseId])
);

-- CreateTable
CREATE TABLE [dbo].[PatternAlert] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [category] NVARCHAR(max) NOT NULL,
    [caseCount] INT NOT NULL,
    [windowMinutes] INT NOT NULL CONSTRAINT [PatternAlert_windowMinutes_df] DEFAULT 60,
    [detectedAt] DATETIME2 NOT NULL CONSTRAINT [PatternAlert_detectedAt_df] DEFAULT sysutcdatetime(),
    [caseIds] NVARCHAR(max) NOT NULL,
    [status] NVARCHAR(50) NOT NULL CONSTRAINT [PatternAlert_status_df] DEFAULT 'active',
    [dismissedBy] NVARCHAR(max),
    [dismissedAt] DATETIME2,
    CONSTRAINT [PatternAlert_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AIUsageLog] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [endpoint] NVARCHAR(255) NOT NULL,
    [caseId] NVARCHAR(450),
    [userId] NVARCHAR(450),
    [accepted] BIT,
    [responseTimeMs] INT,
    [tokenCount] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AIUsageLog_createdAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [AIUsageLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CaseMention] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [noteId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [mentionedUserId] NVARCHAR(450) NOT NULL,
    [mentionedBy] NVARCHAR(max) NOT NULL,
    [seenAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CaseMention_createdAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [CaseMention_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AISuggestion] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [suggestionType] NVARCHAR(255) NOT NULL,
    [suggestedValue] NVARCHAR(max) NOT NULL,
    [confidenceScore] FLOAT(53),
    [accepted] BIT,
    [rejectReason] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AISuggestion_createdAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [AISuggestion_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CaseTransfer] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [fromTeamId] NVARCHAR(450),
    [toTeamId] NVARCHAR(450) NOT NULL,
    [fromPersonId] NVARCHAR(450),
    [toPersonId] NVARCHAR(450),
    [reason] NVARCHAR(max) NOT NULL,
    [reasonCode] NVARCHAR(255),
    [transferredBy] NVARCHAR(max) NOT NULL,
    [transferredAt] DATETIME2 NOT NULL CONSTRAINT [CaseTransfer_transferredAt_df] DEFAULT sysutcdatetime(),
    [aiSuggestedTeamId] NVARCHAR(450),
    [aiSuggestedReason] NVARCHAR(max),
    [aiReasonCode] NVARCHAR(255),
    [aiConfidence] FLOAT(53),
    CONSTRAINT [CaseTransfer_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CaseWatcher] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [userId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [addedBy] NVARCHAR(max) NOT NULL,
    [addedAt] DATETIME2 NOT NULL CONSTRAINT [CaseWatcher_addedAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [CaseWatcher_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CaseWatcher_caseId_userId_key] UNIQUE NONCLUSTERED ([caseId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[CaseLink] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [linkedCaseId] NVARCHAR(450) NOT NULL,
    [linkType] NVARCHAR(50) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [createdBy] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CaseLink_createdAt_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [CaseLink_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CaseLink_caseId_linkedCaseId_linkType_key] UNIQUE NONCLUSTERED ([caseId],[linkedCaseId],[linkType])
);

-- CreateTable
CREATE TABLE [dbo].[ImportJob] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [targetType] NVARCHAR(255) NOT NULL CONSTRAINT [ImportJob_targetType_df] DEFAULT 'account',
    [sourceType] NVARCHAR(255) NOT NULL,
    [sourceName] NVARCHAR(max),
    [sourceUrlMasked] NVARCHAR(max),
    [fileName] NVARCHAR(max),
    [dataPath] NVARCHAR(max),
    [targetSchemaVersion] NVARCHAR(max) NOT NULL,
    [status] NVARCHAR(255) NOT NULL CONSTRAINT [ImportJob_status_df] DEFAULT 'draft',
    [totalRows] INT NOT NULL CONSTRAINT [ImportJob_totalRows_df] DEFAULT 0,
    [createCount] INT NOT NULL CONSTRAINT [ImportJob_createCount_df] DEFAULT 0,
    [updateCount] INT NOT NULL CONSTRAINT [ImportJob_updateCount_df] DEFAULT 0,
    [skippedCount] INT NOT NULL CONSTRAINT [ImportJob_skippedCount_df] DEFAULT 0,
    [errorCount] INT NOT NULL CONSTRAINT [ImportJob_errorCount_df] DEFAULT 0,
    [warningCount] INT NOT NULL CONSTRAINT [ImportJob_warningCount_df] DEFAULT 0,
    [summaryJson] NVARCHAR(max),
    [entityCountsJson] NVARCHAR(max),
    [createdByUserId] NVARCHAR(450),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ImportJob_createdAt_df] DEFAULT sysutcdatetime(),
    [startedAt] DATETIME2,
    [completedAt] DATETIME2,
    [rolledBackAt] DATETIME2,
    [rolledBackByUserId] NVARCHAR(450),
    [leaseTickId] NVARCHAR(450),
    [leaseAt] DATETIME2,
    [heartbeatAt] DATETIME2,
    CONSTRAINT [ImportJob_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ImportJobRow] (
    [id] NVARCHAR(450) NOT NULL,
    [importJobId] NVARCHAR(450) NOT NULL,
    [rowNumber] INT NOT NULL,
    [action] NVARCHAR(max) NOT NULL CONSTRAINT [ImportJobRow_action_df] DEFAULT 'skip',
    [status] NVARCHAR(255) NOT NULL CONSTRAINT [ImportJobRow_status_df] DEFAULT 'pending',
    [entityType] NVARCHAR(255),
    [parentRowNumber] INT,
    [relationshipKey] NVARCHAR(max),
    [accountId] NVARCHAR(450),
    [recordId] NVARCHAR(450),
    [matchKey] NVARCHAR(max),
    [errorsJson] NVARCHAR(max),
    [warningsJson] NVARCHAR(max),
    [rawJson] NVARCHAR(max),
    [normalizedJson] NVARCHAR(max),
    [beforeJson] NVARCHAR(max),
    [afterJson] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ImportJobRow_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ImportJobRow_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[NotificationRule] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [description] NVARCHAR(max),
    [isActive] BIT NOT NULL CONSTRAINT [NotificationRule_isActive_df] DEFAULT 1,
    [sortOrder] INT NOT NULL CONSTRAINT [NotificationRule_sortOrder_df] DEFAULT 100,
    [event] NVARCHAR(100) NOT NULL,
    [conditions] NVARCHAR(max) NOT NULL,
    [isMatchAll] BIT NOT NULL CONSTRAINT [NotificationRule_isMatchAll_df] DEFAULT 0,
    [audience] NVARCHAR(max) NOT NULL,
    [templateId] NVARCHAR(450) NOT NULL,
    [channel] NVARCHAR(50) NOT NULL,
    [mode] NVARCHAR(50) NOT NULL CONSTRAINT [NotificationRule_mode_df] DEFAULT 'LogOnly',
    [suppressDuplicateWithinMinutes] INT,
    [rateLimitPerHour] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NotificationRule_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    [createdByUserId] NVARCHAR(450),
    CONSTRAINT [NotificationRule_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[NotificationTemplate] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [key] NVARCHAR(100) NOT NULL,
    [name] NVARCHAR(max) NOT NULL,
    [description] NVARCHAR(max),
    [language] NVARCHAR(max) NOT NULL CONSTRAINT [NotificationTemplate_language_df] DEFAULT 'tr',
    [subjectTemplate] NVARCHAR(max) NOT NULL,
    [bodyTemplate] NVARCHAR(max) NOT NULL,
    [format] NVARCHAR(max) NOT NULL CONSTRAINT [NotificationTemplate_format_df] DEFAULT 'plain',
    [isCustomerFacing] BIT NOT NULL CONSTRAINT [NotificationTemplate_isCustomerFacing_df] DEFAULT 0,
    [requiredVariables] NVARCHAR(max) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [NotificationTemplate_version_df] DEFAULT 1,
    [isActive] BIT NOT NULL CONSTRAINT [NotificationTemplate_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NotificationTemplate_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    [createdByUserId] NVARCHAR(450),
    CONSTRAINT [NotificationTemplate_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [NotificationTemplate_companyId_key_key] UNIQUE NONCLUSTERED ([companyId],[key])
);

-- CreateTable
CREATE TABLE [dbo].[NotificationDispatch] (
    [id] NVARCHAR(450) NOT NULL,
    [caseId] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [event] NVARCHAR(100) NOT NULL,
    [ruleId] NVARCHAR(450),
    [ruleNameSnapshot] NVARCHAR(max) NOT NULL,
    [templateId] NVARCHAR(450),
    [templateKeySnapshot] NVARCHAR(max) NOT NULL,
    [templateVersionSnapshot] INT NOT NULL,
    [audienceType] NVARCHAR(255) NOT NULL,
    [audienceIdentifier] NVARCHAR(max) NOT NULL,
    [channel] NVARCHAR(50) NOT NULL,
    [mode] NVARCHAR(50) NOT NULL,
    [state] NVARCHAR(50) NOT NULL CONSTRAINT [NotificationDispatch_state_df] DEFAULT 'Pending',
    [snapshotSubject] NVARCHAR(max) NOT NULL,
    [snapshotBody] NVARCHAR(max) NOT NULL,
    [suppressionReason] NVARCHAR(max),
    [idempotencyKey] NVARCHAR(255),
    [confirmedByUserId] NVARCHAR(450),
    [confirmedAt] DATETIME2,
    [deliveryNote] NVARCHAR(max),
    [dispatchedAt] DATETIME2,
    [failureReason] NVARCHAR(max),
    [attempts] INT NOT NULL CONSTRAINT [NotificationDispatch_attempts_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NotificationDispatch_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [NotificationDispatch_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ActionItem] (
    [id] NVARCHAR(450) NOT NULL,
    [companyId] NVARCHAR(450) NOT NULL,
    [userId] NVARCHAR(450) NOT NULL,
    [personId] NVARCHAR(450),
    [kind] NVARCHAR(50) NOT NULL,
    [state] NVARCHAR(50) NOT NULL CONSTRAINT [ActionItem_state_df] DEFAULT 'Pending',
    [actionRequired] BIT NOT NULL CONSTRAINT [ActionItem_actionRequired_df] DEFAULT 1,
    [objectType] NVARCHAR(255),
    [objectId] NVARCHAR(450),
    [caseId] NVARCHAR(450),
    [caseNumber] NVARCHAR(max),
    [caseTitle] NVARCHAR(max),
    [generatedBy] NVARCHAR(max),
    [groupKey] NVARCHAR(max),
    [dedupKey] NVARCHAR(255),
    [priority] INT NOT NULL CONSTRAINT [ActionItem_priority_df] DEFAULT 50,
    [reasonLabel] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ActionItem_createdAt_df] DEFAULT sysutcdatetime(),
    [updatedAt] DATETIME2 NOT NULL,
    [firstSeenAt] DATETIME2,
    [snoozedUntil] DATETIME2,
    [doneAt] DATETIME2,
    [doneByUserId] NVARCHAR(450),
    [doneOutcome] NVARCHAR(max),
    [closeNote] NVARCHAR(max),
    [archivedAt] DATETIME2,
    CONSTRAINT [ActionItem_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserCompany_userId_idx] ON [dbo].[UserCompany]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserCompany_companyId_idx] ON [dbo].[UserCompany]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [FieldDefinition_companyId_caseType_isActive_idx] ON [dbo].[FieldDefinition]([companyId], [caseType], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExternalKbSetting_companyId_enabled_idx] ON [dbo].[ExternalKbSetting]([companyId], [enabled]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Account_companyId_idx] ON [dbo].[Account]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Account_name_idx] ON [dbo].[Account]([name]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Account_customerType_idx] ON [dbo].[Account]([customerType]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Account_phoneE164_idx] ON [dbo].[Account]([phoneE164]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Account_phone2E164_idx] ON [dbo].[Account]([phone2E164]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Account_phone3E164_idx] ON [dbo].[Account]([phone3E164]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountCompany_companyId_idx] ON [dbo].[AccountCompany]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountCompany_accountId_idx] ON [dbo].[AccountCompany]([accountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountCompany_externalCustomerCode_idx] ON [dbo].[AccountCompany]([externalCustomerCode]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountCompany_packageId_idx] ON [dbo].[AccountCompany]([packageId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountProject_accountCompanyId_idx] ON [dbo].[AccountProject]([accountCompanyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountProject_accountCompanyId_isActive_idx] ON [dbo].[AccountProject]([accountCompanyId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountProject_accountCompanyId_sourceExternalId_idx] ON [dbo].[AccountProject]([accountCompanyId], [sourceExternalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountProduct_accountCompanyId_idx] ON [dbo].[AccountProduct]([accountCompanyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountProduct_productId_idx] ON [dbo].[AccountProduct]([productId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountContact_accountId_idx] ON [dbo].[AccountContact]([accountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountContact_phoneE164_idx] ON [dbo].[AccountContact]([phoneE164]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AccountContact_accountId_sourceExternalId_idx] ON [dbo].[AccountContact]([accountId], [sourceExternalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Address_accountId_idx] ON [dbo].[Address]([accountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Address_companyId_idx] ON [dbo].[Address]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Address_accountId_type_idx] ON [dbo].[Address]([accountId], [type]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Address_accountId_isDefault_idx] ON [dbo].[Address]([accountId], [isDefault]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Address_accountId_sourceExternalId_idx] ON [dbo].[Address]([accountId], [sourceExternalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ProductGroup_companyId_idx] ON [dbo].[ProductGroup]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ProductGroup_companyId_isActive_idx] ON [dbo].[ProductGroup]([companyId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Product_companyId_idx] ON [dbo].[Product]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Product_companyId_productGroupId_isActive_idx] ON [dbo].[Product]([companyId], [productGroupId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Product_companyId_supportLevel_idx] ON [dbo].[Product]([companyId], [supportLevel]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Package_companyId_isActive_idx] ON [dbo].[Package]([companyId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Package_companyId_supportLevel_idx] ON [dbo].[Package]([companyId], [supportLevel]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PackageItem_productId_idx] ON [dbo].[PackageItem]([productId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TaxonomyDef_companyId_taxonomyType_isActive_sortOrder_idx] ON [dbo].[TaxonomyDef]([companyId], [taxonomyType], [isActive], [sortOrder]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TaxonomyDef_parentId_idx] ON [dbo].[TaxonomyDef]([parentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseSolutionStep_caseId_stepIndex_idx] ON [dbo].[CaseSolutionStep]([caseId], [stepIndex]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseSolutionStep_caseId_status_idx] ON [dbo].[CaseSolutionStep]([caseId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseSolutionStep_companyId_idx] ON [dbo].[CaseSolutionStep]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseSolutionStep_source_sourceRef_idx] ON [dbo].[CaseSolutionStep]([source], [sourceRef]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Team_companyId_idx] ON [dbo].[Team]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CategoryDef_parentId_idx] ON [dbo].[CategoryDef]([parentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CategoryDef_companyId_idx] ON [dbo].[CategoryDef]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SLAPolicy_companyId_productGroup_categoryName_subCategoryName_requestType_idx] ON [dbo].[SLAPolicy]([companyId], [productGroup], [categoryName], [subCategoryName], [requestType]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ChecklistTemplate_companyId_productGroup_categoryName_idx] ON [dbo].[ChecklistTemplate]([companyId], [productGroup], [categoryName]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_accountId_idx] ON [dbo].[Case]([accountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_accountProjectId_idx] ON [dbo].[Case]([accountProjectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_companyId_idx] ON [dbo].[Case]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_assignedPersonId_idx] ON [dbo].[Case]([assignedPersonId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_assignedTeamId_idx] ON [dbo].[Case]([assignedTeamId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_status_idx] ON [dbo].[Case]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_caseType_idx] ON [dbo].[Case]([caseType]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_createdAt_idx] ON [dbo].[Case]([createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_slaResolutionDueAt_idx] ON [dbo].[Case]([slaResolutionDueAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_slaResponseDueAt_idx] ON [dbo].[Case]([slaResponseDueAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_snoozeUntil_idx] ON [dbo].[Case]([snoozeUntil]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_companyId_createdAt_idx] ON [dbo].[Case]([companyId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_companyId_status_idx] ON [dbo].[Case]([companyId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_companyId_assignedTeamId_idx] ON [dbo].[Case]([companyId], [assignedTeamId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_companyId_category_subCategory_idx] ON [dbo].[Case]([companyId], [category], [subCategory]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_companyId_resolvedAt_idx] ON [dbo].[Case]([companyId], [resolvedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_companyId_supportLevel_idx] ON [dbo].[Case]([companyId], [supportLevel]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_companyId_productId_idx] ON [dbo].[Case]([companyId], [productId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Case_companyId_packageId_idx] ON [dbo].[Case]([companyId], [packageId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseReminder_userId_remindAt_idx] ON [dbo].[CaseReminder]([userId], [remindAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseReminder_caseId_idx] ON [dbo].[CaseReminder]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseReminder_companyId_idx] ON [dbo].[CaseReminder]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseActivity_caseId_idx] ON [dbo].[CaseActivity]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseActivity_companyId_idx] ON [dbo].[CaseActivity]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseActivity_at_idx] ON [dbo].[CaseActivity]([at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseNote_caseId_idx] ON [dbo].[CaseNote]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseNote_companyId_idx] ON [dbo].[CaseNote]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseNote_parentNoteId_idx] ON [dbo].[CaseNote]([parentNoteId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseNoteReaction_noteId_idx] ON [dbo].[CaseNoteReaction]([noteId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseNoteReaction_userId_idx] ON [dbo].[CaseNoteReaction]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseNoteReaction_companyId_idx] ON [dbo].[CaseNoteReaction]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MetricQueryAudit_userId_generatedAt_idx] ON [dbo].[MetricQueryAudit]([userId], [generatedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MetricQueryAudit_endpoint_generatedAt_idx] ON [dbo].[MetricQueryAudit]([endpoint], [generatedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MetricQueryAudit_scopeFingerprint_idx] ON [dbo].[MetricQueryAudit]([scopeFingerprint]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseAttachment_caseId_idx] ON [dbo].[CaseAttachment]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseAttachment_companyId_idx] ON [dbo].[CaseAttachment]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseCallLog_caseId_idx] ON [dbo].[CaseCallLog]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseCallLog_companyId_idx] ON [dbo].[CaseCallLog]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseCallLog_callDate_idx] ON [dbo].[CaseCallLog]([callDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseCallLog_nextFollowupDate_idx] ON [dbo].[CaseCallLog]([nextFollowupDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseOfferedSolution_caseId_idx] ON [dbo].[CaseOfferedSolution]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseOfferedSolution_companyId_idx] ON [dbo].[CaseOfferedSolution]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseApproval_caseId_idx] ON [dbo].[CaseApproval]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseApproval_companyId_idx] ON [dbo].[CaseApproval]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseApproval_decision_idx] ON [dbo].[CaseApproval]([decision]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ResolutionApprovalPolicy_companyId_isActive_idx] ON [dbo].[ResolutionApprovalPolicy]([companyId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ResolutionApprovalPolicy_companyId_sortOrder_idx] ON [dbo].[ResolutionApprovalPolicy]([companyId], [sortOrder]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseResolutionApproval_caseId_idx] ON [dbo].[CaseResolutionApproval]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseResolutionApproval_companyId_state_idx] ON [dbo].[CaseResolutionApproval]([companyId], [state]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseResolutionApproval_expectedApproverPersonId_state_idx] ON [dbo].[CaseResolutionApproval]([expectedApproverPersonId], [state]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseResolutionApproval_caseId_state_idx] ON [dbo].[CaseResolutionApproval]([caseId], [state]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseNotification_caseId_idx] ON [dbo].[CaseNotification]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseNotification_companyId_idx] ON [dbo].[CaseNotification]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseNotification_recipient_readAt_idx] ON [dbo].[CaseNotification]([recipient], [readAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [KnowledgeSource_companyId_idx] ON [dbo].[KnowledgeSource]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [QAScoreLog_companyId_idx] ON [dbo].[QAScoreLog]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [QAScoreLog_companyId_scoredAt_idx] ON [dbo].[QAScoreLog]([companyId], [scoredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PatternAlert_companyId_idx] ON [dbo].[PatternAlert]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PatternAlert_companyId_detectedAt_idx] ON [dbo].[PatternAlert]([companyId], [detectedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PatternAlert_status_idx] ON [dbo].[PatternAlert]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AIUsageLog_companyId_idx] ON [dbo].[AIUsageLog]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AIUsageLog_companyId_createdAt_idx] ON [dbo].[AIUsageLog]([companyId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AIUsageLog_endpoint_idx] ON [dbo].[AIUsageLog]([endpoint]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseMention_caseId_idx] ON [dbo].[CaseMention]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseMention_mentionedUserId_idx] ON [dbo].[CaseMention]([mentionedUserId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseMention_companyId_idx] ON [dbo].[CaseMention]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AISuggestion_caseId_idx] ON [dbo].[AISuggestion]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AISuggestion_companyId_idx] ON [dbo].[AISuggestion]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseTransfer_caseId_idx] ON [dbo].[CaseTransfer]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseTransfer_companyId_idx] ON [dbo].[CaseTransfer]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseTransfer_companyId_transferredAt_idx] ON [dbo].[CaseTransfer]([companyId], [transferredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseWatcher_userId_idx] ON [dbo].[CaseWatcher]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseWatcher_companyId_idx] ON [dbo].[CaseWatcher]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseWatcher_caseId_idx] ON [dbo].[CaseWatcher]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseLink_caseId_idx] ON [dbo].[CaseLink]([caseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseLink_linkedCaseId_idx] ON [dbo].[CaseLink]([linkedCaseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CaseLink_companyId_idx] ON [dbo].[CaseLink]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportJob_companyId_idx] ON [dbo].[ImportJob]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportJob_companyId_createdAt_idx] ON [dbo].[ImportJob]([companyId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportJob_status_idx] ON [dbo].[ImportJob]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportJobRow_importJobId_idx] ON [dbo].[ImportJobRow]([importJobId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportJobRow_importJobId_status_idx] ON [dbo].[ImportJobRow]([importJobId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportJobRow_importJobId_entityType_idx] ON [dbo].[ImportJobRow]([importJobId], [entityType]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportJobRow_accountId_idx] ON [dbo].[ImportJobRow]([accountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportJobRow_recordId_idx] ON [dbo].[ImportJobRow]([recordId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationRule_companyId_event_isActive_idx] ON [dbo].[NotificationRule]([companyId], [event], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationRule_companyId_sortOrder_idx] ON [dbo].[NotificationRule]([companyId], [sortOrder]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationRule_templateId_idx] ON [dbo].[NotificationRule]([templateId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationTemplate_companyId_isActive_idx] ON [dbo].[NotificationTemplate]([companyId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationDispatch_caseId_createdAt_idx] ON [dbo].[NotificationDispatch]([caseId], [createdAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationDispatch_companyId_event_createdAt_idx] ON [dbo].[NotificationDispatch]([companyId], [event], [createdAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationDispatch_companyId_state_idx] ON [dbo].[NotificationDispatch]([companyId], [state]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ActionItem_userId_state_createdAt_idx] ON [dbo].[ActionItem]([userId], [state], [createdAt] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ActionItem_userId_state_actionRequired_idx] ON [dbo].[ActionItem]([userId], [state], [actionRequired]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ActionItem_companyId_kind_state_idx] ON [dbo].[ActionItem]([companyId], [kind], [state]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ActionItem_objectType_objectId_idx] ON [dbo].[ActionItem]([objectType], [objectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ActionItem_state_snoozedUntil_idx] ON [dbo].[ActionItem]([state], [snoozedUntil]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ActionItem_state_updatedAt_idx] ON [dbo].[ActionItem]([state], [updatedAt]);

-- AddForeignKey
ALTER TABLE [dbo].[UserCompany] ADD CONSTRAINT [UserCompany_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[UserCompany] ADD CONSTRAINT [UserCompany_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[FieldDefinition] ADD CONSTRAINT [FieldDefinition_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CompanySettings] ADD CONSTRAINT [CompanySettings_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExternalKbSetting] ADD CONSTRAINT [ExternalKbSetting_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Account] ADD CONSTRAINT [Account_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountCompany] ADD CONSTRAINT [AccountCompany_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountCompany] ADD CONSTRAINT [AccountCompany_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountCompany] ADD CONSTRAINT [AccountCompany_packageId_fkey] FOREIGN KEY ([packageId]) REFERENCES [dbo].[Package]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountProject] ADD CONSTRAINT [AccountProject_accountCompanyId_fkey] FOREIGN KEY ([accountCompanyId]) REFERENCES [dbo].[AccountCompany]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountProduct] ADD CONSTRAINT [AccountProduct_accountCompanyId_fkey] FOREIGN KEY ([accountCompanyId]) REFERENCES [dbo].[AccountCompany]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountProduct] ADD CONSTRAINT [AccountProduct_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[Product]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AccountContact] ADD CONSTRAINT [AccountContact_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Address] ADD CONSTRAINT [Address_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Address] ADD CONSTRAINT [Address_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ProductGroup] ADD CONSTRAINT [ProductGroup_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Product] ADD CONSTRAINT [Product_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Product] ADD CONSTRAINT [Product_productGroupId_fkey] FOREIGN KEY ([productGroupId]) REFERENCES [dbo].[ProductGroup]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Package] ADD CONSTRAINT [Package_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PackageItem] ADD CONSTRAINT [PackageItem_packageId_fkey] FOREIGN KEY ([packageId]) REFERENCES [dbo].[Package]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PackageItem] ADD CONSTRAINT [PackageItem_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[Product]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TaxonomyDef] ADD CONSTRAINT [TaxonomyDef_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TaxonomyDef] ADD CONSTRAINT [TaxonomyDef_parentId_fkey] FOREIGN KEY ([parentId]) REFERENCES [dbo].[TaxonomyDef]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseSolutionStep] ADD CONSTRAINT [CaseSolutionStep_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseSolutionStep] ADD CONSTRAINT [CaseSolutionStep_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Team] ADD CONSTRAINT [Team_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Person] ADD CONSTRAINT [Person_teamId_fkey] FOREIGN KEY ([teamId]) REFERENCES [dbo].[Team]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CategoryDef] ADD CONSTRAINT [CategoryDef_parentId_fkey] FOREIGN KEY ([parentId]) REFERENCES [dbo].[CategoryDef]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CategoryDef] ADD CONSTRAINT [CategoryDef_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SLAPolicy] ADD CONSTRAINT [SLAPolicy_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ChecklistTemplate] ADD CONSTRAINT [ChecklistTemplate_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Case] ADD CONSTRAINT [Case_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Case] ADD CONSTRAINT [Case_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Case] ADD CONSTRAINT [Case_accountProjectId_fkey] FOREIGN KEY ([accountProjectId]) REFERENCES [dbo].[AccountProject]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Case] ADD CONSTRAINT [Case_assignedTeamId_fkey] FOREIGN KEY ([assignedTeamId]) REFERENCES [dbo].[Team]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Case] ADD CONSTRAINT [Case_assignedPersonId_fkey] FOREIGN KEY ([assignedPersonId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Case] ADD CONSTRAINT [Case_thirdPartyId_fkey] FOREIGN KEY ([thirdPartyId]) REFERENCES [dbo].[ThirdParty]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Case] ADD CONSTRAINT [Case_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[Product]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Case] ADD CONSTRAINT [Case_packageId_fkey] FOREIGN KEY ([packageId]) REFERENCES [dbo].[Package]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseReminder] ADD CONSTRAINT [CaseReminder_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseReminder] ADD CONSTRAINT [CaseReminder_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseActivity] ADD CONSTRAINT [CaseActivity_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseNote] ADD CONSTRAINT [CaseNote_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseNote] ADD CONSTRAINT [CaseNote_parentNoteId_fkey] FOREIGN KEY ([parentNoteId]) REFERENCES [dbo].[CaseNote]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseNoteReaction] ADD CONSTRAINT [CaseNoteReaction_noteId_fkey] FOREIGN KEY ([noteId]) REFERENCES [dbo].[CaseNote]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseAttachment] ADD CONSTRAINT [CaseAttachment_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseCallLog] ADD CONSTRAINT [CaseCallLog_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseOfferedSolution] ADD CONSTRAINT [CaseOfferedSolution_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseOfferedSolution] ADD CONSTRAINT [CaseOfferedSolution_solutionDefId_fkey] FOREIGN KEY ([solutionDefId]) REFERENCES [dbo].[OfferedSolutionDef]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseApproval] ADD CONSTRAINT [CaseApproval_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResolutionApprovalPolicy] ADD CONSTRAINT [ResolutionApprovalPolicy_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResolutionApprovalPolicy] ADD CONSTRAINT [ResolutionApprovalPolicy_approverPersonId_fkey] FOREIGN KEY ([approverPersonId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseResolutionApproval] ADD CONSTRAINT [CaseResolutionApproval_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseResolutionApproval] ADD CONSTRAINT [CaseResolutionApproval_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[ResolutionApprovalPolicy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseResolutionApproval] ADD CONSTRAINT [CaseResolutionApproval_expectedApproverPersonId_fkey] FOREIGN KEY ([expectedApproverPersonId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseNotification] ADD CONSTRAINT [CaseNotification_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseMention] ADD CONSTRAINT [CaseMention_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AISuggestion] ADD CONSTRAINT [AISuggestion_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseTransfer] ADD CONSTRAINT [CaseTransfer_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseWatcher] ADD CONSTRAINT [CaseWatcher_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseLink] ADD CONSTRAINT [CaseLink_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CaseLink] ADD CONSTRAINT [CaseLink_linkedCaseId_fkey] FOREIGN KEY ([linkedCaseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ImportJob] ADD CONSTRAINT [ImportJob_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ImportJobRow] ADD CONSTRAINT [ImportJobRow_importJobId_fkey] FOREIGN KEY ([importJobId]) REFERENCES [dbo].[ImportJob]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NotificationRule] ADD CONSTRAINT [NotificationRule_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NotificationRule] ADD CONSTRAINT [NotificationRule_templateId_fkey] FOREIGN KEY ([templateId]) REFERENCES [dbo].[NotificationTemplate]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NotificationTemplate] ADD CONSTRAINT [NotificationTemplate_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NotificationDispatch] ADD CONSTRAINT [NotificationDispatch_caseId_fkey] FOREIGN KEY ([caseId]) REFERENCES [dbo].[Case]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NotificationDispatch] ADD CONSTRAINT [NotificationDispatch_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NotificationDispatch] ADD CONSTRAINT [NotificationDispatch_ruleId_fkey] FOREIGN KEY ([ruleId]) REFERENCES [dbo].[NotificationRule]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NotificationDispatch] ADD CONSTRAINT [NotificationDispatch_templateId_fkey] FOREIGN KEY ([templateId]) REFERENCES [dbo].[NotificationTemplate]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

-- ── Filtered unique indexes ──
-- Filtered unique (MSSQL: NULL satırlar uniqueness dışı)
CREATE UNIQUE NONCLUSTERED INDEX [CaseSolutionStep_caseId_source_sourceRef_key] ON [dbo].[CaseSolutionStep]([caseId],[source],[sourceRef]) WHERE [sourceRef] IS NOT NULL;
-- Filtered unique (MSSQL: NULL satırlar uniqueness dışı)
CREATE UNIQUE NONCLUSTERED INDEX [NotificationDispatch_idempotencyKey_unique] ON [dbo].[NotificationDispatch]([idempotencyKey]) WHERE [idempotencyKey] IS NOT NULL;
-- Filtered unique (MSSQL: NULL satırlar uniqueness dışı)
CREATE UNIQUE NONCLUSTERED INDEX [ActionItem_dedupKey_key] ON [dbo].[ActionItem]([dedupKey]) WHERE [dedupKey] IS NOT NULL;
-- Filtered unique (MSSQL: NULL satırlar uniqueness dışı)
CREATE UNIQUE NONCLUSTERED INDEX [Account_tcknHash_key] ON [dbo].[Account]([tcknHash]) WHERE [tcknHash] IS NOT NULL;
-- Filtered unique (MSSQL: NULL satırlar uniqueness dışı)
CREATE UNIQUE NONCLUSTERED INDEX [Account_vkn_key] ON [dbo].[Account]([vkn]) WHERE [vkn] IS NOT NULL;
-- Filtered unique (MSSQL: NULL satırlar uniqueness dışı)
CREATE UNIQUE NONCLUSTERED INDEX [AccountCompany_companyId_externalCustomerCode_key] ON [dbo].[AccountCompany]([companyId],[externalCustomerCode]) WHERE [externalCustomerCode] IS NOT NULL;
-- Filtered unique (MSSQL: NULL satırlar uniqueness dışı)
CREATE UNIQUE NONCLUSTERED INDEX [AccountProduct_accountCompanyId_productCode_key] ON [dbo].[AccountProduct]([accountCompanyId],[productCode]) WHERE [productCode] IS NOT NULL;
-- Filtered unique (MSSQL: NULL satırlar uniqueness dışı)
CREATE UNIQUE NONCLUSTERED INDEX [User_personId_key] ON [dbo].[User]([personId]) WHERE [personId] IS NOT NULL;

-- ── CHECK constraints (enum değer setleri) ──
ALTER TABLE [Case] ADD CONSTRAINT [CK_Case_aiPriorityPrediction] CHECK ([aiPriorityPrediction]=N'Critical' OR [aiPriorityPrediction]=N'High' OR [aiPriorityPrediction]=N'Medium' OR [aiPriorityPrediction]=N'Low');
ALTER TABLE [Case] ADD CONSTRAINT [CK_Case_approvalState] CHECK ([approvalState]=N'Cancelled' OR [approvalState]=N'Rejected' OR [approvalState]=N'Approved' OR [approvalState]=N'Pending');
ALTER TABLE [Case] ADD CONSTRAINT [CK_Case_caseType] CHECK ([caseType]=N'Churn' OR [caseType]=N'ProactiveTracking' OR [caseType]=N'GeneralSupport');
ALTER TABLE [Case] ADD CONSTRAINT [CK_Case_escalationLevel] CHECK ([escalationLevel]=N'UstYonetim' OR [escalationLevel]=N'Direktor' OR [escalationLevel]=N'TakimLideri' OR [escalationLevel]=N'Yok');
ALTER TABLE [Case] ADD CONSTRAINT [CK_Case_origin] CHECK ([origin]=N'Diger' OR [origin]=N'Chatbot' OR [origin]=N'Web' OR [origin]=N'Eposta' OR [origin]=N'Telefon');
ALTER TABLE [Case] ADD CONSTRAINT [CK_Case_priority] CHECK ([priority]=N'Critical' OR [priority]=N'High' OR [priority]=N'Medium' OR [priority]=N'Low');
ALTER TABLE [Case] ADD CONSTRAINT [CK_Case_requestType] CHECK ([requestType]=N'Hata' OR [requestType]=N'Sikayet' OR [requestType]=N'Talep' OR [requestType]=N'Oneri' OR [requestType]=N'Bilgi');
ALTER TABLE [Case] ADD CONSTRAINT [CK_Case_snoozePreviousStatus] CHECK ([snoozePreviousStatus]=N'IptalEdildi' OR [snoozePreviousStatus]=N'YenidenAcildi' OR [snoozePreviousStatus]=N'Cozuldu' OR [snoozePreviousStatus]=N'Eskalasyon' OR [snoozePreviousStatus]=N'ThirdPartyWaiting' OR [snoozePreviousStatus]=N'Incelemede' OR [snoozePreviousStatus]=N'Acik');
ALTER TABLE [Case] ADD CONSTRAINT [CK_Case_status] CHECK ([status]=N'IptalEdildi' OR [status]=N'YenidenAcildi' OR [status]=N'Cozuldu' OR [status]=N'Eskalasyon' OR [status]=N'ThirdPartyWaiting' OR [status]=N'Incelemede' OR [status]=N'Acik');
ALTER TABLE [Case] ADD CONSTRAINT [CK_Case_supportLevel] CHECK ([supportLevel]=N'Expert' OR [supportLevel]=N'L3' OR [supportLevel]=N'L2' OR [supportLevel]=N'L1');
ALTER TABLE [CaseResolutionApproval] ADD CONSTRAINT [CK_CaseResolutionApproval_state] CHECK ([state]=N'Cancelled' OR [state]=N'Rejected' OR [state]=N'Approved' OR [state]=N'Pending');
ALTER TABLE [FieldDefinition] ADD CONSTRAINT [CK_FieldDefinition_caseType] CHECK ([caseType]=N'Churn' OR [caseType]=N'ProactiveTracking' OR [caseType]=N'GeneralSupport');
ALTER TABLE [Package] ADD CONSTRAINT [CK_Package_supportLevel] CHECK ([supportLevel]=N'Expert' OR [supportLevel]=N'L3' OR [supportLevel]=N'L2' OR [supportLevel]=N'L1');
ALTER TABLE [Person] ADD CONSTRAINT [CK_Person_supportLevel] CHECK ([supportLevel]=N'Expert' OR [supportLevel]=N'L3' OR [supportLevel]=N'L2' OR [supportLevel]=N'L1');
ALTER TABLE [Product] ADD CONSTRAINT [CK_Product_supportLevel] CHECK ([supportLevel]=N'Expert' OR [supportLevel]=N'L3' OR [supportLevel]=N'L2' OR [supportLevel]=N'L1');
ALTER TABLE [SLAPolicy] ADD CONSTRAINT [CK_SLAPolicy_requestType] CHECK ([requestType]=N'Hata' OR [requestType]=N'Sikayet' OR [requestType]=N'Talep' OR [requestType]=N'Oneri' OR [requestType]=N'Bilgi');
ALTER TABLE [Team] ADD CONSTRAINT [CK_Team_defaultSupportLevel] CHECK ([defaultSupportLevel]=N'Expert' OR [defaultSupportLevel]=N'L3' OR [defaultSupportLevel]=N'L2' OR [defaultSupportLevel]=N'L1');
ALTER TABLE [User] ADD CONSTRAINT [CK_User_role] CHECK ([role]=N'SystemAdmin' OR [role]=N'Admin' OR [role]=N'CSM' OR [role]=N'Supervisor' OR [role]=N'Backoffice' OR [role]=N'Agent');
ALTER TABLE [UserCompany] ADD CONSTRAINT [CK_UserCompany_role] CHECK ([role]=N'SystemAdmin' OR [role]=N'Admin' OR [role]=N'Supervisor' OR [role]=N'Agent');
