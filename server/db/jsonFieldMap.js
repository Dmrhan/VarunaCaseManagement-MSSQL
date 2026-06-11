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
      "reminders": "CaseReminder"
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
      "importJobs": "ImportJob",
      "resolutionApprovalPolicies": "ResolutionApprovalPolicy",
      "notificationRules": "NotificationRule",
      "notificationTemplates": "NotificationTemplate",
      "notificationDispatches": "NotificationDispatch",
      "taxonomies": "TaxonomyDef",
      "solutionSteps": "CaseSolutionStep"
    }
  },
  "FieldDefinition": {
    "json": [
      "options"
    ],
    "relations": {
      "company": "Company"
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
  "Account": {
    "json": [],
    "relations": {
      "company": "Company",
      "cases": "Case",
      "companies": "AccountCompany",
      "contacts": "AccountContact",
      "addresses": "Address"
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
      "children": "TaxonomyDef"
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
      "cases": "Case"
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
      "company": "Company"
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
      "company": "Company"
    }
  },
  "ChecklistTemplate": {
    "json": [
      "items"
    ],
    "relations": {
      "company": "Company"
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
      "thirdParty": "ThirdParty",
      "product": "Product",
      "package": "Package",
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
      "outgoingLinks": "CaseLink",
      "incomingLinks": "CaseLink",
      "solutionSteps": "CaseSolutionStep"
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
      "case": "Case"
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
      "case": "Case"
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
      "caseIds"
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
      "template": "NotificationTemplate"
    }
  },
  "ActionItem": {
    "json": [],
    "relations": {}
  }
};
