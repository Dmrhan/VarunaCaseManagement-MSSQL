/**
 * OTOMATİK ÜRETİLDİ — elle düzenleme; kaynak: prisma/schema.prisma
 * Yeniden üretmek için: node scripts/generate-json-field-map.mjs
 *
 * MSSQL'de Prisma Json tipi yok; eski Json alanlar String (nvarchar(max)).
 * Bu harita client.js'teki extension'a hangi alanların JSON.parse/stringify
 * edileceğini ve nested write'larda hangi ilişkiden hangi modele
 * geçildiğini söyler.
 */
export const JSON_FIELD_MAP = {
  "User": {
    "json": [],
    "relations": {
      "companies": "UserCompany",
      "reminders": "CaseReminder",
      "reportViews": "ReportView",
      "teamsCreated": "Team",
      "teamsUpdated": "Team",
      "categoriesCreated": "CategoryDef",
      "categoriesUpdated": "CategoryDef",
      "slaPoliciesCreated": "SLAPolicy",
      "slaPoliciesUpdated": "SLAPolicy",
      "fieldDefinitionsCreated": "FieldDefinition",
      "fieldDefinitionsUpdated": "FieldDefinition",
      "taxonomyDefsCreated": "TaxonomyDef",
      "taxonomyDefsUpdated": "TaxonomyDef",
      "checklistTemplatesCreated": "ChecklistTemplate",
      "checklistTemplatesUpdated": "ChecklistTemplate",
      "caseActivities": "CaseActivity",
      "caseAttachmentsAsUploader": "CaseAttachment",
      "authorizationPoliciesCreated": "AuthorizationPolicy",
      "authorizationPoliciesUpdated": "AuthorizationPolicy",
      "casesArchived": "Case",
      "casesCreated": "Case",
      "caseEmailsSent": "CaseEmail"
    }
  },
  "UserCompany": {
    "json": [],
    "relations": {
      "user": "User",
      "company": "Company"
    }
  },
  "Company": {
    "json": [],
    "relations": {
      "accounts": "Account",
      "accountCompanies": "AccountCompany",
      "addresses": "Address",
      "teams": "Team",
      "cases": "Case",
      "slaPolicies": "SLAPolicy",
      "categories": "CategoryDef",
      "checklists": "ChecklistTemplate",
      "fieldDefinitions": "FieldDefinition",
      "settings": "CompanySettings",
      "userCompanies": "UserCompany",
      "productGroups": "ProductGroup",
      "products": "Product",
      "packages": "Package",
      "externalKbSetting": "ExternalKbSetting",
      "externalDevOpsSetting": "ExternalDevOpsSetting",
      "externalMailSetting": "ExternalMailSetting",
      "externalMailFromAliases": "ExternalMailSettingFromAlias",
      "externalMailInboxes": "ExternalMailInbox",
      "learnedSenderAccounts": "LearnedSenderAccount",
      "caseEmails": "CaseEmail",
      "importJobs": "ImportJob",
      "resolutionApprovalPolicies": "ResolutionApprovalPolicy",
      "notificationRules": "NotificationRule",
      "notificationTemplates": "NotificationTemplate",
      "notificationDispatches": "NotificationDispatch",
      "caseEmailTemplates": "CaseEmailTemplate",
      "taxonomies": "TaxonomyDef",
      "solutionSteps": "CaseSolutionStep",
      "reportViews": "ReportView",
      "authorizationPolicies": "AuthorizationPolicy",
      "thirdParties": "ThirdParty",
      "workCalendar": "WorkCalendar",
      "holidays": "Holiday",
      "caseNumberCounter": "CaseNumberCounter"
    }
  },
  "CaseNumberCounter": {
    "json": [],
    "relations": {
      "company": "Company"
    }
  },
  "FieldDefinition": {
    "json": [
      "options"
    ],
    "relations": {
      "company": "Company",
      "createdBy": "User",
      "updatedBy": "User"
    }
  },
  "CompanySettings": {
    "json": [],
    "relations": {
      "company": "Company"
    }
  },
  "ExternalKbSetting": {
    "json": [],
    "relations": {
      "company": "Company"
    }
  },
  "ExternalDevOpsSetting": {
    "json": [],
    "relations": {
      "company": "Company"
    }
  },
  "ExternalMailSetting": {
    "json": [],
    "relations": {
      "company": "Company",
      "fromAliases": "ExternalMailSettingFromAlias"
    }
  },
  "ExternalMailSettingFromAlias": {
    "json": [],
    "relations": {
      "company": "Company",
      "setting": "ExternalMailSetting"
    }
  },
  "ExternalMailInbox": {
    "json": [],
    "relations": {
      "company": "Company",
      "team": "Team"
    }
  },
  "CaseEmailTemplate": {
    "json": [],
    "relations": {
      "company": "Company"
    }
  },
  "LearnedSenderAccount": {
    "json": [],
    "relations": {
      "company": "Company",
      "account": "Account"
    }
  },
  "Account": {
    "json": [],
    "relations": {
      "company": "Company",
      "cases": "Case",
      "companies": "AccountCompany",
      "contacts": "AccountContact",
      "addresses": "Address",
      "learnedSenderAccounts": "LearnedSenderAccount",
      "anaFirmaProjects": "AccountProject"
    }
  },
  "AccountCompany": {
    "json": [],
    "relations": {
      "account": "Account",
      "company": "Company",
      "package": "Package",
      "products": "AccountProduct",
      "projects": "AccountProject"
    }
  },
  "AccountProject": {
    "json": [],
    "relations": {
      "accountCompany": "AccountCompany",
      "anaFirma": "Account",
      "cases": "Case"
    }
  },
  "AccountProduct": {
    "json": [],
    "relations": {
      "accountCompany": "AccountCompany",
      "product": "Product"
    }
  },
  "AccountContact": {
    "json": [],
    "relations": {
      "account": "Account"
    }
  },
  "Address": {
    "json": [],
    "relations": {
      "account": "Account",
      "company": "Company"
    }
  },
  "ProductGroup": {
    "json": [],
    "relations": {
      "company": "Company",
      "products": "Product"
    }
  },
  "Product": {
    "json": [],
    "relations": {
      "company": "Company",
      "productGroup": "ProductGroup",
      "packageItems": "PackageItem",
      "cases": "Case",
      "accountProducts": "AccountProduct"
    }
  },
  "Package": {
    "json": [],
    "relations": {
      "company": "Company",
      "items": "PackageItem",
      "accountCompanies": "AccountCompany",
      "cases": "Case"
    }
  },
  "PackageItem": {
    "json": [],
    "relations": {
      "package": "Package",
      "product": "Product"
    }
  },
  "TaxonomyDef": {
    "json": [
      "metadata"
    ],
    "relations": {
      "company": "Company",
      "parent": "TaxonomyDef",
      "children": "TaxonomyDef",
      "createdBy": "User",
      "updatedBy": "User"
    }
  },
  "CaseSolutionStep": {
    "json": [],
    "relations": {
      "case": "Case",
      "company": "Company"
    }
  },
  "Team": {
    "json": [],
    "relations": {
      "company": "Company",
      "members": "Person",
      "cases": "Case",
      "createdBy": "User",
      "updatedBy": "User",
      "mailInboxes": "ExternalMailInbox"
    }
  },
  "Person": {
    "json": [],
    "relations": {
      "team": "Team",
      "cases": "Case",
      "resolutionApprovalPolicies": "ResolutionApprovalPolicy",
      "resolutionApprovalsAsApprover": "CaseResolutionApproval"
    }
  },
  "ThirdParty": {
    "json": [],
    "relations": {
      "company": "Company",
      "cases": "Case"
    }
  },
  "DocumentType": {
    "json": [],
    "relations": {}
  },
  "CategoryDef": {
    "json": [],
    "relations": {
      "parent": "CategoryDef",
      "children": "CategoryDef",
      "company": "Company",
      "createdBy": "User",
      "updatedBy": "User"
    }
  },
  "OfferedSolutionDef": {
    "json": [],
    "relations": {
      "caseOffers": "CaseOfferedSolution"
    }
  },
  "SLAPolicy": {
    "json": [],
    "relations": {
      "company": "Company",
      "createdBy": "User",
      "updatedBy": "User"
    }
  },
  "WorkCalendar": {
    "json": [
      "workDays"
    ],
    "relations": {
      "company": "Company",
      "holidays": "Holiday"
    }
  },
  "Holiday": {
    "json": [],
    "relations": {
      "calendar": "WorkCalendar",
      "company": "Company"
    }
  },
  "ChecklistTemplate": {
    "json": [
      "items"
    ],
    "relations": {
      "company": "Company",
      "createdBy": "User",
      "updatedBy": "User"
    }
  },
  "Case": {
    "json": [
      "offeredSolutions",
      "checklistItems",
      "customFields"
    ],
    "relations": {
      "company": "Company",
      "account": "Account",
      "accountProject": "AccountProject",
      "assignedTeam": "Team",
      "assignedPerson": "Person",
      "createdBy": "User",
      "thirdParty": "ThirdParty",
      "product": "Product",
      "package": "Package",
      "archivedByUser": "User",
      "notes": "CaseNote",
      "attachments": "CaseAttachment",
      "history": "CaseActivity",
      "callLogs": "CaseCallLog",
      "caseOffers": "CaseOfferedSolution",
      "approvals": "CaseApproval",
      "resolutionApprovals": "CaseResolutionApproval",
      "notificationDispatches": "NotificationDispatch",
      "notifications": "CaseNotification",
      "aiSuggestions": "AISuggestion",
      "mentions": "CaseMention",
      "reminders": "CaseReminder",
      "transfers": "CaseTransfer",
      "watchers": "CaseWatcher",
      "taggingReview": "CaseTaggingReview",
      "outgoingLinks": "CaseLink",
      "incomingLinks": "CaseLink",
      "solutionSteps": "CaseSolutionStep",
      "caseEmails": "CaseEmail"
    }
  },
  "CaseReminder": {
    "json": [],
    "relations": {
      "case": "Case",
      "user": "User"
    }
  },
  "CaseActivity": {
    "json": [],
    "relations": {
      "case": "Case",
      "actorUser": "User"
    }
  },
  "CaseNote": {
    "json": [],
    "relations": {
      "case": "Case",
      "parent": "CaseNote",
      "replies": "CaseNote",
      "reactions": "CaseNoteReaction"
    }
  },
  "CaseNoteReaction": {
    "json": [],
    "relations": {
      "note": "CaseNote"
    }
  },
  "MetricQueryAudit": {
    "json": [],
    "relations": {}
  },
  "CaseAttachment": {
    "json": [],
    "relations": {
      "case": "Case",
      "uploadedByUser": "User"
    }
  },
  "CaseCallLog": {
    "json": [],
    "relations": {
      "case": "Case"
    }
  },
  "CaseOfferedSolution": {
    "json": [],
    "relations": {
      "case": "Case",
      "solution": "OfferedSolutionDef"
    }
  },
  "CaseApproval": {
    "json": [],
    "relations": {
      "case": "Case"
    }
  },
  "ResolutionApprovalPolicy": {
    "json": [
      "matchScope"
    ],
    "relations": {
      "company": "Company",
      "approverPerson": "Person",
      "approvals": "CaseResolutionApproval"
    }
  },
  "CaseResolutionApproval": {
    "json": [],
    "relations": {
      "case": "Case",
      "policy": "ResolutionApprovalPolicy",
      "expectedApprover": "Person"
    }
  },
  "CaseNotification": {
    "json": [
      "payload"
    ],
    "relations": {
      "case": "Case"
    }
  },
  "KnowledgeSource": {
    "json": [],
    "relations": {}
  },
  "QAScoreLog": {
    "json": [],
    "relations": {}
  },
  "PatternAlert": {
    "json": [
      "caseIds",
      "aiHypothesis"
    ],
    "relations": {}
  },
  "AIUsageLog": {
    "json": [],
    "relations": {}
  },
  "CaseMention": {
    "json": [],
    "relations": {
      "case": "Case"
    }
  },
  "AISuggestion": {
    "json": [],
    "relations": {
      "case": "Case"
    }
  },
  "CaseTransfer": {
    "json": [],
    "relations": {
      "case": "Case"
    }
  },
  "CaseTaggingReview": {
    "json": [],
    "relations": {
      "case": "Case"
    }
  },
  "CaseWatcher": {
    "json": [],
    "relations": {
      "case": "Case"
    }
  },
  "CaseLink": {
    "json": [],
    "relations": {
      "case": "Case",
      "linkedCase": "Case"
    }
  },
  "ImportJob": {
    "json": [
      "summaryJson",
      "entityCountsJson"
    ],
    "relations": {
      "company": "Company",
      "rows": "ImportJobRow"
    }
  },
  "ImportJobRow": {
    "json": [
      "errorsJson",
      "warningsJson",
      "rawJson",
      "normalizedJson",
      "beforeJson",
      "afterJson"
    ],
    "relations": {
      "importJob": "ImportJob"
    }
  },
  "NotificationRule": {
    "json": [
      "conditions",
      "audience"
    ],
    "relations": {
      "company": "Company",
      "template": "NotificationTemplate",
      "dispatches": "NotificationDispatch"
    }
  },
  "NotificationTemplate": {
    "json": [
      "requiredVariables"
    ],
    "relations": {
      "company": "Company",
      "rules": "NotificationRule",
      "dispatches": "NotificationDispatch"
    }
  },
  "NotificationDispatch": {
    "json": [],
    "relations": {
      "case": "Case",
      "company": "Company",
      "rule": "NotificationRule",
      "template": "NotificationTemplate",
      "caseEmails": "CaseEmail"
    }
  },
  "CaseEmail": {
    "json": [],
    "relations": {
      "case": "Case",
      "company": "Company",
      "sentBy": "User",
      "dispatch": "NotificationDispatch",
      "attachments": "CaseEmailAttachment"
    }
  },
  "CaseEmailAttachment": {
    "json": [],
    "relations": {
      "email": "CaseEmail"
    }
  },
  "ActionItem": {
    "json": [],
    "relations": {}
  },
  "ReportView": {
    "json": [],
    "relations": {
      "owner": "User",
      "company": "Company"
    }
  },
  "AuthorizationPolicy": {
    "json": [
      "filterJson"
    ],
    "relations": {
      "company": "Company",
      "createdBy": "User",
      "updatedBy": "User"
    }
  }
};
