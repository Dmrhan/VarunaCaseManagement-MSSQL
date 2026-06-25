/**
 * PR-D3 — Case Detail "Azure DevOps İş Öğeleri" section.
 *
 * Spec: docs/DEVOPS_INTEGRATION.md §8.
 *
 * Davranış:
 *  - Mount: GET /api/cases/:id/devops-items (devopsService) → çoklu kart render
 *  - Boş durum: "Bağlı DevOps iş öğesi yok" + Bağla button (Agent+)
 *  - Her kart: #ID · State rozeti · Title · "DevOps'ta aç" · Kaldır
 *             + 16 alan 2-kolon sıkı ızgara (FIELD_LABELS friendly TR)
 *  - Stale (TFS down): kartlar sönük + "Sync hatası — son güncelleme X" badge
 *  - Bağla modal: tek input (id veya TFS URL) → POST → liste yenile
 *  - Kaldır: confirm → DELETE → liste yenile
 *
 * Görsel dil: CaseDetailPage'in Section.structured variant'ı ile birebir
 * uyumlu (Cila-4 baseline) — hafif başlık şeridi + bg-white içerik +
 * ring-1 ring-slate-100 hairline çerçeve.
 *
 * Yetki:
 *  - Liste: read role-gate backend'de (assertCaseInScopeForRead)
 *  - Bağla/Kaldır: case-write (Agent+) — UI tarafından rol filtresi
 *    (uygulama kapısı backend'de mevcut)
 *
 * Güvenlik: PAT/secret frontend'e inmez. devopsService sadece Varuna BFF
 * çağırır. Backend allowlist guard (Description/ReproSteps yok) korunur.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Link2, Loader2, RefreshCw, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { devopsService, type DevopsItem, type DevopsItemsResponse } from '@/services/devopsService';

interface DevOpsSectionProps {
  caseId: string;
  /**
   * UI display rolü — Bağla/Kaldır aksiyonu görünürlük gating'i için.
   * Backend her durumda kendi rol guard'ını uygular (Agent+ yazma).
   */
  canWrite: boolean;
}

/**
 * 16 allowlist alanı → UI'da gösterilen TR friendly label.
 * Sırası UI grid'inde renderlanır. id/url/title/state üst başlık satırında
 * gösterilir; gridde tekrar değil.
 */
const FIELD_TR_LABELS: Array<{ key: keyof DevopsItem; label: string }> = [
  { key: 'project', label: 'Proje' },
  { key: 'type', label: 'Tip' },
  { key: 'assignee', label: 'Atanan' },
  { key: 'packageType', label: 'Paket Tipi' },
  { key: 'projectLayer', label: 'Katman' },
  { key: 'extraField4', label: 'Kaynak' },
  { key: 'foundIn', label: 'Bulunan Sürüm' },
  { key: 'foundInRelease', label: 'Release' },
  { key: 'rootCause', label: 'Kök Neden' },
  { key: 'bugGroup', label: 'Hata Grubu' },
  { key: 'createdDate', label: 'Oluşturma' },
  { key: 'resolvedDate', label: 'Çözüm' },
  { key: 'closedDate', label: 'Kapanma' },
];

// TFS state'i için sakin rozet renkleri. NOT: TFS work item state'i —
// Varuna case status'u DEĞİL. Kullanıcıya karıştırmamak için "TFS:" prefix
// kullanmıyoruz ama tooltip ekliyoruz.
function stateBadgeClasses(state: string | null): string {
  if (!state) return 'bg-slate-100 text-slate-600';
  const s = state.toLowerCase();
  if (s === 'active' || s === 'proposed' || s === 'new') return 'bg-blue-50 text-blue-700';
  if (s === 'resolved' || s === 'committed') return 'bg-amber-50 text-amber-800';
  if (s === 'closed' || s === 'done') return 'bg-emerald-50 text-emerald-700';
  if (s === 'removed' || s === 'cut') return 'bg-slate-100 text-slate-500 line-through';
  return 'bg-slate-100 text-slate-600';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '—';
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export function DevOpsSection({ caseId, canWrite }: DevOpsSectionProps) {
  const { toast } = useToast();
  const [data, setData] = useState<DevopsItemsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linking, setLinking] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);

  // Codex P1 fix — current-case ref + monotonic token (iki katman).
  //
  // Bug evrim:
  //  #150 — requestedCaseIdRef = caseId (kendi closure'undan): handleLink
  //         tamamlanır → eski A closure `void load()` → ref'i A'ya yazar
  //         → guard self-reset.
  //  #151 — monotonic ++token: eski A closure'ın `void load()` ÇAĞRISI
  //         token'ı kendine ARTIRIR (myToken = en yeni) → A response
  //         guard'ı geçer, inflight B response discard edilir → "A items
  //         B detayında" bug HÂLÂ var.
  //
  // Bu fix: current-case ref'i useEffect ile **prop'tan** sync ederiz;
  // closure'lar onu **OKUR**, **ASLA GÜNCELLEYEMEZ**. load() içinde
  // başında + response sonrası bu ref'i kontrol ederiz. Eski caseId=A
  // closure'ın `void load()` çağrısı, currentCaseIdRef.current === B
  // gördüğünde HİÇ token almadan return eder; B response bozulmaz.
  //
  // Monotonic token ekstra emniyet: aynı caseId içinde hızlı arka-arkaya
  // load (örn handleLink success → load + ardından manuel refresh) — son
  // response kazanır, eski response stale olarak discard.
  const currentCaseIdRef = useRef(caseId);
  const requestTokenRef = useRef(0);

  // currentCaseIdRef yalnız caseId prop değişince güncellenir; başka kimse
  // (handler/closure) yazmaz. Closure'lar OKUR ve eski case'in load'unu
  // erken iptal eder.
  useEffect(() => {
    currentCaseIdRef.current = caseId;
  }, [caseId]);

  const load = useCallback(async () => {
    // EARLY-RETURN: bu closure'ın caseId'i artık güncel değilse hiç başlama
    // (token bile alma — Codex P1 fix).
    if (currentCaseIdRef.current !== caseId) return;
    const myToken = ++requestTokenRef.current;
    setLoading(true);
    const res = await devopsService.getItems(caseId);
    // Response sonrası ikili guard:
    //  - caseId hâlâ güncel mi? (eski case'in inflight load'u olabilir)
    //  - token hâlâ en yeni mi? (aynı case'te yeni load başlatıldıysa)
    if (currentCaseIdRef.current !== caseId) return;
    if (requestTokenRef.current !== myToken) return;
    setLoading(false);
    if (res) setData(res);
  }, [caseId]);

  // caseId değişince eski case'in item'larını gizle ANINDA + token++ ile
  // bu noktada inflight olan kendi-case'i-uyumlu load'ları da invalidate
  // et (handleLink → setLinking → o sırada caseId değişirse).
  useEffect(() => {
    requestTokenRef.current += 1;
    setData(null);
    setLinkModalOpen(false);
    setLinkInput('');
    setUnlinkingId(null);
    void load();
  }, [caseId, load]);

  async function handleLink() {
    const ref = linkInput.trim();
    if (!ref) {
      toast({ type: 'warn', message: 'Work item id veya TFS URL gerekli.' });
      return;
    }
    setLinking(true);
    const updated = await devopsService.link(caseId, ref);
    setLinking(false);
    if (!updated) return; // toast apiFetch içinde
    setLinkModalOpen(false);
    setLinkInput('');
    toast({ type: 'success', title: 'Bağlandı', message: 'DevOps iş öğesi vakaya bağlandı.', duration: 2000 });
    void load();
  }

  async function handleUnlink(item: DevopsItem) {
    const id = item.id;
    if (!id) return;
    if (!window.confirm(`#${id} bağını kaldırmak istediğinizden emin misiniz?`)) return;
    setUnlinkingId(id);
    const updated = await devopsService.unlink(caseId, id);
    setUnlinkingId(null);
    if (!updated) return;
    toast({ type: 'success', title: 'Kaldırıldı', message: `#${id} bağı kaldırıldı.`, duration: 2000 });
    void load();
  }

  const items = data?.items ?? [];
  const isStale = !!data?.stale;
  const isEmpty = !loading && items.length === 0;

  return (
    // Section.structured ile aynı görsel dil (Cila-4 baseline)
    <section className="overflow-hidden rounded-md ring-1 ring-slate-100 dark:ring-ndark-border">
      <div className="flex items-center justify-between bg-slate-50/40 px-3 py-1.5 dark:bg-ndark-bg/40">
        <h3 className="text-xs font-medium text-slate-500 dark:text-ndark-muted">
          Azure DevOps İş Öğeleri
          {items.length > 0 && (
            <span className="ml-1.5 text-slate-400 dark:text-ndark-muted">({items.length})</span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {isStale && (
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200"
              title={data?.error?.message ?? 'TFS erişilemiyor — son bilinen veriler gösteriliyor.'}
            >
              <RefreshCw size={10} />
              Sync hatası
            </span>
          )}
          {canWrite && items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setLinkInput('');
                setLinkModalOpen(true);
              }}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 dark:text-ndark-muted dark:hover:text-ndark-text"
              title="Yeni work item bağla"
            >
              <Link2 size={11} />
              Bağla
            </button>
          )}
        </div>
      </div>

      <div className="bg-white px-1 py-1 dark:bg-ndark-card">
        {loading && !data ? (
          <div className="space-y-2 p-3">
            <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-2/5 animate-pulse rounded bg-slate-100" />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-start gap-2 px-3 py-4 text-xs italic text-slate-400 dark:text-ndark-muted">
            <span>Bağlı DevOps iş öğesi yok.</span>
            {canWrite && (
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Link2 size={12} />}
                onClick={() => {
                  setLinkInput('');
                  setLinkModalOpen(true);
                }}
              >
                Bağla
              </Button>
            )}
          </div>
        ) : (
          <ul className="space-y-2 p-2">
            {items.map((item) => (
              <li
                key={item.id}
                className={`rounded border border-slate-100 px-3 py-2 dark:border-ndark-border ${
                  item._stale ? 'opacity-60' : ''
                }`}
              >
                {/* Başlık satırı: ID (TFS link) · State · Title · Kaldır */}
                <div className="flex flex-wrap items-center gap-2">
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400"
                      title="DevOps'ta aç (yeni sekme)"
                    >
                      #{item.id}
                      <ExternalLink size={10} />
                    </a>
                  ) : (
                    <span className="text-xs font-medium text-slate-700 dark:text-ndark-text">#{item.id}</span>
                  )}
                  {item.state && (
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${stateBadgeClasses(item.state)}`}
                      title={`TFS State: ${item.state}`}
                    >
                      {item.state}
                    </span>
                  )}
                  <span
                    className="flex-1 truncate text-xs text-slate-800 dark:text-ndark-text"
                    title={item.title ?? ''}
                  >
                    {item.title ?? '—'}
                  </span>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => void handleUnlink(item)}
                      disabled={unlinkingId === item.id}
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/30"
                      title="Bağı kaldır"
                      aria-label={`#${item.id} bağı kaldır`}
                    >
                      {unlinkingId === item.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Trash2 size={11} />
                      )}
                    </button>
                  )}
                </div>

                {/* 13 alan 2-kolon sıkı ızgara (id/title/state/url üstte göründü) */}
                <dl className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-0 sm:grid-cols-2">
                  {FIELD_TR_LABELS.map(({ key, label }) => {
                    const raw = item[key];
                    const isDate = key === 'createdDate' || key === 'resolvedDate' || key === 'closedDate';
                    const displayValue = isDate
                      ? formatDate(raw as string | null)
                      : raw == null || raw === ''
                        ? '—'
                        : String(raw);
                    return (
                      <div
                        key={key}
                        className="flex items-baseline justify-between gap-2 border-b border-slate-50 px-1 py-1 last:border-b-0 dark:border-ndark-border/40"
                      >
                        <dt className="text-[11px] font-medium text-slate-500 dark:text-ndark-muted">
                          {label}
                        </dt>
                        <dd
                          className={`truncate text-[11px] ${
                            displayValue === '—' ? 'text-slate-400' : 'text-slate-700 dark:text-ndark-text'
                          }`}
                          title={displayValue === '—' ? '' : displayValue}
                        >
                          {displayValue}
                        </dd>
                      </div>
                    );
                  })}
                </dl>

                {/* Bağlama meta + stale lastSyncedAt */}
                {(item.linkedByUserName || item.lastSyncedAt) && (
                  <div className="mt-1 px-1 text-[10px] text-slate-400 dark:text-ndark-muted">
                    {item.linkedByUserName && (
                      <>
                        Bağlayan: <span className="font-medium text-slate-500">{item.linkedByUserName}</span>
                      </>
                    )}
                    {item.lastSyncedAt && (
                      <>
                        {item.linkedByUserName ? ' · ' : ''}
                        Son senkron: {formatRelative(item.lastSyncedAt)}
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* PR-D3 — Bağla modal: tek input (id veya TFS URL).
          Parse backend'de (devopsClient.parseWorkItemId). */}
      <Modal
        open={linkModalOpen}
        onClose={() => {
          setLinkModalOpen(false);
          setLinkInput('');
        }}
        title="DevOps iş öğesi bağla"
        size="md"
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-ndark-muted">
            Mevcut bir Azure DevOps work item'ı bu vakaya bağlar. Work item id'sini veya tam URL'sini girin.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-ndark-muted">
              Work Item ID veya URL
            </label>
            <TextInput
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="324813  veya  https://unitfs.../_workitems/edit/324813"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && linkInput.trim() && !linking) {
                  e.preventDefault();
                  void handleLink();
                }
              }}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Aynı work item zaten bağlıysa tekrar eklenmez.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<X size={12} />}
              onClick={() => {
                setLinkModalOpen(false);
                setLinkInput('');
              }}
              disabled={linking}
            >
              Vazgeç
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={linking ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
              onClick={() => void handleLink()}
              disabled={linking || !linkInput.trim()}
            >
              {linking ? 'Bağlanıyor…' : 'Bağla'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
