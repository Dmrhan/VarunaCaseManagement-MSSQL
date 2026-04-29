import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Brain,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  History as HistoryIcon,
  Inbox,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Paperclip,
  Phone,
  Save,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  User,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextArea } from '@/components/ui/Field';
import { Popover } from '@/components/ui/Popover';
import { ActiveCallBanner } from '@/components/ui/ActiveCallBanner';
import { QuickNotePopover } from '@/components/ui/QuickNotePopover';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { StatusTransitionPanel } from './StatusTransitionPanel';
import { CaseTypeBadge, PriorityBadge, StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { caseService, lookupService } from '@/services/caseService';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import {
  CASE_ORIGINS,
  CASE_REQUEST_TYPES,
  ESCALATION_LEVEL_LABELS,
  FINANCIAL_STATUSES,
  OFFER_OUTCOMES,
  PRODUCT_USAGES,
  RESPONSE_LEVELS,
  USAGE_CHANGE_ALERTS,
  type Case,
  type NoteVisibility,
} from './types';

type TabKey = 'detail' | 'activity' | 'notes' | 'files' | 'callLogs';

interface CaseDetailPageProps {
  caseId: string;
  onBack: () => void;
  onShowCustomer?: (accountId: string) => void;
}

export function CaseDetailPage({ caseId, onBack, onShowCustomer }: CaseDetailPageProps) {
  const [item, setItem] = useState<Case | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState(caseId);

  // Breadcrumb stack — geçmiş vaka navigasyonu için (max 3 level)
  // Eski item'lar burada birikir; ana breadcrumb item'ı = activeId
  const [navStack, setNavStack] = useState<{ id: string; caseNumber: string; accountName: string }[]>([]);

  const [tab, setTab] = useState<TabKey>('detail');
  const [previousCases, setPreviousCases] = useState<Case[]>([]);
  const [callActive, setCallActive] = useState(false);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);

  // Inline edit / drafts
  const [drafts, setDrafts] = useState<Partial<Case>>({});
  const [editingField, setEditingField] = useState<string | null>(null);
  const [savingDrafts, setSavingDrafts] = useState(false);

  // Status transition artık StatusTransitionPanel içinde (header popover kaldırıldı)

  // New note state
  const [noteText, setNoteText] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<NoteVisibility>('Internal');
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const offeredSolutions = useMemo(() => lookupService.offeredSolutions(), []);
  const accounts = useMemo(() => lookupService.accounts(), []);
  const { toast } = useToast();

  // Parent caseId değişirse içerideki state ve breadcrumb sıfırlanır
  useEffect(() => {
    setActiveId(caseId);
    setNavStack([]);
    setDrafts({});
    setEditingField(null);
  }, [caseId]);

  useEffect(() => {
    let alive = true;
    if (!activeId) return;
    setLoading(true);
    void caseService.get(activeId).then((c) => {
      if (alive) {
        setItem(c ?? null);
        setLoading(false);
        setNoteText('');
        setNoteVisibility('Internal');
        setTab('detail');
      }
    });
    return () => {
      alive = false;
    };
  }, [activeId]);

  // Önceki vakalar (Çözüldü / İptalEdildi)
  useEffect(() => {
    let alive = true;
    if (!item) {
      setPreviousCases([]);
      return;
    }
    void caseService
      .findByAccount(item.accountId, {
        excludeId: item.id,
        statusIn: ['Çözüldü', 'İptalEdildi'],
      })
      .then((items) => {
        if (alive) {
          items.sort((a, b) => {
            const ta = new Date(a.resolvedAt ?? a.updatedAt).getTime();
            const tb = new Date(b.resolvedAt ?? b.updatedAt).getTime();
            return tb - ta;
          });
          setPreviousCases(items);
        }
      });
    return () => {
      alive = false;
    };
  }, [item]);

  const account = useMemo(
    () => (item ? accounts.find((a) => a.id === item.accountId) : undefined),
    [item, accounts],
  );

  async function handleAddNote() {
    if (!item || !noteText.trim()) return;
    const created = await caseService.addNote(item.id, {
      content: noteText.trim(),
      visibility: noteVisibility,
      authorName: 'Mock User',
    });
    if (created) {
      setItem({ ...item, notes: [created, ...item.notes] });
      setNoteText('');
      toast({
        type: 'success',
        message: noteVisibility === 'Internal' ? 'İç not eklendi.' : 'Müşteriye görünür not eklendi.',
        duration: 2500,
      });
    }
  }

  function handleQuickActionAddNote() {
    setTab('notes');
    setTimeout(() => noteRef.current?.focus(), 50);
  }

  // Breadcrumb stack üzerinden geçmiş vakaya geçiş — Spec UX 4
  function navigateToCase(targetId: string) {
    if (!item || targetId === activeId) return;
    setNavStack((prev) => {
      const next = [...prev, { id: item.id, caseNumber: item.caseNumber, accountName: item.accountName }];
      // Max 3 level: en eski item düşer
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
    setActiveId(targetId);
    setDrafts({});
    setEditingField(null);
    setTab('detail');
  }

  function navigateToStackItem(index: number) {
    const target = navStack[index];
    if (!target) return;
    setActiveId(target.id);
    setNavStack((prev) => prev.slice(0, index));
    setDrafts({});
    setEditingField(null);
    setTab('detail');
  }

  // Inline edit handlers
  function commitDraft(field: keyof Case, value: unknown) {
    setDrafts((prev) => {
      // Mevcut değerle aynıysa draft'ı kaldır
      if ((item as Record<string, unknown> | null)?.[field as string] === value) {
        const { [field as string]: _omit, ...rest } = prev as Record<string, unknown>;
        void _omit;
        return rest as Partial<Case>;
      }
      return { ...prev, [field]: value } as Partial<Case>;
    });
    setEditingField(null);
  }

  function cancelEdit() {
    setEditingField(null);
  }

  async function handleSaveDrafts() {
    if (!item || Object.keys(drafts).length === 0 || savingDrafts) return;
    setSavingDrafts(true);
    const updated = await caseService.update(item.id, drafts);
    setSavingDrafts(false);
    if (updated) {
      setItem(updated);
      setDrafts({});
      setEditingField(null);
      toast({ type: 'success', title: 'Vaka güncellendi ✓', message: `${Object.keys(drafts).length} alan kaydedildi.` });
    }
  }

  function handleDiscardDrafts() {
    setDrafts({});
    setEditingField(null);
  }

  // ESC = açık edit'i iptal et (ya da pending draft'ları sıfırla — kullanıcı seçimi)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (editingField) {
          setEditingField(null);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingField]);

  function handleStartCall() {
    setCallActive(true);
  }

  function handleEndCall(durationSec: number) {
    setCallActive(false);
    toast({
      type: 'success',
      title: 'Çağrı sonlandırıldı',
      message: `Süre: ${Math.floor(durationSec / 60)}dk ${durationSec % 60}sn — kayıt eklemek için Çağrı Logları sekmesini kullan.`,
      duration: 5000,
    });
  }

  if (loading && !item) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Vaka yükleniyor…
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
        <span>Vaka bulunamadı.</span>
        <Button variant="outline" size="sm" leftIcon={<ArrowLeft size={12} />} onClick={onBack}>
          Vakalar listesine dön
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header — sticky */}
      <header className="border-b border-slate-200 bg-white">
        <div className="flex items-start gap-4 px-6 py-3">
          {/* Mobile: hamburger for left panel */}
          <button
            type="button"
            onClick={() => setLeftDrawerOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 lg:hidden"
            title="Müşteri özeti"
          >
            <Inbox size={16} />
          </button>

          <button
            type="button"
            onClick={onBack}
            className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
            title="Vakalar listesine dön"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="min-w-0 flex-1">
            <nav className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
              <button type="button" onClick={onBack} className="hover:text-brand-700 hover:underline">
                Vakalar
              </button>
              {navStack.map((entry, i) => (
                <span key={`${entry.id}-${i}`} className="flex items-center gap-1">
                  <ChevronRight size={11} className="text-slate-400" />
                  <button
                    type="button"
                    onClick={() => navigateToStackItem(i)}
                    className="font-mono text-slate-600 hover:text-brand-700 hover:underline"
                    title={entry.accountName}
                  >
                    {entry.caseNumber}
                  </button>
                </span>
              ))}
              <ChevronRight size={11} className="text-slate-400" />
              <span className="font-mono text-slate-700">{item.caseNumber}</span>
              <span className="text-slate-400">—</span>
              <span className="truncate text-slate-600">{item.accountName}</span>
            </nav>
            <h1 className="mt-0.5 truncate text-lg font-semibold text-slate-900">{item.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {onShowCustomer && (
                <button
                  type="button"
                  onClick={() => onShowCustomer(item.accountId)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-brand-300 hover:bg-brand-50"
                >
                  <Building2 size={11} />
                  {item.accountName}
                </button>
              )}

              {/* StatusPill artık görsel/display-only — geçişler StatusTransitionPanel ile yapılıyor */}
              <StatusPill status={item.status} />

              <PriorityBadge priority={item.priority} />
              {item.slaViolation && (
                <Badge tint="rose" icon={<ShieldAlert size={12} />}>
                  SLA İhlali
                </Badge>
              )}
              {item.slaPausedAt && <Badge tint="amber">SLA Duraklatıldı</Badge>}
              {item.slaResolutionDueAt && !item.slaViolation && !item.slaPausedAt && (
                <Badge tint="slate" icon={<Clock size={12} />}>
                  Çözüm SLA {formatRelative(item.slaResolutionDueAt)}
                </Badge>
              )}
              <CaseTypeBadge type={item.caseType} />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {Object.keys(drafts).length > 0 && (
              <button
                type="button"
                onClick={handleDiscardDrafts}
                className="text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
                title="Taslak değişiklikleri sil"
              >
                Taslakları sil
              </button>
            )}
            <Button
              variant={Object.keys(drafts).length > 0 ? 'primary' : 'outline'}
              size="sm"
              leftIcon={<Save size={12} />}
              disabled={Object.keys(drafts).length === 0 || savingDrafts}
              onClick={handleSaveDrafts}
              title={Object.keys(drafts).length > 0
                ? `${Object.keys(drafts).length} alan kaydedilecek`
                : 'Düzenlenmiş alan yok'}
            >
              {savingDrafts ? 'Kaydediliyor…' : `Kaydet${Object.keys(drafts).length > 0 ? ` (${Object.keys(drafts).length})` : ''}`}
            </Button>
            <Button
              size="sm"
              leftIcon={<Phone size={12} />}
              onClick={handleStartCall}
              disabled={callActive}
            >
              Çağrı Başlat
            </Button>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<UserPlus size={12} />}
              onClick={() => toast({ type: 'info', message: 'Vaka devir akışı FAZ 4\'te eklenecek.' })}
            >
              Devret
            </Button>
            <Popover
              align="end"
              width={200}
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                  title="Daha fazla aksiyon"
                >
                  <MoreHorizontal size={14} />
                </button>
              )}
            >
              {({ close }) => (
                <ul className="text-sm">
                  <MenuAction
                    label="İptal Et"
                    onClick={() => {
                      close();
                      toast({ type: 'info', message: 'İptal akışı status popover üzerinden çalıştırılır.' });
                    }}
                  />
                  <MenuAction
                    label="Jira'ya Aktar"
                    onClick={() => {
                      close();
                      toast({ type: 'info', message: 'Jira entegrasyonu FAZ 2 kapsamında.' });
                    }}
                  />
                  <MenuAction
                    label="Yazdır"
                    onClick={() => {
                      close();
                      window.print();
                    }}
                  />
                </ul>
              )}
            </Popover>
          </div>
        </div>
      </header>

      {/* Active call banner */}
      {callActive && (
        <ActiveCallBanner
          customerName={item.accountName}
          customerPhone={account?.phone}
          caseId={item.id}
          onNoteAdded={(note) => setItem({ ...item, notes: [note, ...item.notes] })}
          onEnd={handleEndCall}
        />
      )}

      {/* Body — 3 columns */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Left panel */}
        <LeftPanel
          item={item}
          accountPhone={account?.phone}
          accountEmail={account?.email}
          accountContact={account?.contactPerson}
          onStartCall={handleStartCall}
          onTransfer={() => toast({ type: 'info', message: 'Vaka devir akışı FAZ 4\'te eklenecek.' })}
          onNoteAdded={(note) => setItem({ ...item, notes: [note, ...item.notes] })}
          onTabFocusNote={handleQuickActionAddNote}
          callActive={callActive}
          drawerOpen={leftDrawerOpen}
          onCloseDrawer={() => setLeftDrawerOpen(false)}
        />

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <nav className="sticky top-0 z-10 flex shrink-0 gap-1 border-b border-slate-200 bg-white px-4">
            <TabButton
              active={tab === 'detail'}
              icon={<FileText size={14} />}
              label="Detay"
              onClick={() => setTab('detail')}
            />
            <TabButton
              active={tab === 'activity'}
              icon={<HistoryIcon size={14} />}
              label="Aktivite"
              count={item.history.length}
              onClick={() => setTab('activity')}
            />
            <TabButton
              active={tab === 'notes'}
              icon={<MessageSquare size={14} />}
              label="Notlar"
              count={item.notes.length}
              onClick={() => setTab('notes')}
            />
            <TabButton
              active={tab === 'files'}
              icon={<Paperclip size={14} />}
              label="Dosyalar"
              count={item.files.length}
              onClick={() => setTab('files')}
            />
            {(item.caseType === 'ProactiveTracking' || item.caseType === 'Churn') && (
              <TabButton
                active={tab === 'callLogs'}
                icon={<Mic size={14} />}
                label="Çağrı Logları"
                count={item.callLogs.length}
                onClick={() => setTab('callLogs')}
              />
            )}
          </nav>

          <div className="flex-1 overflow-y-auto p-6">
            {tab === 'detail' && (
              <DetailTab
                item={item}
                offeredSolutions={offeredSolutions}
                previousCases={previousCases}
                onSelectPrevious={navigateToCase}
                drafts={drafts}
                editingField={editingField}
                onStartEdit={(f) => setEditingField(f)}
                onCancelEdit={cancelEdit}
                onCommitDraft={commitDraft}
                onTransitionApplied={(updated) => setItem(updated)}
              />
            )}
            {tab === 'activity' && <ActivityTab item={item} />}
            {tab === 'notes' && (
              <NotesTab
                item={item}
                noteText={noteText}
                noteVisibility={noteVisibility}
                onChangeText={setNoteText}
                onChangeVisibility={setNoteVisibility}
                onSubmit={handleAddNote}
                inputRef={noteRef}
              />
            )}
            {tab === 'files' && <FilesTab item={item} />}
            {tab === 'callLogs' && <CallLogsTab item={item} />}
          </div>
        </main>

        {/* Right panel — AI + type-specific summary */}
        {/* Sağ panel — yalnızca AI önerisi varsa görünür; yoksa orta alan tüm kalan yeri alır */}
        {item.aiGeneratedFlag && (
          <RightPanel item={item} offeredSolutions={offeredSolutions} />
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------

function MenuAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100"
      >
        {label}
      </button>
    </li>
  );
}

function TabButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
        active
          ? 'border-brand-600 text-brand-700'
          : 'border-transparent text-slate-600 hover:text-slate-800'
      }`}
    >
      {icon}
      {label}
      {count != null && count > 0 && (
        <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">{count}</span>
      )}
    </button>
  );
}

function LeftPanel({
  item,
  accountPhone,
  accountEmail,
  accountContact,
  onStartCall,
  onTransfer,
  onNoteAdded,
  onTabFocusNote,
  callActive,
  drawerOpen,
  onCloseDrawer,
}: {
  item: Case;
  accountPhone?: string;
  accountEmail?: string;
  accountContact?: string;
  onStartCall: () => void;
  onTransfer: () => void;
  onNoteAdded: (note: import('./types').CaseNote) => void;
  onTabFocusNote: () => void;
  callActive: boolean;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}) {
  const content = (
    <div className="space-y-4">
      <PanelSection title="Müşteri" icon={<Building2 size={12} />}>
        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-900">{item.accountName}</div>
          <div className="font-mono text-[11px] text-slate-500">{item.accountId}</div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge tint="slate">{item.companyName}</Badge>
            <Badge tint={item.priority === 'Critical' ? 'rose' : 'blue'}>{item.priority}</Badge>
          </div>
          {accountPhone && (
            <div className="flex items-center gap-1.5 pt-1 text-xs text-slate-600">
              <Phone size={11} />
              {accountPhone}
            </div>
          )}
          {accountEmail && (
            <div className="truncate text-[11px] text-slate-500">{accountEmail}</div>
          )}
          {accountContact && (
            <div className="text-[11px] text-slate-500">Yetkili: {accountContact}</div>
          )}
        </div>
      </PanelSection>


      <PanelSection title="SLA Durumu" icon={<Clock size={12} />}>
        <div className="space-y-1.5 text-xs">
          <SlaRow label="Yanıt SLA" value={item.slaResponseDueAt ? formatDateTime(item.slaResponseDueAt) : '—'} />
          <SlaRow
            label="Çözüm SLA"
            value={item.slaResolutionDueAt ? formatDateTime(item.slaResolutionDueAt) : '—'}
          />
          {item.slaResolutionDueAt && !item.slaViolation && !item.slaPausedAt && (
            <div className="rounded-md bg-blue-50 px-2 py-1 text-[11px] text-blue-800 ring-1 ring-blue-200">
              Çözüme {formatRelative(item.slaResolutionDueAt)}
            </div>
          )}
          {item.slaViolation && (
            <div className="rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-800 ring-1 ring-rose-200">
              <ShieldAlert size={11} className="mr-1 inline" />
              SLA İhlali aktif
            </div>
          )}
          {item.slaPausedAt && (
            <div className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800 ring-1 ring-amber-200">
              SLA duraklatıldı ({formatRelative(item.slaPausedAt)})
            </div>
          )}
        </div>
      </PanelSection>

      <PanelSection title="Atama" icon={<User size={12} />}>
        <div className="space-y-1 text-xs">
          <Row label="Vaka Sahibi" value={item.assignedPersonName ?? 'Atanmadı'} />
          <Row label="Takım" value={item.assignedTeamName ?? '—'} />
          <Row label="Eskalasyon" value={ESCALATION_LEVEL_LABELS[item.escalationLevel]} />
        </div>
      </PanelSection>

      <PanelSection title="Hızlı Aksiyonlar" icon={<Sparkles size={12} />}>
        <div className="grid grid-cols-1 gap-1.5">
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Phone size={12} />}
            onClick={onStartCall}
            disabled={callActive}
          >
            {callActive ? 'Çağrı aktif' : 'Çağrı Başlat'}
          </Button>
          <Button size="sm" variant="outline" leftIcon={<UserPlus size={12} />} onClick={onTransfer}>
            Devret
          </Button>
          <QuickNotePopover
            caseId={item.id}
            align="start"
            width={340}
            onAdded={onNoteAdded}
            trigger={({ toggle }) => (
              <Button
                size="sm"
                variant="outline"
                leftIcon={<MessageSquare size={12} />}
                onClick={toggle}
              >
                Hızlı Not
              </Button>
            )}
          />
          <button
            type="button"
            onClick={onTabFocusNote}
            className="text-[11px] text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
          >
            Tüm not akışını aç →
          </button>
        </div>
      </PanelSection>

    </div>
  );

  return (
    <>
      <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50/40 p-4 lg:block">
        {content}
      </aside>
      {drawerOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={onCloseDrawer} />
          <aside className="absolute left-0 top-0 h-full w-[320px] overflow-y-auto bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Müşteri Özeti</span>
              <button
                type="button"
                onClick={onCloseDrawer}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

function RightPanel({ item, offeredSolutions }: { item: Case; offeredSolutions: { id: string; name: string }[] }) {
  return (
    <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50/40 p-4 xl:block">
      <div className="space-y-4">
        <PanelSection
          title="AI Paneli"
          icon={<Brain size={12} />}
          badge={
            item.aiConfidenceScore != null ? (
              <Badge tint="indigo">{Math.round(item.aiConfidenceScore * 100)}% güven</Badge>
            ) : undefined
          }
        >
          <div className="space-y-3 text-xs">
            {/* AI Özeti — tam genişlik */}
            {item.aiSummary && (
              <div className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-900 ring-1 ring-indigo-200">
                {item.aiSummary}
              </div>
            )}

            {/* 4 öneri tile'ı — 2x2 grid */}
            <div className="grid grid-cols-2 gap-2">
              <AiTile
                label="Kategori önerisi"
                value={item.aiCategoryPrediction ?? '—'}
                tint="indigo"
              />
              <AiTile
                label="Öncelik önerisi"
                value={item.aiPriorityPrediction ?? '—'}
                tint="indigo"
              />
              <AiTile
                label="Duplicate skoru"
                value={item.aiDuplicateScore != null ? item.aiDuplicateScore.toFixed(2) : '—'}
                tint="slate"
              />
              <AiTile
                label="Güven skoru"
                value={item.aiConfidenceScore != null ? `${Math.round(item.aiConfidenceScore * 100)}%` : '—'}
                tint="slate"
              />
            </div>

            {/* Tam genişlik öneri kartları */}
            {item.aiCallBrief && (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Çağrı Özeti
                </div>
                {item.aiCallBrief}
              </div>
            )}
            {item.aiFollowupRecommendation && (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Takip Önerisi
                </div>
                {item.aiFollowupRecommendation}
              </div>
            )}
            {item.aiRetentionOfferSuggestion && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-200">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                  Retention Teklif Önerisi
                </div>
                {item.aiRetentionOfferSuggestion}
              </div>
            )}

            {/* Taslak Üret — tam genişlik */}
            <Button size="md" variant="outline" leftIcon={<Bot size={14} />} disabled className="w-full justify-center">
              Taslak Üret (FAZ 1+)
            </Button>

            {item.aiRejectReason && (
              <div className="rounded-md bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600 ring-1 ring-slate-200">
                <strong>Önceki red:</strong> {item.aiRejectReason}
              </div>
            )}
          </div>
        </PanelSection>

        {item.caseType === 'ProactiveTracking' && (
          <PanelSection title="Proaktif Takip" icon={<TrendingDown size={12} />} tint="violet">
            <div className="space-y-1 text-xs">
              <Row label="Finansal Risk"      value={item.financialStatus ?? '—'} />
              <Row label="Ürün Kullanımı"     value={item.productUsage ?? '—'} />
              <Row label="Kullanım Trendi"    value={item.usageChangeAlert ?? '—'} />
              <Row label="Müdahale Önceliği"  value={item.responseLevel ?? '—'} />
              <Row label="Toplam Çağrı"       value={String(item.callLogs.length)} />
            </div>
          </PanelSection>
        )}

        {item.caseType === 'Churn' && (
          <PanelSection title="Churn Yönetimi" icon={<Wallet size={12} />} tint="rose">
            <div className="space-y-2 text-xs">
              <Row label="İptal Talebi"    value={item.cancellationRequest ? 'Var' : 'Yok'} />
              <Row label="Teklif Sonucu"   value={item.offerOutcome ?? '—'} />
              <Row label="Churn Sonucu"    value={item.churnResult ?? '—'} />
              <Row label="Retention"       value={item.retentionStatus ?? '—'} />
              {item.followUpDate && (
                <Row label="Takip Tarihi" value={formatDateTime(item.followUpDate)} />
              )}
              {item.offeredSolutions && item.offeredSolutions.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                    Sunulan Teklifler
                  </div>
                  {item.offeredSolutions.map((id) => {
                    const def = offeredSolutions.find((o) => o.id === id);
                    return (
                      <div key={id} className="rounded bg-white px-2 py-1 text-slate-700 ring-1 ring-rose-200">
                        {def?.name ?? id}
                      </div>
                    );
                  })}
                </div>
              )}
              {item.offerRejectionReason && (
                <div className="rounded-md bg-rose-50 px-2 py-1.5 text-rose-900 ring-1 ring-rose-200">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                    Red Gerekçesi
                  </div>
                  {item.offerRejectionReason}
                </div>
              )}
            </div>
          </PanelSection>
        )}
      </div>
    </aside>
  );
}

function PanelSection({
  title,
  icon,
  badge,
  children,
  hidden,
  tint = 'default',
}: {
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  hidden?: boolean;
  tint?: 'default' | 'violet' | 'rose';
}) {
  if (hidden) return null;
  const ring =
    tint === 'violet' ? 'ring-violet-200' :
    tint === 'rose'   ? 'ring-rose-200' :
                         'ring-slate-200';
  return (
    <section className={`rounded-lg bg-white p-3 ring-1 ring-inset ${ring}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          {icon}
          {title}
        </h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className="truncate text-right text-slate-800">{value}</span>
    </div>
  );
}

function AiTile({
  label,
  value,
  tint = 'slate',
}: {
  label: string;
  value: string;
  tint?: 'slate' | 'indigo';
}) {
  const cls = tint === 'indigo' ? 'bg-indigo-50 ring-indigo-200' : 'bg-white ring-slate-200';
  return (
    <div className={`rounded-md px-2.5 py-2 ring-1 ring-inset ${cls}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function SlaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-slate-800">{value}</div>
    </div>
  );
}

// KpiCompact + KpiMini kaldırıldı — KPI artık Detay sekmesinin üstünde KpiInlineRow ile gösteriliyor

// ----------------------------------------------------------------
// Tab Components
// ----------------------------------------------------------------

function DetailTab({
  item,
  offeredSolutions,
  previousCases,
  onSelectPrevious,
  drafts,
  editingField,
  onStartEdit,
  onCancelEdit,
  onCommitDraft,
  onTransitionApplied,
}: {
  item: Case;
  offeredSolutions: { id: string; name: string }[];
  previousCases: Case[];
  onSelectPrevious: (id: string) => void;
  drafts: Partial<Case>;
  editingField: string | null;
  onStartEdit: (field: string) => void;
  onCancelEdit: () => void;
  onCommitDraft: (field: keyof Case, value: unknown) => void;
  onTransitionApplied: (updated: Case) => void;
}) {
  // Aktif değer = pending draft varsa onu göster, yoksa item değeri
  const v = <K extends keyof Case>(key: K): Case[K] =>
    (drafts[key] !== undefined ? drafts[key] : item[key]) as Case[K];

  return (
    <div className="space-y-5">
      {/* Statü Geçişi (header popover'ının yerini aldı — inline kart grid) */}
      <StatusTransitionPanel item={item} onApplied={onTransitionApplied} />

      {/* KPI 4-tile satırı (sol panelden buraya taşındı) */}
      <KpiInlineRow item={item} />

      <Section title="Açıklama">
        <InlineEdit
          fieldKey="description"
          type="textarea"
          value={v('description') ?? ''}
          editing={editingField === 'description'}
          isDraft={drafts.description !== undefined}
          onStart={() => onStartEdit('description')}
          onCommit={(val) => onCommitDraft('description', val)}
          onCancel={onCancelEdit}
          renderDisplay={(val) => (
            <p className="whitespace-pre-wrap text-sm text-slate-700">{String(val ?? '—')}</p>
          )}
        />
      </Section>

      <Section title="Müşteri & Sınıflandırma">
        <EditableGrid
          rows={[
            { label: 'Şirket', node: <span className="px-2 py-1 text-sm text-slate-800">{item.companyName}</span> },
            { label: 'Müşteri', node: <span className="px-2 py-1 text-sm text-slate-800">{item.accountName}</span> },
            { label: 'Kategori', node: <span className="px-2 py-1 text-sm text-slate-800">{item.category} / {item.subCategory}</span> },
            { label: 'Talep Türü', node: (
              <InlineEdit
                fieldKey="requestType"
                type="select"
                value={v('requestType')}
                editing={editingField === 'requestType'}
                isDraft={drafts.requestType !== undefined}
                onStart={() => onStartEdit('requestType')}
                onCommit={(val) => onCommitDraft('requestType', val)}
                onCancel={onCancelEdit}
                options={CASE_REQUEST_TYPES.map((r) => ({ value: r, label: r }))}
              />
            )},
            { label: 'Ürün Grubu', node: (
              <InlineEdit
                fieldKey="productGroup"
                type="text"
                value={v('productGroup')}
                editing={editingField === 'productGroup'}
                isDraft={drafts.productGroup !== undefined}
                onStart={() => onStartEdit('productGroup')}
                onCommit={(val) => onCommitDraft('productGroup', String(val))}
                onCancel={onCancelEdit}
                placeholder="ör. ERP - Kasa"
              />
            )},
            { label: 'Origin', node: (
              <InlineEdit
                fieldKey="origin"
                type="select"
                value={v('origin')}
                editing={editingField === 'origin'}
                isDraft={drafts.origin !== undefined}
                onStart={() => onStartEdit('origin')}
                onCommit={(val) => onCommitDraft('origin', val)}
                onCancel={onCancelEdit}
                options={CASE_ORIGINS.map((o) => ({ value: o, label: o }))}
              />
            )},
            { label: 'Origin Açıklama', node: (
              <InlineEdit
                fieldKey="originDescription"
                type="text"
                value={v('originDescription')}
                editing={editingField === 'originDescription'}
                isDraft={drafts.originDescription !== undefined}
                onStart={() => onStartEdit('originDescription')}
                onCommit={(val) => onCommitDraft('originDescription', String(val))}
                onCancel={onCancelEdit}
                disabled={v('origin') !== 'Diğer'}
                placeholder={v('origin') === 'Diğer' ? 'Origin = Diğer için zorunlu' : 'Yalnızca origin = Diğer'}
              />
            )},
            { label: '3. Parti Bekleniyor', node: <span className="px-2 py-1 text-sm text-slate-800">{item.thirdPartyName ?? '—'}</span> },
          ]}
        />
      </Section>

      {item.caseType === 'ProactiveTracking' && (
        <Section title="Proaktif Takip Bilgileri" tint="violet">
          <EditableGrid
            rows={[
              { label: 'Finansal Risk', node: (
                <InlineEdit
                  fieldKey="financialStatus" type="select" value={v('financialStatus')}
                  editing={editingField === 'financialStatus'}
                  isDraft={drafts.financialStatus !== undefined}
                  onStart={() => onStartEdit('financialStatus')}
                  onCommit={(val) => onCommitDraft('financialStatus', val)}
                  onCancel={onCancelEdit}
                  options={FINANCIAL_STATUSES.map((s) => ({ value: s, label: s }))}
                />
              )},
              { label: 'Ürün Kullanımı', node: (
                <InlineEdit
                  fieldKey="productUsage" type="select" value={v('productUsage')}
                  editing={editingField === 'productUsage'}
                  isDraft={drafts.productUsage !== undefined}
                  onStart={() => onStartEdit('productUsage')}
                  onCommit={(val) => onCommitDraft('productUsage', val)}
                  onCancel={onCancelEdit}
                  options={PRODUCT_USAGES.map((s) => ({ value: s, label: s }))}
                />
              )},
              { label: 'Kullanım Trendi', node: (
                <InlineEdit
                  fieldKey="usageChangeAlert" type="select" value={v('usageChangeAlert')}
                  editing={editingField === 'usageChangeAlert'}
                  isDraft={drafts.usageChangeAlert !== undefined}
                  onStart={() => onStartEdit('usageChangeAlert')}
                  onCommit={(val) => onCommitDraft('usageChangeAlert', val)}
                  onCancel={onCancelEdit}
                  options={USAGE_CHANGE_ALERTS.map((s) => ({ value: s, label: s }))}
                />
              )},
              { label: 'Müdahale Önceliği', node: (
                <InlineEdit
                  fieldKey="responseLevel" type="select" value={v('responseLevel')}
                  editing={editingField === 'responseLevel'}
                  isDraft={drafts.responseLevel !== undefined}
                  onStart={() => onStartEdit('responseLevel')}
                  onCommit={(val) => onCommitDraft('responseLevel', val)}
                  onCancel={onCancelEdit}
                  options={RESPONSE_LEVELS.map((s) => ({ value: s, label: s }))}
                />
              )},
            ]}
          />
        </Section>
      )}

      {item.caseType === 'Churn' && (
        <Section title="Churn Yönetimi" tint="rose">
          <EditableGrid
            rows={[
              { label: 'İptal Talebi', node: (
                <InlineEdit
                  fieldKey="cancellationRequest" type="checkbox" value={v('cancellationRequest')}
                  editing={editingField === 'cancellationRequest'}
                  isDraft={drafts.cancellationRequest !== undefined}
                  onStart={() => onStartEdit('cancellationRequest')}
                  onCommit={(val) => onCommitDraft('cancellationRequest', val)}
                  onCancel={onCancelEdit}
                  renderDisplay={(val) => <span className="px-2 py-1 text-sm text-slate-800">{val ? 'Var' : 'Yok'}</span>}
                />
              )},
              { label: 'Teklif Sonucu', node: (
                <InlineEdit
                  fieldKey="offerOutcome" type="select" value={v('offerOutcome')}
                  editing={editingField === 'offerOutcome'}
                  isDraft={drafts.offerOutcome !== undefined}
                  onStart={() => onStartEdit('offerOutcome')}
                  onCommit={(val) => onCommitDraft('offerOutcome', val)}
                  onCancel={onCancelEdit}
                  options={[{ value: '', label: '—' }, ...OFFER_OUTCOMES.map((o) => ({ value: o, label: o }))]}
                />
              )},
              { label: 'Teklif Geçerlilik', node: (
                <InlineEdit
                  fieldKey="offerExpiryDate" type="date" value={v('offerExpiryDate')}
                  editing={editingField === 'offerExpiryDate'}
                  isDraft={drafts.offerExpiryDate !== undefined}
                  onStart={() => onStartEdit('offerExpiryDate')}
                  onCommit={(val) => onCommitDraft('offerExpiryDate', val)}
                  onCancel={onCancelEdit}
                  renderDisplay={(val) => <span className="px-2 py-1 text-sm text-slate-800">{val ? formatDateTime(String(val)) : '—'}</span>}
                />
              )},
              { label: 'Takip Tarihi', node: (
                <InlineEdit
                  fieldKey="followUpDate" type="date" value={v('followUpDate')}
                  editing={editingField === 'followUpDate'}
                  isDraft={drafts.followUpDate !== undefined}
                  onStart={() => onStartEdit('followUpDate')}
                  onCommit={(val) => onCommitDraft('followUpDate', val)}
                  onCancel={onCancelEdit}
                  renderDisplay={(val) => <span className="px-2 py-1 text-sm text-slate-800">{val ? formatDateTime(String(val)) : '—'}</span>}
                />
              )},
              { label: 'Churn Sonucu', node: <span className="px-2 py-1 text-sm text-slate-800">{item.churnResult ?? '—'}</span> },
              { label: 'Retention Durumu', node: <span className="px-2 py-1 text-sm text-slate-800">{item.retentionStatus ?? '—'}</span> },
            ]}
          />

          <div className="mt-3 grid grid-cols-1 gap-2">
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Yapılan Aksiyon
              </h4>
              <InlineEdit
                fieldKey="actionTaken" type="textarea" value={v('actionTaken') ?? ''}
                editing={editingField === 'actionTaken'}
                isDraft={drafts.actionTaken !== undefined}
                onStart={() => onStartEdit('actionTaken')}
                onCommit={(val) => onCommitDraft('actionTaken', String(val))}
                onCancel={onCancelEdit}
                renderDisplay={(val) => (
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{val ? String(val) : <span className="text-slate-400">— eklenmemiş —</span>}</p>
                )}
              />
            </div>
            {(v('offerOutcome') === 'Reddedildi' || drafts.offerOutcome === 'Reddedildi') && (
              <div>
                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700">
                  Red Gerekçesi
                </h4>
                <InlineEdit
                  fieldKey="offerRejectionReason" type="textarea" value={v('offerRejectionReason') ?? ''}
                  editing={editingField === 'offerRejectionReason'}
                  isDraft={drafts.offerRejectionReason !== undefined}
                  onStart={() => onStartEdit('offerRejectionReason')}
                  onCommit={(val) => onCommitDraft('offerRejectionReason', String(val))}
                  onCancel={onCancelEdit}
                  renderDisplay={(val) => (
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{val ? String(val) : <span className="text-slate-400">— eklenmemiş —</span>}</p>
                  )}
                />
              </div>
            )}
          </div>

          {item.offeredSolutions && item.offeredSolutions.length > 0 && (
            <div className="mt-3">
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Sunulan Teklifler
              </h4>
              <ul className="space-y-1">
                {item.offeredSolutions.map((id) => {
                  const def = offeredSolutions.find((o) => o.id === id);
                  return (
                    <li
                      key={id}
                      className="rounded-md bg-rose-50/60 px-3 py-1.5 text-sm ring-1 ring-rose-200"
                    >
                      <span className="font-medium text-slate-800">{def?.name ?? id}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Section>
      )}

      <Section title="SLA & Tarihler">
        <DetailGrid
          rows={[
            ['Yanıt SLA', item.slaResponseDueAt ? formatDateTime(item.slaResponseDueAt) : '—'],
            ['Çözüm SLA', item.slaResolutionDueAt ? formatDateTime(item.slaResolutionDueAt) : '—'],
            ['SLA Duraklatıldı', item.slaPausedAt ? formatDateTime(item.slaPausedAt) : 'Hayır'],
            ['Toplam Pause', `${item.slaPausedDurationMin} dk`],
            ['Açılış', formatDateTime(item.createdAt)],
            ['Son Güncelleme', formatDateTime(item.updatedAt)],
            ['Çözüm', item.resolvedAt ? formatDateTime(item.resolvedAt) : '—'],
          ]}
        />
      </Section>

      {item.resolutionNote && (
        <Section title="Çözüm Notu" tint="emerald">
          <p className="whitespace-pre-wrap rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
            {item.resolutionNote}
          </p>
        </Section>
      )}

      {item.cancellationReason && (
        <Section title="İptal Gerekçesi">
          <p className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
            {item.cancellationReason}
          </p>
        </Section>
      )}

      {/* Sol panelden buraya taşındı — bu müşteriye ait kapalı/çözülmüş vakalar */}
      {previousCases.length > 0 && (
        <Section title={`Önceki Vakalar (${previousCases.length})`}>
          <ul className="space-y-1.5">
            {previousCases.slice(0, 3).map((p) => {
              const refDate = p.resolvedAt ?? p.updatedAt;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelectPrevious(p.id)}
                    className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <span className="font-mono text-[11px] text-slate-500">{p.caseNumber}</span>
                    <span className="flex-1 truncate text-sm font-medium text-slate-800">{p.title}</span>
                    <StatusPill status={p.status} />
                    <span className="text-[11px] text-slate-500">{formatRelative(refDate)}</span>
                  </button>
                </li>
              );
            })}
            {previousCases.length > 3 && (
              <li className="pl-2 text-[11px] text-slate-500">
                +{previousCases.length - 3} vaka daha…
              </li>
            )}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// KPI Inline Row — Detay sekmesinin üstünde 4-tile satır
// ----------------------------------------------------------------
function KpiInlineRow({ item }: { item: Case }) {
  const minutes = (a: string, b: string) =>
    Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  const fmt = (m: number) => {
    if (m < 60) return `${m} dk`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} sa`;
    return `${Math.round(h / 24)} gün`;
  };
  const firstReview = item.history.find(
    (h) => h.action === 'Statü değişti' && h.toValue === 'İncelemede',
  );
  const responseMin = firstReview ? minutes(item.createdAt, firstReview.at) : null;
  const resolutionMin = item.resolvedAt ? minutes(item.createdAt, item.resolvedAt) : null;
  const fcr = responseMin != null && resolutionMin != null && resolutionMin <= 24 * 60;
  const reopened = item.history.some(
    (h) => h.action === 'Statü değişti' && h.fromValue === 'Çözüldü' && h.toValue === 'YenidenAcildi',
  );

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <KpiInlineTile icon={<TrendingUp size={12} />} label="Müdahale Süresi" value={responseMin != null ? fmt(responseMin) : '—'} />
      <KpiInlineTile icon={<CheckCircle2 size={12} />} label="Çözüm Süresi"   value={resolutionMin != null ? fmt(resolutionMin) : '—'} />
      <KpiInlineTile
        icon={<Target size={12} />}
        label="İlk Temas Çözüm"
        value={fcr ? 'Evet' : resolutionMin != null ? 'Hayır' : '—'}
        tone={fcr ? 'good' : resolutionMin != null ? 'warn' : 'neutral'}
      />
      <KpiInlineTile
        icon={<HistoryIcon size={12} />}
        label="Yeniden Açılma"
        value={reopened ? 'Var' : 'Yok'}
        tone={reopened ? 'warn' : 'neutral'}
      />
    </div>
  );
}

function KpiInlineTile({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn';
}) {
  const cls =
    tone === 'good' ? 'bg-emerald-50 ring-emerald-200' :
    tone === 'warn' ? 'bg-amber-50 ring-amber-200' :
                       'bg-slate-50 ring-slate-200';
  return (
    <div className={`rounded-lg p-3 ring-1 ring-inset ${cls}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-600">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

// ----------------------------------------------------------------
// Inline edit (click-to-edit; ESC/click outside iptal eder; commit draft state'e gider,
// header'daki Kaydet butonu drafts'ı caseService.update ile flush eder)
// ----------------------------------------------------------------
type InlineEditType = 'text' | 'textarea' | 'select' | 'checkbox' | 'date';

function InlineEdit({
  fieldKey,
  type,
  value,
  options,
  editing,
  isDraft,
  onStart,
  onCommit,
  onCancel,
  renderDisplay,
  placeholder,
  disabled,
}: {
  fieldKey: string;
  type: InlineEditType;
  value: unknown;
  options?: { value: string; label: string }[];
  editing: boolean;
  isDraft: boolean;
  onStart: () => void;
  onCommit: (newValue: unknown) => void;
  onCancel: () => void;
  renderDisplay?: (val: unknown) => React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<unknown>(value);

  // editing açıldığında draft'ı resetle
  useEffect(() => {
    if (editing) setDraft(value);
  }, [editing, value]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          if (disabled) return;
          e.preventDefault();
          onStart();
        }}
        title={disabled ? '' : `${fieldKey} alanını düzenle`}
        className={`group relative w-full rounded-md text-left transition ${
          disabled
            ? 'cursor-default'
            : 'cursor-text hover:bg-slate-100/70 hover:ring-1 hover:ring-slate-200'
        } ${isDraft ? 'bg-amber-50 ring-1 ring-amber-300' : ''}`}
      >
        <span className="block px-2 py-1">
          {renderDisplay ? renderDisplay(value) : (value ? String(value) : <span className="text-slate-400">—</span>)}
        </span>
        {isDraft && (
          <span className="absolute right-1 top-1 rounded bg-amber-200 px-1 text-[9px] font-semibold text-amber-900">
            taslak
          </span>
        )}
      </button>
    );
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && type !== 'textarea' && !(e.shiftKey)) {
      e.preventDefault();
      onCommit(draft);
    }
  }

  if (type === 'textarea') {
    return (
      <div className="rounded-md ring-2 ring-brand-300">
        <TextArea
          autoFocus
          value={String(draft ?? '')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            // Click outside iptal — eğer relatedTarget Kaydet butonuna gitmiyorsa
            const next = e.relatedTarget as HTMLElement | null;
            if (next?.dataset?.role === 'commit-draft') {
              onCommit(draft);
            } else {
              onCancel();
            }
          }}
          onKeyDown={handleKey}
          placeholder={placeholder}
          rows={4}
        />
        <div className="flex justify-end gap-2 px-2 py-1 text-[11px] text-slate-500">
          <span>ESC iptal</span>
          <button
            type="button"
            data-role="commit-draft"
            onMouseDown={(e) => {
              e.preventDefault();
              onCommit(draft);
            }}
            className="font-medium text-brand-700 hover:underline"
          >
            Onayla (taslağa al)
          </button>
        </div>
      </div>
    );
  }

  if (type === 'select') {
    return (
      <Select
        autoFocus
        value={String(draft ?? '')}
        onChange={(e) => {
          setDraft(e.target.value);
          onCommit(e.target.value);
        }}
        onBlur={onCancel}
        onKeyDown={handleKey}
      >
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }

  if (type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 px-2 py-1 text-sm text-slate-700">
        <input
          type="checkbox"
          autoFocus
          checked={Boolean(draft)}
          onChange={(e) => {
            setDraft(e.target.checked);
            onCommit(e.target.checked);
          }}
          onKeyDown={handleKey}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        <span className="text-[11px] text-slate-500">(ESC iptal)</span>
      </label>
    );
  }

  // text / date
  return (
    <input
      autoFocus
      type={type === 'date' ? 'date' : 'text'}
      value={String(draft ?? '')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        const next = e.relatedTarget as HTMLElement | null;
        if (next?.dataset?.role === 'commit-draft') {
          onCommit(draft);
        } else {
          onCancel();
        }
      }}
      onKeyDown={handleKey}
      placeholder={placeholder}
      className="w-full rounded-md border border-brand-300 bg-white px-3 py-1.5 text-sm text-slate-800 ring-2 ring-brand-200 focus:outline-none"
    />
  );
}

function ActivityTab({ item }: { item: Case }) {
  return (
    <ol className="relative space-y-3 border-l-2 border-slate-200 pl-4">
      {item.history.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute -left-[22px] top-1 inline-block h-3 w-3 rounded-full bg-brand-500 ring-4 ring-white" />
          <div className="text-sm font-medium text-slate-800">
            {h.action}
            {h.fromValue && h.toValue && (
              <span className="ml-2 text-xs font-normal text-slate-500">
                {h.fromValue} → {h.toValue}
              </span>
            )}
            {!h.fromValue && h.toValue && (
              <span className="ml-2 text-xs font-normal text-slate-500">→ {h.toValue}</span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
            <Calendar size={12} />
            {formatDateTime(h.at)}
            <span>·</span>
            <span>{h.actor}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function NotesTab({
  item,
  noteText,
  noteVisibility,
  onChangeText,
  onChangeVisibility,
  onSubmit,
  inputRef,
}: {
  item: Case;
  noteText: string;
  noteVisibility: NoteVisibility;
  onChangeText: (s: string) => void;
  onChangeVisibility: (v: NoteVisibility) => void;
  onSubmit: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const [voiceListening, setVoiceListening] = useState(false);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <Field label="Yeni Not">
          <div className="relative">
            <TextArea
              ref={inputRef}
              value={noteText}
              onChange={(e) => onChangeText(e.target.value)}
              placeholder={voiceListening ? 'Dinleniyor…' : 'Not yazın veya mikrofona basın…'}
              rows={3}
              className="pr-10"
            />
            <VoiceNoteButton
              onTranscript={(chunk) => onChangeText(noteText ? `${noteText} ${chunk}` : chunk)}
              onListeningChange={setVoiceListening}
              className="absolute bottom-2 right-2"
            />
          </div>
        </Field>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-600">Görünürlük:</span>
            <button
              onClick={() => onChangeVisibility('Internal')}
              className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${
                noteVisibility === 'Internal'
                  ? 'bg-slate-200 text-slate-800 ring-slate-300'
                  : 'bg-white text-slate-500 ring-slate-200'
              }`}
            >
              İç Not
            </button>
            <button
              onClick={() => onChangeVisibility('Customer')}
              className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${
                noteVisibility === 'Customer'
                  ? 'bg-blue-100 text-blue-800 ring-blue-300'
                  : 'bg-white text-slate-500 ring-slate-200'
              }`}
            >
              Müşteriye Görünür
            </button>
          </div>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={!noteText.trim()}
            leftIcon={<Send size={14} />}
          >
            Not Ekle
          </Button>
        </div>
      </div>
      {item.notes.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Henüz not yok.</p>
      ) : (
        <ul className="space-y-2">
          {item.notes.map((n) => {
            const isInternal = n.visibility === 'Internal';
            return (
              <li
                key={n.id}
                className={`rounded-md px-3 py-2 ring-1 ring-inset ${
                  isInternal ? 'bg-slate-50 ring-slate-200' : 'bg-blue-50 ring-blue-200'
                }`}
              >
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{n.authorName}</span>
                  <div className="flex items-center gap-2">
                    <Badge tint={isInternal ? 'slate' : 'blue'}>
                      {isInternal ? 'İç Not' : 'Müşteriye Görünür'}
                    </Badge>
                    <span className="text-slate-500">{formatDateTime(n.createdAt)}</span>
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-800">{n.content}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FilesTab({ item }: { item: Case }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Maks. 25MB / dosya · 20 dosya / vaka. <em>FAZ 0'da yükleme devre dışı.</em>
        </p>
        <Button size="sm" variant="outline" leftIcon={<ExternalLink size={12} />} disabled>
          Yükle (FAZ 4+)
        </Button>
      </div>
      {item.files.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Henüz dosya yok.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md ring-1 ring-slate-200">
          {item.files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Paperclip size={14} className="text-slate-400" />
              <span className="flex-1 truncate text-slate-800">{f.fileName}</span>
              <span className="text-xs text-slate-500">{formatBytes(f.fileSize)}</span>
              <span className="text-xs text-slate-500">{formatDateTime(f.uploadedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CallLogsTab({ item }: { item: Case }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Çağrı kayıtları — toplam <strong>{item.callLogs.length}</strong>.
        </p>
        <Button size="sm" variant="outline" leftIcon={<Mic size={12} />} disabled>
          Çağrı Kaydı Ekle (FAZ 1+)
        </Button>
      </div>
      {item.callLogs.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Çağrı kaydı yok.</p>
      ) : (
        <ul className="space-y-2">
          {item.callLogs.map((cl) => (
            <li key={cl.id} className="rounded-md bg-violet-50/40 px-3 py-2 ring-1 ring-violet-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">{cl.callerName}</span>
                <span className="text-[11px] text-slate-500">
                  {formatDateTime(cl.callDate)} · {cl.durationMin} dk
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tint="violet">{cl.callDisposition}</Badge>
                <Badge tint="slate">{cl.callOutcome}</Badge>
                {cl.nextFollowupDate && (
                  <span className="text-[11px] text-slate-600">
                    Sonraki: {formatDateTime(cl.nextFollowupDate)}
                  </span>
                )}
              </div>
              {cl.description && (
                <p className="mt-1.5 text-xs text-slate-700">{cl.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function Section({
  title,
  tint = 'default',
  children,
}: {
  title: string;
  tint?: 'default' | 'violet' | 'rose' | 'emerald';
  children: React.ReactNode;
}) {
  const ring =
    tint === 'violet'  ? 'ring-violet-200 bg-violet-50/30' :
    tint === 'rose'    ? 'ring-rose-200 bg-rose-50/30' :
    tint === 'emerald' ? 'ring-emerald-200 bg-emerald-50/30' :
                          'ring-slate-200 bg-white';
  return (
    <section className={`rounded-lg p-4 ring-1 ring-inset ${ring}`}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      {children}
    </section>
  );
}

function DetailGrid({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-md ring-1 ring-slate-200 sm:grid-cols-2">
      {rows.map(([label, value], i) => (
        <div
          key={label}
          className={`flex flex-col gap-0.5 px-3 py-2 ${
            i < rows.length - 1 ? 'border-b border-slate-100 sm:border-b-0' : ''
          }`}
        >
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="text-sm text-slate-800">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EditableGrid({ rows }: { rows: { label: string; node: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-md ring-1 ring-slate-200 sm:grid-cols-2">
      {rows.map((r, i) => (
        <div
          key={r.label}
          className={`flex flex-col gap-0.5 px-2 py-1.5 ${
            i < rows.length - 1 ? 'border-b border-slate-100 sm:border-b-0' : ''
          }`}
        >
          <dt className="px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">{r.label}</dt>
          <dd>{r.node}</dd>
        </div>
      ))}
    </dl>
  );
}
