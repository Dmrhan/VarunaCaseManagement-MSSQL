import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, AlertCircle, Eye, ExternalLink, Loader2, MessageCircle,
  Paperclip, Mail, Phone, Trash2, Download, Upload, User as UserIcon,
  Sparkles, RefreshCw, ClipboardCopy,
} from 'lucide-react';
import {
  AttachmentImagePreviewDialog,
  isImageAttachment,
} from '@/features/cases/components/AttachmentImagePreviewDialog';
import { cn } from '@/components/ui/cn';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import { caseService, lookupService } from '@/services/caseService';
import { accountService, type CaseCustomerContext } from '@/services/accountService';
import { aiService } from '@/services/aiService';
import { MentionTextarea } from '@/features/cases/components/MentionTextarea';
import { MentionContent } from '@/features/cases/components/MentionContent';
import type { Case, CaseFilters, CasePriority, CaseStatus, NoteVisibility } from '@/features/cases/types';

/**
 * Case List Drawer — Split layout:
 *   ┌─────────────┬──────────────────────────┐
 *   │ Vaka listesi │ Hızlı düzenleme         │
 *   │  (~40%)      │  (~60%)                  │
 *   └─────────────┴──────────────────────────┘
 *
 * Use cases:
 *  - MyHome KPI tıkla → ilgili filtreli liste açılır
 *  - SLA banner → SLA riskli vakalar
 *  - Pattern banner → alarm cases (customFetch ile)
 *
 * Row click → sağ panelde inline quick edit (status/priority/atanan + not ekle).
 * "Tam ekranda aç →" CaseDetailPage'e gönderir.
 *
 * Veri kaynağı: `filter` veya `customFetch`. İkisi de yoksa boş liste.
 *
 * Mobile (< sm): drawer full-screen overlay. Split layout dikey stack olur
 * — liste önce, vaka seçilince detay paneli onun yerine gelir (Back ile geri).
 */

export interface CaseListDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Hangi filtreyle liste çekilecek (caseService.list) */
  filter?: CaseFilters;
  /** Özel fetch (snoozed / followup gibi). filter ile aynı anda verilmemeli. */
  customFetch?: () => Promise<Case[]>;
  /** "Tam ekranda aç →" — drawer kapanır, CaseDetailPage'e gönderir */
  onOpenFullCase: (caseId: string) => void;
  /** Liste boş olursa gösterilecek mesaj */
  emptyMessage?: string;
}

// Status transitions that require additional payload — gizlenir, "Tam ekranda aç" yönlendirilir
const SIMPLE_STATUSES: CaseStatus[] = ['Açık', 'İncelemede', 'YenidenAcildi'];
const COMPLEX_STATUSES: CaseStatus[] = ['Çözüldü', '3rdPartyBekleniyor', 'Eskalasyon', 'İptalEdildi'];

// Kapalı/iptal vakalarda AI çözüm önerisi anlamsız (zaten çözülmüş veya iptal)
const COMPLEX_CLOSED_STATUSES: CaseStatus[] = ['Çözüldü', 'İptalEdildi'];

const PRIORITIES: CasePriority[] = ['Low', 'Medium', 'High', 'Critical'];

const PRIORITY_LABEL: Record<CasePriority, string> = {
  Low: 'Düşük',
  Medium: 'Orta',
  High: 'Yüksek',
  Critical: 'Kritik',
};

export function CaseListDrawer({
  open,
  onClose,
  title,
  filter,
  customFetch,
  onOpenFullCase,
  emptyMessage = 'Bu kategoride vaka yok.',
}: CaseListDrawerProps) {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Mobile dikey stack — vaka seçildiğinde detayı göster
  const [mobileShowsDetail, setMobileShowsDetail] = useState(false);

  // ESC kapatma
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Sayfa scroll'unu drawer açıkken kilitle. Uygulama scroll konteyneri artık
  // #app-scroll (main.tsx AppShell) — body değil; onu kilitle, body'yi de defansif
  // olarak kilitle (fallback).
  useEffect(() => {
    if (!open) return;
    const scroller = document.getElementById('app-scroll');
    const prevBody = document.body.style.overflow;
    const prevScroller = scroller?.style.overflow ?? '';
    document.body.style.overflow = 'hidden';
    if (scroller) scroller.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      if (scroller) scroller.style.overflow = prevScroller;
    };
  }, [open]);

  // Drawer kapanınca state'leri sıfırla
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setSelectedCase(null);
      setMobileShowsDetail(false);
    }
  }, [open]);

  // Liste çek
  async function refreshList() {
    setLoading(true);
    try {
      if (customFetch) {
        const items = await customFetch();
        setCases(items);
      } else if (filter) {
        const res = await caseService.list(filter, { page: 1, pageSize: 50 });
        // Sort: SLA risk first, then priority desc, then createdAt desc
        const sorted = [...res.items].sort((a, b) => {
          if (a.slaViolation !== b.slaViolation) return a.slaViolation ? -1 : 1;
          const pOrder: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
          const pa = pOrder[a.priority] ?? 9;
          const pb = pOrder[b.priority] ?? 9;
          if (pa !== pb) return pa - pb;
          return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
        });
        setCases(sorted);
      } else {
        setCases([]);
      }
    } catch {
      setCases([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filter, customFetch]);

  // Vaka seçildiğinde tam veriyi çek (right panel detail)
  async function loadSelected(id: string) {
    setDetailLoading(true);
    try {
      const c = await caseService.get(id);
      setSelectedCase(c ?? null);
    } finally {
      setDetailLoading(false);
    }
  }

  function handleRowClick(c: Case) {
    setSelectedId(c.id);
    setMobileShowsDetail(true);
    void loadSelected(c.id);
  }

  function handleOpenFull() {
    if (!selectedId) return;
    onOpenFullCase(selectedId);
    onClose();
  }

  return (
    <div
      aria-hidden={!open}
      className={cn(
        'fixed inset-0 z-40 transition-opacity',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      {/* Backdrop — click closes */}
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />

      {/* Drawer — 860px desktop, full-screen mobile */}
      <aside
        className={cn(
          'absolute right-0 top-0 flex h-full w-full flex-col bg-white shadow-drawer transition-transform duration-200',
          'sm:max-w-[860px]',
          'dark:bg-ndark-bg',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 dark:border-ndark-border dark:bg-ndark-card">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-semibold text-slate-900 dark:text-ndark-text">
              {title}
            </h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-ndark-surface dark:text-ndark-muted">
              {loading ? '…' : cases.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ndark-surface dark:hover:text-ndark-text"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </header>

        {/* Split body */}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* LEFT — case list (40%) */}
          <div
            className={cn(
              'flex flex-col border-r border-slate-200 bg-slate-50/40 dark:border-ndark-border dark:bg-ndark-surface/30',
              'sm:w-[40%] sm:min-w-[280px]',
              // Mobile: detay açıkken listeyi gizle
              mobileShowsDetail ? 'hidden sm:flex' : 'flex',
            )}
          >
            <CaseList
              cases={cases}
              loading={loading}
              selectedId={selectedId}
              onSelect={handleRowClick}
              emptyMessage={emptyMessage}
            />
          </div>

          {/* RIGHT — quick edit (60%) */}
          <div
            className={cn(
              'flex flex-col bg-white dark:bg-ndark-bg',
              'sm:flex-1',
              !mobileShowsDetail && 'hidden sm:flex',
            )}
          >
            {selectedId ? (
              <QuickEditPanel
                key={selectedId}
                caseItem={selectedCase}
                loading={detailLoading}
                onOpenFull={handleOpenFull}
                onBack={() => setMobileShowsDetail(false)}
                onSaved={async () => {
                  await loadSelected(selectedId);
                  void refreshList();
                }}
              />
            ) : (
              <EmptyRightPanel />
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Left panel — case list
// ─────────────────────────────────────────────────────────────────

function CaseList({
  cases,
  loading,
  selectedId,
  onSelect,
  emptyMessage,
}: {
  cases: Case[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (c: Case) => void;
  emptyMessage: string;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-lg bg-white p-3 shadow-sm dark:bg-ndark-card"
          >
            <Skeleton height={14} width="60%" />
          </div>
        ))}
      </div>
    );
  }
  if (cases.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title={emptyMessage}
          description="Filtre kriterine uyan kayıt bulunamadı."
        />
      </div>
    );
  }
  return (
    <ul className="flex-1 overflow-y-auto scrollbar-thin">
      {cases.map((c) => {
        const isSelected = c.id === selectedId;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c)}
              className={cn(
                'group flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left transition-colors',
                'hover:bg-white dark:hover:bg-ndark-card dark:border-ndark-border/60',
                isSelected
                  ? 'border-l-2 border-l-brand-500 bg-white pl-[10px] dark:bg-ndark-card'
                  : 'border-l-2 border-l-transparent',
              )}
            >
              <PriorityDot priority={c.priority} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                    {c.caseNumber}
                  </span>
                  {c.slaViolation && (
                    <AlertCircle size={11} className="text-rose-600 dark:text-rose-400" />
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs font-medium text-slate-900 dark:text-ndark-text">
                  {c.title}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="truncate text-[11px] text-slate-500 dark:text-ndark-muted">
                    {c.accountName ?? 'Müşterisiz'}
                  </span>
                  <span className="text-slate-300 dark:text-ndark-dim">·</span>
                  <StatusPill status={c.status} />
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const PRIORITY_COLOR: Record<CasePriority, string> = {
  Critical: 'bg-rose-500',
  High: 'bg-orange-500',
  Medium: 'bg-amber-400',
  Low: 'bg-slate-300',
};

function PriorityDot({ priority }: { priority: CasePriority }) {
  return (
    <span
      aria-label={PRIORITY_LABEL[priority]}
      className={cn('mt-1 inline-block h-2 w-2 shrink-0 rounded-full', PRIORITY_COLOR[priority])}
    />
  );
}

// ─────────────────────────────────────────────────────────────────
// Right panel — empty state
// ─────────────────────────────────────────────────────────────────

function EmptyRightPanel() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        title="Bir vaka seçin"
        description="Soldan bir vaka seçtiğinizde hızlı düzenleme paneli açılır."
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Right panel — quick edit
// ─────────────────────────────────────────────────────────────────

type RightTab = 'edit' | 'notes';

function QuickEditPanel({
  caseItem,
  loading,
  onOpenFull,
  onBack,
  onSaved,
}: {
  caseItem: Case | null;
  loading: boolean;
  onOpenFull: () => void;
  onBack: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const { toast } = useToast();

  // Tab
  const [tab, setTab] = useState<RightTab>('edit');

  // Drafts (edit tab)
  const [statusDraft, setStatusDraft] = useState<CaseStatus | ''>('');
  const [priorityDraft, setPriorityDraft] = useState<CasePriority | ''>('');
  const [assigneeDraft, setAssigneeDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Note (notes tab)
  const [noteContent, setNoteContent] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<NoteVisibility>('Internal');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);

  // Customer context (sticky header)
  const [customerCtx, setCustomerCtx] = useState<CaseCustomerContext | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);

  // File upload (edit tab)
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Image preview (drawer file list — Eye icon → modal)
  const [previewFile, setPreviewFile] = useState<{
    id: string;
    fileName: string;
    fileSize: number;
    mimeType?: string;
  } | null>(null);

  // AI çözüm önerisi (Notlar tab) — manual trigger, cost-aware
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [aiDrafting, setAiDrafting] = useState(false);

  // Reset state when case changes
  useEffect(() => {
    if (caseItem) {
      setStatusDraft(caseItem.status);
      setPriorityDraft(caseItem.priority);
      setAssigneeDraft(caseItem.assignedPersonId ?? '');
      setNoteContent('');
      setNoteVisibility('Internal');
      setShowAllNotes(false);
      setTab('edit');
      setAiDraft(null);
    }
  }, [caseItem?.id]);

  // Fetch customer context once per case
  useEffect(() => {
    if (!caseItem?.id) {
      setCustomerCtx(null);
      return;
    }
    let alive = true;
    setCustomerLoading(true);
    void accountService.getCaseCustomerContext(caseItem.id).then((res) => {
      if (!alive) return;
      setCustomerCtx(res?.context ?? null);
      setCustomerLoading(false);
    });
    return () => { alive = false; };
  }, [caseItem?.id]);

  const personsForCompany = useMemo(() => {
    if (!caseItem) return [];
    return lookupService.persons().filter((p) => p.teamId === caseItem.assignedTeamId || !caseItem.assignedTeamId);
  }, [caseItem?.assignedTeamId]);

  if (loading || !caseItem) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton height={20} width="60%" />
        <Skeleton height={14} width="80%" />
        <div className="mt-4 space-y-2">
          <Skeleton height={32} width="100%" />
          <Skeleton height={32} width="100%" />
          <Skeleton height={32} width="100%" />
        </div>
      </div>
    );
  }

  const isDirty =
    statusDraft !== caseItem.status ||
    priorityDraft !== caseItem.priority ||
    assigneeDraft !== (caseItem.assignedPersonId ?? '');

  async function handleSave() {
    if (!caseItem || !isDirty) return;
    setSaving(true);
    try {
      const patch: Partial<Case> = {};
      if (statusDraft !== caseItem.status) patch.status = statusDraft as CaseStatus;
      if (priorityDraft !== caseItem.priority) patch.priority = priorityDraft as CasePriority;
      if (assigneeDraft !== (caseItem.assignedPersonId ?? '')) {
        const person = lookupService.persons().find((p) => p.id === assigneeDraft);
        patch.assignedPersonId = assigneeDraft || undefined;
        patch.assignedPersonName = person?.name;
      }
      const updated = await caseService.update(caseItem.id, patch);
      if (updated) {
        toast({ type: 'success', message: 'Vaka güncellendi.' });
        await onSaved();
      }
    } catch {
      toast({ type: 'error', message: 'Güncelleme başarısız.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDraftResolution() {
    if (!caseItem) return;
    setAiDrafting(true);
    try {
      const r = await aiService.draftResolution({
        caseSubject: caseItem.title,
        description: caseItem.description,
        caseType: caseItem.caseType,
        category: caseItem.category,
        history: caseItem.history,
        notes: caseItem.notes,
      });
      if (r.ok) {
        setAiDraft(r.data.draft);
      } else {
        toast({ type: 'error', message: 'AI önerisi alınamadı.' });
      }
    } finally {
      setAiDrafting(false);
    }
  }

  function applyDraftToNote() {
    if (!aiDraft) return;
    // Mevcut note içeriğini koru — kullanıcı düzenleyip ekleyebilsin.
    setNoteContent((prev) => (prev ? `${prev}\n\n${aiDraft}` : aiDraft));
    setAiDraft(null);
  }

  async function handleAddNote() {
    if (!caseItem || !noteContent.trim()) return;
    setNoteSubmitting(true);
    try {
      const created = await caseService.addNote(caseItem.id, {
        content: noteContent.trim(),
        visibility: noteVisibility,
        authorName: user?.fullName ?? 'Kullanıcı',
      });
      if (created) {
        toast({ type: 'success', message: 'Not eklendi.' });
        setNoteContent('');
        await onSaved();
      }
    } catch {
      toast({ type: 'error', message: 'Not eklenemedi.' });
    } finally {
      setNoteSubmitting(false);
    }
  }

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !caseItem) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const r = await caseService.addFile(caseItem.id, file, (p) => setUploadProgress(p));
      if (r && 'file' in r) {
        toast({ type: 'success', message: 'Dosya yüklendi.' });
        await onSaved();
      } else if (r && 'error' in r) {
        toast({ type: 'error', message: r.error });
      }
    } catch {
      toast({ type: 'error', message: 'Dosya yüklenemedi.' });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      // reset input so same file can be re-picked
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleFileDownload(fileId: string) {
    if (!caseItem) return;
    await caseService.downloadFile(caseItem.id, fileId);
  }

  async function handleFileRemove(fileId: string) {
    if (!caseItem) return;
    if (!confirm('Bu dosyayı silmek istediğinize emin misiniz?')) return;
    const r = await caseService.removeFile(caseItem.id, fileId);
    if (r) {
      toast({ type: 'success', message: 'Dosya silindi.' });
      await onSaved();
    }
  }

  // Sorted notes (newest first)
  const allNotes = (caseItem.notes ?? [])
    .slice()
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const visibleNotes = showAllNotes ? allNotes : allNotes.slice(0, 3);
  const files = caseItem.files ?? [];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="border-b border-slate-200 px-4 py-3 dark:border-ndark-border">
        <div className="flex items-start gap-2 sm:hidden">
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-slate-500 hover:text-slate-700 dark:text-ndark-muted"
          >
            ← Liste
          </button>
        </div>
        <div className="mt-1 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-slate-500 dark:text-ndark-muted">
                {caseItem.caseNumber}
              </span>
              <StatusPill status={caseItem.status} />
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-ndark-text">
              {caseItem.title}
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenFull}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-ndark-border dark:text-ndark-text dark:hover:bg-ndark-surface"
          >
            Tam ekranda aç
            <ExternalLink size={11} />
          </button>
        </div>
      </div>

      {/* Sticky customer strip — always visible */}
      <CustomerStrip
        ctx={customerCtx}
        loading={customerLoading}
        fallbackName={caseItem.accountName}
        requesterFallback={
          (caseItem as Case & {
            customerContactName?: string | null;
            customerContactPhone?: string | null;
            customerContactEmail?: string | null;
            customerCompanyName?: string | null;
          })
        }
      />

      {/* Tabs */}
      <div className="flex border-b border-slate-200 bg-slate-50/60 dark:border-ndark-border dark:bg-ndark-surface/30">
        <TabButton active={tab === 'edit'} onClick={() => setTab('edit')}>
          Düzenle
          {isDirty && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />}
        </TabButton>
        <TabButton active={tab === 'notes'} onClick={() => setTab('notes')}>
          Notlar
          {allNotes.length > 0 && (
            <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-ndark-surface dark:text-ndark-muted">
              {allNotes.length}
            </span>
          )}
        </TabButton>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
        {tab === 'edit' && (
          <div className="space-y-4">
            {/* SLA info */}
            {caseItem.slaResolutionDueAt && (
              <div className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs dark:border-ndark-border dark:bg-ndark-surface/40">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-ndark-muted">SLA Çözüm</span>
                  {caseItem.slaViolation ? (
                    <span className="font-semibold text-rose-700 dark:text-rose-300">İhlal</span>
                  ) : (
                    <span className="font-medium text-slate-700 dark:text-ndark-text">
                      {formatRemaining(caseItem.slaResolutionDueAt)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Status */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                Durum
              </label>
              <select
                value={statusDraft}
                onChange={(e) => setStatusDraft(e.target.value as CaseStatus)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
              >
                {SIMPLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                {COMPLEX_STATUSES.includes(caseItem.status) && (
                  <option value={caseItem.status} disabled>
                    {caseItem.status} (tam ekran)
                  </option>
                )}
              </select>
              {COMPLEX_STATUSES.includes(caseItem.status) && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-ndark-muted">
                  Bu vaka karmaşık durumda; statü değiştirmek için tam ekranı kullanın.
                </p>
              )}
            </div>

            {/* Priority */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                Öncelik
              </label>
              <select
                value={priorityDraft}
                onChange={(e) => setPriorityDraft(e.target.value as CasePriority)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>

            {/* Assignee */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                Atanan Kişi
              </label>
              <select
                value={assigneeDraft}
                onChange={(e) => setAssigneeDraft(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
              >
                <option value="">— Atanmamış —</option>
                {personsForCompany.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Files */}
            <div className="rounded-md border border-slate-200 px-3 py-3 dark:border-ndark-border">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
                  <Paperclip size={11} className="mr-1 inline" />
                  Dosyalar ({files.length})
                </label>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
                >
                  {uploading ? (
                    <>
                      <Loader2 size={11} className="animate-spin" /> %{uploadProgress}
                    </>
                  ) : (
                    <>
                      <Upload size={11} /> Dosya Ekle
                    </>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFilePick}
                  className="hidden"
                />
              </div>
              {files.length === 0 ? (
                <p className="text-[11px] text-slate-500 dark:text-ndark-muted">
                  Henüz dosya yok.
                </p>
              ) : (
                <ul className="space-y-1">
                  {files.map((f) => {
                    const previewable = isImageAttachment(f);
                    return (
                      <li
                        key={f.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50/40 px-2 py-1 text-xs dark:border-ndark-border dark:bg-ndark-surface/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-slate-800 dark:text-ndark-text">
                            {f.fileName}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-ndark-muted">
                            {formatBytes(f.fileSize ?? 0)} · {formatShortDate(f.uploadedAt)}
                          </div>
                        </div>
                        {previewable && (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewFile({
                                id: f.id,
                                fileName: f.fileName,
                                fileSize: f.fileSize ?? 0,
                                mimeType: f.mimeType,
                              })
                            }
                            className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-ndark-surface"
                            aria-label="Önizle"
                          >
                            <Eye size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleFileDownload(f.id)}
                          className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-ndark-surface"
                          aria-label="İndir"
                        >
                          <Download size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFileRemove(f.id)}
                          className="rounded p-1 text-slate-500 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-900/30"
                          aria-label="Sil"
                        >
                          <Trash2 size={12} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === 'notes' && (
          <div className="space-y-4">
            {/* AI çözüm önerisi — manual trigger, açık vakalarda */}
            {!COMPLEX_CLOSED_STATUSES.includes(caseItem.status) && (
              <div className="rounded-md border border-violet-200 bg-violet-50/40 px-3 py-2 dark:border-violet-900/40 dark:bg-violet-950/20">
                {aiDraft === null ? (
                  <button
                    type="button"
                    onClick={handleDraftResolution}
                    disabled={aiDrafting}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-violet-300 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-800 dark:bg-ndark-card dark:text-violet-300"
                  >
                    {aiDrafting ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Öneri hazırlanıyor…
                      </>
                    ) : (
                      <>
                        <Sparkles size={12} />
                        AI çözüm önerisi al
                      </>
                    )}
                  </button>
                ) : (
                  <div>
                    <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                      <Sparkles size={11} />
                      AI Önerisi
                    </div>
                    <p className="whitespace-pre-wrap rounded-md border border-violet-100 bg-white p-2 text-xs leading-relaxed text-slate-700 dark:border-violet-900/40 dark:bg-ndark-card dark:text-ndark-text">
                      {aiDraft}
                    </p>
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setAiDraft(null)}
                        className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-surface"
                      >
                        Kapat
                      </button>
                      <button
                        type="button"
                        onClick={handleDraftResolution}
                        disabled={aiDrafting}
                        className="inline-flex items-center gap-1 rounded-md border border-violet-200 px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-60 dark:border-violet-800 dark:text-violet-300"
                      >
                        {aiDrafting ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                        Yeniden Üret
                      </button>
                      <button
                        type="button"
                        onClick={applyDraftToNote}
                        className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-700"
                      >
                        <ClipboardCopy size={11} />
                        Nota Kopyala
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Note compose with mention support */}
            <div className="rounded-md border border-slate-200 px-3 py-3 dark:border-ndark-border">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
                  <MessageCircle size={11} className="mr-1 inline" />
                  Not Ekle
                </label>
                <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-ndark-border">
                  <button
                    type="button"
                    onClick={() => setNoteVisibility('Internal')}
                    className={cn(
                      'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                      noteVisibility === 'Internal'
                        ? 'bg-slate-700 text-white dark:bg-ndark-surface'
                        : 'text-slate-600 dark:text-ndark-muted',
                    )}
                  >
                    İç Not
                  </button>
                  <button
                    type="button"
                    onClick={() => setNoteVisibility('Customer')}
                    className={cn(
                      'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                      noteVisibility === 'Customer'
                        ? 'bg-brand-600 text-white'
                        : 'text-slate-600 dark:text-ndark-muted',
                    )}
                  >
                    Müşteriye Görünür
                  </button>
                </div>
              </div>
              <MentionTextarea
                caseId={caseItem.id}
                value={noteContent}
                onChange={setNoteContent}
                rows={3}
                placeholder="Kısa not… @ ile takım arkadaşı etiketle"
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  onClick={handleAddNote}
                  disabled={!noteContent.trim() || noteSubmitting}
                  leftIcon={noteSubmitting ? <Loader2 size={12} className="animate-spin" /> : undefined}
                >
                  Not Ekle
                </Button>
              </div>
            </div>

            {/* History */}
            {visibleNotes.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-ndark-muted">Henüz not yok.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ndark-muted">
                    Geçmiş Notlar ({allNotes.length})
                  </div>
                  {allNotes.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setShowAllNotes((v) => !v)}
                      className="text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-300"
                    >
                      {showAllNotes ? 'Daha Az' : `Tümünü Göster (${allNotes.length})`}
                    </button>
                  )}
                </div>
                {visibleNotes.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2 text-xs dark:border-ndark-border dark:bg-ndark-surface/40"
                  >
                    <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-ndark-muted">
                      <span className="font-medium">{n.authorName}</span>
                      <span>·</span>
                      <span>{formatShortDate(n.createdAt)}</span>
                      {n.visibility === 'Customer' && (
                        <span className="ml-1 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                          Müşteri
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-slate-700 dark:text-ndark-text">
                      <MentionContent content={n.content} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer — only on edit tab */}
      {tab === 'edit' && (
        <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-2.5 dark:border-ndark-border dark:bg-ndark-surface/40">
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onBack}>
              Kapat
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || saving}
              leftIcon={saving ? <Loader2 size={12} className="animate-spin" /> : undefined}
            >
              Kaydet
            </Button>
          </div>
        </div>
      )}
      <AttachmentImagePreviewDialog
        open={previewFile != null}
        caseId={caseItem.id}
        file={previewFile}
        onClose={() => setPreviewFile(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Customer strip — sticky between header and tabs
// ─────────────────────────────────────────────────────────────────

function CustomerStrip({
  ctx,
  loading,
  fallbackName,
  requesterFallback,
}: {
  ctx: CaseCustomerContext | null;
  loading: boolean;
  fallbackName: string | null | undefined;
  requesterFallback: {
    customerContactName?: string | null;
    customerContactPhone?: string | null;
    customerContactEmail?: string | null;
    customerCompanyName?: string | null;
  };
}) {
  if (loading) {
    return (
      <div className="border-b border-slate-200 bg-amber-50/40 px-4 py-2 dark:border-ndark-border dark:bg-amber-950/10">
        <Skeleton height={14} width="70%" />
      </div>
    );
  }

  // Customer-context varsa onu kullan
  if (ctx) {
    const c = ctx.primaryContact;
    return (
      <div className="border-b border-slate-200 bg-amber-50/40 px-4 py-2 dark:border-ndark-border dark:bg-amber-950/10">
        <div className="flex items-center gap-2 text-xs">
          <UserIcon size={12} className="shrink-0 text-amber-700 dark:text-amber-300" />
          <span className="min-w-0 truncate font-semibold text-slate-900 dark:text-ndark-text">
            {ctx.accountName}
          </span>
          {ctx.company?.packageName && (
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-ndark-surface dark:text-ndark-muted">
              {ctx.company.packageName}
            </span>
          )}
        </div>
        {c && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-ndark-muted">
            <span className="font-medium text-slate-700 dark:text-ndark-text">
              {c.fullName}
              {c.title && <span className="font-normal text-slate-500"> · {c.title}</span>}
            </span>
            {c.phone && (
              <a
                href={`tel:${c.phone}`}
                className="inline-flex items-center gap-0.5 text-brand-700 hover:underline dark:text-brand-300"
              >
                <Phone size={10} /> {c.phone}
              </a>
            )}
            {c.email && (
              <a
                href={`mailto:${c.email}`}
                className="inline-flex items-center gap-0.5 text-brand-700 hover:underline dark:text-brand-300"
              >
                <Mail size={10} /> {c.email}
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  // Customerless case — Phase D requester context fallback
  const hasRequester =
    requesterFallback.customerContactName ||
    requesterFallback.customerContactPhone ||
    requesterFallback.customerContactEmail ||
    requesterFallback.customerCompanyName;
  if (hasRequester) {
    return (
      <div className="border-b border-slate-200 bg-amber-50/40 px-4 py-2 dark:border-ndark-border dark:bg-amber-950/10">
        <div className="flex items-center gap-2 text-xs">
          <UserIcon size={12} className="shrink-0 text-amber-700 dark:text-amber-300" />
          <span className="truncate font-semibold text-slate-900 dark:text-ndark-text">
            {requesterFallback.customerCompanyName || 'Müşterisiz Başvuran'}
          </span>
          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            Eşleşmemiş
          </span>
        </div>
        {requesterFallback.customerContactName && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-ndark-muted">
            <span className="font-medium text-slate-700 dark:text-ndark-text">
              {requesterFallback.customerContactName}
            </span>
            {requesterFallback.customerContactPhone && (
              <a
                href={`tel:${requesterFallback.customerContactPhone}`}
                className="inline-flex items-center gap-0.5 text-brand-700 hover:underline dark:text-brand-300"
              >
                <Phone size={10} /> {requesterFallback.customerContactPhone}
              </a>
            )}
            {requesterFallback.customerContactEmail && (
              <a
                href={`mailto:${requesterFallback.customerContactEmail}`}
                className="inline-flex items-center gap-0.5 text-brand-700 hover:underline dark:text-brand-300"
              >
                <Mail size={10} /> {requesterFallback.customerContactEmail}
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  // No customer info at all
  return (
    <div className="border-b border-slate-200 bg-slate-50/40 px-4 py-2 text-xs text-slate-500 dark:border-ndark-border dark:bg-ndark-surface/30 dark:text-ndark-muted">
      <UserIcon size={12} className="mr-1 inline" />
      {fallbackName ?? 'Müşterisiz'}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
        active
          ? 'border-brand-500 text-brand-700 dark:text-brand-300'
          : 'border-transparent text-slate-600 hover:text-slate-800 dark:text-ndark-muted',
      )}
    >
      {children}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return 'geçti';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h < 24) return `${h}sa ${m}dk kaldı`;
  const d = Math.floor(h / 24);
  return `${d}gün ${h % 24}sa kaldı`;
}

function formatShortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
