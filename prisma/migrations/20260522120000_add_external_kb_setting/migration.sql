-- WR-KB1 — Dış Bilgi Bankası entegrasyon tanımları (admin-only config).
-- Yalnızca CRUD/admin ekranı; API çağrısı veya secret depolama YOKTUR.

CREATE TABLE "ExternalKbSetting" (
  "id"                 TEXT NOT NULL,
  "companyId"          TEXT NOT NULL,
  "enabled"            BOOLEAN NOT NULL DEFAULT false,
  "providerName"       TEXT,
  "baseUrl"            TEXT,
  "askEndpointPath"    TEXT NOT NULL DEFAULT '/ask',
  "searchEndpointPath" TEXT NOT NULL DEFAULT '/search',
  "authType"           TEXT NOT NULL DEFAULT 'none',
  "apiKeySecretName"   TEXT,
  "timeoutMs"          INTEGER NOT NULL DEFAULT 15000,
  "defaultTopK"        INTEGER NOT NULL DEFAULT 5,
  "showCitations"      BOOLEAN NOT NULL DEFAULT true,
  "allowAgentUse"      BOOLEAN NOT NULL DEFAULT true,
  "allowSupervisorUse" BOOLEAN NOT NULL DEFAULT true,
  "allowCsmUse"        BOOLEAN NOT NULL DEFAULT true,
  "notes"              TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalKbSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalKbSetting_companyId_key" ON "ExternalKbSetting"("companyId");
CREATE INDEX "ExternalKbSetting_companyId_enabled_idx" ON "ExternalKbSetting"("companyId", "enabled");

ALTER TABLE "ExternalKbSetting"
  ADD CONSTRAINT "ExternalKbSetting_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
