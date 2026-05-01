/**
 * Lookup Bootstrap — frontend açılışında BFF'ten /api/lookups/bootstrap'ı bir kez
 * çeker, global cache'e koyar. lookupService bu cache'i sync olarak okur.
 *
 * Bu pattern lookupService'in 26 farklı çağrı noktasını async refactor'una sokmadan
 * USE_MOCK=false geçişini mümkün kılıyor.
 *
 * Kullanım:
 *   1. App boot'ta `await loadBootstrap()` (LookupGate component'i bunu yapar)
 *   2. Sayfalar `lookupService.X()` ile sync okur (mevcut kullanım korunur)
 */

import type {
  CaseCompany,
  CasePerson,
  CaseTeam,
  CaseThirdParty,
  CaseDocumentType,
  OfferedSolutionDef,
  SlaPolicy,
  CaseChecklistTemplate,
} from '@/features/cases/types';
import type { CaseAccount } from '@/mocks/caseMockData';
import type { FieldDefinition } from '@/services/adminService';
import { getAccessToken } from './supabase';

interface CategoryShape {
  id: string;
  name: string;
  isActive: boolean;
  subCategories: { id: string; name: string; isActive: boolean }[];
}

export interface BootstrapData {
  companies: CaseCompany[];
  accounts: CaseAccount[];
  teams: CaseTeam[];
  persons: CasePerson[];
  thirdParties: CaseThirdParty[];
  documentTypes: CaseDocumentType[];
  categories: CategoryShape[];
  offeredSolutions: OfferedSolutionDef[];
  slaPolicies: SlaPolicy[];
  checklists: CaseChecklistTemplate[];
  productGroups: string[];
  fieldDefinitions: FieldDefinition[];
}

let cache: BootstrapData | null = null;
let inflight: Promise<BootstrapData> | null = null;

export async function loadBootstrap(options?: { force?: boolean }): Promise<BootstrapData> {
  if (options?.force) {
    cache = null;
    inflight = null;
  }
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const token = await getAccessToken();
    const r = await fetch('/api/lookups/bootstrap', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error(`Bootstrap başarısız: ${r.status}`);
    const data = (await r.json()) as BootstrapData;
    cache = data;
    return data;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/** lookupService'in sync okuduğu cache. App boot edilmeden önce undefined'dır. */
export function getBootstrap(): BootstrapData | null {
  return cache;
}

/** Test ya da admin mutasyonu sonrası invalidation. */
export function clearBootstrap(): void {
  cache = null;
}
