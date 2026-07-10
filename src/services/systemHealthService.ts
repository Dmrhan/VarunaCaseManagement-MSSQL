/**
 * systemHealthService — Sistem Sağlığı panosu (Faz 2) veri katmanı.
 * GET /api/system/health — SystemAdmin JWT ile (route çift kimlikli;
 * Zabbix aynı ucu X-Health-Token ile çeker). Payload sözleşmesi:
 * server/lib/systemHealth.js (schemaVersion 1).
 */
import { apiFetch } from './caseService';

export interface HealthCronRun {
  name: string;
  expr: string;
  lastStartAt: string | null;
  lastEndAt: string | null;
  ok: boolean | null;
  note: string;
}

export interface SystemHealth {
  schemaVersion: number;
  process: {
    uptimeSec: number;
    memoryRssMb: number;
    nodeVersion: string;
    serverTimeUtc: string;
  } & { error?: string };
  dispatch: {
    pendingCount: number;
    oldestPendingAgeMin: number;
    failed24h: number;
    error?: string;
  };
  mail: {
    inbound24h: number;
    outbound24h: number;
    lastInboundAgeMin: number;
    casesCreatedLast5m: number;
    /** #516 sonrası ad; öncesinde activeInboxCount (toleranslı okunur) */
    pollableInboxCount?: number;
    activeInboxCount?: number;
    imapPollIntervalSec: number;
    error?: string;
  };
  storage: {
    emailAttachmentCount: number;
    emailAttachmentBytes: number;
    caseAttachmentCount: number;
    caseAttachmentBytes: number;
    diskTotalBytes: number | null;
    diskFreeBytes: number | null;
    diskFreePct: number | null;
    error?: string;
  };
  db: {
    dataFileMb: number | null;
    logFileMb: number | null;
    caseCount: number;
    caseEmailCount: number;
    error?: string;
  };
  crons: HealthCronRun[];
  env: {
    appPublicBaseUrlSet: boolean;
    imapPollingEnabled: boolean;
    storageRootWritable: boolean;
    zabbixConfigured: boolean;
    error?: string;
  };
}

export async function getSystemHealth(): Promise<SystemHealth | undefined> {
  return apiFetch<SystemHealth>('/api/system/health', undefined, { silent: true });
}
