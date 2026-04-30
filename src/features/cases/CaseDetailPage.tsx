import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Brain,
  Building2,
  Calendar,
  Check,
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
  Pencil,
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
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Popover } from '@/components/ui/Popover';
import { ActiveCallBanner } from '@/components/ui/ActiveCallBanner';
import { QuickNotePopover } from '@/components/ui/QuickNotePopover';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { RunaAiCard } from '@/components/ui/RunaAiCard';
import { StatusTransitionPanel } from './StatusTransitionPanel';
import { CaseTypeBadge, PriorityBadge, StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { caseService, lookupService } from '@/services/caseService';
import { aiService, aiErrorMessage, type ChurnConversion } from '@/services/aiService';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import {
  CALL_DISPOSITIONS,
  CALL_OUTCOMES,
  CASE_FIELD_LABELS,
  CASE_ORIGINS,
  CASE_REQUEST_TYPES,
  ESCALATION_LEVELS,
  ESCALATION_LEVEL_LABELS,
  FINANCIAL_STATUSES,
  OFFER_OUTCOMES,
  PRODUCT_USAGES,
  RESPONSE_LEVELS,
  USAGE_CHANGE_ALERTS,
  type CallDisposition,
  type CallOutcome,
  type Case,
  type EscalationLevel,
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
  const categories = useMemo(() => lookupService.categories(), []);
  const teams = useMemo(() => lookupService.teams(), []);
  const persons = useMemo(() => lookupService.persons(), []);
  const thirdParties = useMemo(() => lookupService.thirdParties(), []);
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
      let next: Record<string, unknown> = { ...(prev as Record<string, unknown>) };
      // Mevcut değerle aynıysa draft'ı kaldır
      if ((item as Record<string, unknown> | null)?.[field as string] === value) {
        delete next[field as string];
      } else {
        next[field as string] = value;
      }

      // Cascade temizleme: kategori değişince eskimiş alt kategori'yi düşür
      if (field === 'category') {
        const cat = categories.find((c) => c.category === value);
        const currentSub = (next.subCategory ?? item?.subCategory) as string | undefined;
        if (cat && currentSub && !cat.subCategories.includes(currentSub)) {
          // Alt kategori artık geçersiz — taslakta sıfırla (boş)
          next.subCategory = '';
        }
      }
      // Takım değişince eski kişi'yi düşür
      if (field === 'assignedTeamId') {
        const teamPersons = persons.filter((p) => p.teamId === value);
        const currentPersonId = (next.assignedPersonId ?? item?.assignedPersonId) as string | undefined;
        if (currentPersonId && !teamPersons.find((p) => p.id === currentPersonId)) {
          next.assignedPersonId = '';
          next.assignedPersonName = '';
        }
        // Takım adını da senkronize et (denormalized)
        const team = teams.find((t) => t.id === value);
        next.assignedTeamName = team?.name ?? '';
      }
      // Kişi değişince adını senkronize et
      if (field === 'assignedPersonId') {
        const person = persons.find((p) => p.id === value);
        next.assignedPersonName = person?.name ?? '';
      }
      // 3. parti seçilince adını senkronize et
      if (field === 'thirdPartyId') {
        const tp = thirdParties.find((t) => t.id === value);
        next.thirdPartyName = tp?.name ?? '';
      }

      return next as Partial<Case>;
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
                categories={categories}
                teams={teams}
                persons={persons}
                thirdParties={thirdParties}
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
            {tab === 'callLogs' && (
              <CallLogsTab item={item} onItemUpdated={(c) => setItem(c)} />
            )}
          </div>
        </main>

        {/* Right panel — RUNA AI + type-specific summary (her vakada görünür) */}
        <RightPanel
          item={item}
          offeredSolutions={offeredSolutions}
          onCaseUpdated={(updated) => setItem(updated)}
        />

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
            width={280}
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

function RightPanel({
  item,
  offeredSolutions,
  onCaseUpdated,
}: {
  item: Case;
  offeredSolutions: { id: string; name: string }[];
  onCaseUpdated: (updated: Case) => void;
}) {
  const { toast } = useToast();
  const [analyzing, setAnalyzing] = useState(false);
  const [churnAnalyzing, setChurnAnalyzing] = useState(false);
  const [churnResult, setChurnResult] = useState<ChurnConversion | null>(null);
  const [converting, setConverting] = useState(false);

  // Vaka değişince churn preview state'ini sıfırla
  useEffect(() => {
    setChurnResult(null);
  }, [item.id]);

  async function handleAnalyze() {
    setAnalyzing(true);
    const r = await aiService.supervisorSummary({
      case: {
        title: item.title,
        description: item.description,
        category: item.category,
        subCategory: item.subCategory,
        status: item.status,
        priority: item.priority,
        slaViolation: item.slaViolation,
      },
      history: item.history,
      notes: item.notes,
      callLogs: item.callLogs,
    });
    if (!r.ok) {
      setAnalyzing(false);
      toast({ type: 'warn', message: aiErrorMessage(r.error), duration: 2500 });
      return;
    }
    const updated = await caseService.update(item.id, {
      aiSummary: r.data.summary,
      aiFollowupRecommendation: r.data.recommendation,
    });
    setAnalyzing(false);
    if (updated) {
      onCaseUpdated(updated);
      toast({ type: 'success', message: 'Vaka analizi tamamlandı.', duration: 2000 });
    }
  }

  async function handleChurnAnalysis() {
    setChurnAnalyzing(true);
    const r = await aiService.churnConversion({
      case: { title: item.title, companyName: item.companyName, accountName: item.accountName },
      callLogs: item.callLogs,
      financialStatus: item.financialStatus,
      productUsage: item.productUsage,
      usageChangeAlert: item.usageChangeAlert,
    });
    setChurnAnalyzing(false);
    if (r.ok) {
      setChurnResult(r.data);
    } else {
      toast({ type: 'warn', message: aiErrorMessage(r.error), duration: 2500 });
    }
  }

  async function handleConvertToChurn() {
    if (!churnResult) return;
    if (!window.confirm('Vakayı Churn tipine dönüştürmek istediğinizden emin misiniz?')) return;
    setConverting(true);
    const updated = await caseService.update(item.id, {
      caseType: 'Churn',
      aiRetentionOfferSuggestion: churnResult.suggestedAction,
    });
    setConverting(false);
    if (updated) {
      onCaseUpdated(updated);
      toast({ type: 'success', message: 'Vaka Churn tipine dönüştürüldü.', duration: 2200 });
    }
  }

  return (
    <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50/40 p-4 xl:block">
      <div className="space-y-4">
        {/* RUNA AI — Vaka özeti / analiz */}
        <RunaAiCard
          title={item.aiSummary ? 'Vaka Özeti' : 'RUNA AI Hazır'}
          body={item.aiSummary ?? 'Bu vaka için henüz AI analizi yapılmadı.'}
          isLoading={analyzing}
          badges={
            item.aiConfidenceScore != null
              ? [`%${Math.round(item.aiConfidenceScore * 100)} güven`]
              : []
          }
          primaryAction={
            !analyzing
              ? {
                  label: item.aiSummary ? '✦ Yeniden Analiz Et' : '✦ Analiz Et',
                  onClick: () => void handleAnalyze(),
                }
              : undefined
          }
        />

        {/* AI ek detaylar (varsa) — RUNA AI'ın altında ek context olarak */}
        {(item.aiCategoryPrediction ||
          item.aiPriorityPrediction ||
          item.aiCallBrief ||
          item.aiFollowupRecommendation ||
          item.aiRetentionOfferSuggestion ||
          item.aiRejectReason) && (
          <PanelSection title="AI Detayları" icon={<Brain size={12} />}>
            <div className="space-y-3 text-xs">
              {(item.aiCategoryPrediction || item.aiPriorityPrediction) && (
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
                </div>
              )}
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
              {item.aiRejectReason && (
                <div className="rounded-md bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600 ring-1 ring-slate-200">
                  <strong>Önceki red:</strong> {item.aiRejectReason}
                </div>
              )}
            </div>
          </PanelSection>
        )}

        {item.caseType === 'ProactiveTracking' && (
          <>
            <PanelSection title="Proaktif Takip" icon={<TrendingDown size={12} />} tint="violet">
              <div className="space-y-1 text-xs">
                <Row label="Finansal Risk"      value={item.financialStatus ?? '—'} />
                <Row label="Ürün Kullanımı"     value={item.productUsage ?? '—'} />
                <Row label="Kullanım Trendi"    value={item.usageChangeAlert ?? '—'} />
                <Row label="Müdahale Önceliği"  value={item.responseLevel ?? '—'} />
                <Row label="Toplam Çağrı"       value={String(item.callLogs.length)} />
              </div>
            </PanelSection>

            {/* RUNA AI — Churn risk değerlendirmesi */}
            <RunaAiCard
              title="Churn Risk Değerlendirmesi"
              body={
                churnResult?.reasoning ??
                'Churn riskini değerlendirmek için analiz başlatın. Finansal durum, ürün kullanımı ve arama geçmişi incelenir.'
              }
              badges={
                churnResult
                  ? [
                      `Risk: ${churnResult.churnRisk}`,
                      churnResult.shouldConvert ? 'Dönüşüm önerilir' : 'Bekle',
                    ]
                  : []
              }
              isLoading={churnAnalyzing}
              primaryAction={
                !churnResult && !churnAnalyzing
                  ? { label: '✦ Değerlendir', onClick: () => void handleChurnAnalysis() }
                  : undefined
              }
              dangerAction={
                churnResult?.shouldConvert
                  ? {
                      label: converting ? 'Dönüştürülüyor…' : "Churn'e Dönüştür",
                      onClick: () => void handleConvertToChurn(),
                      disabled: converting,
                    }
                  : undefined
              }
              secondaryAction={
                churnResult
                  ? { label: 'Yeniden', onClick: () => void handleChurnAnalysis() }
                  : undefined
              }
            />
          </>
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
  categories,
  teams,
  persons,
  thirdParties,
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
  categories: { category: string; subCategories: string[] }[];
  teams: { id: string; name: string }[];
  persons: { id: string; name: string; teamId: string }[];
  thirdParties: { id: string; name: string }[];
  previousCases: Case[];
  onSelectPrevious: (id: string) => void;
  drafts: Partial<Case>;
  editingField: string | null;
  onStartEdit: (field: string) => void;
  onCancelEdit: () => void;
  onCommitDraft: (field: keyof Case, value: unknown) => void;
  onTransitionApplied: (updated: Case) => void;
}) {
  // Kategori cascade — taslakta seçili kategoriye göre alt-kategori opsiyonları
  const activeCategory = (drafts.category ?? item.category) as string;
  const subCategoryOptions = categories.find((c) => c.category === activeCategory)?.subCategories ?? [];
  // Takım cascade — seçili takıma göre kişi opsiyonları
  const activeTeamId = (drafts.assignedTeamId ?? item.assignedTeamId) as string | undefined;
  const personOptions = activeTeamId ? persons.filter((p) => p.teamId === activeTeamId) : persons;
  // Aktif değer = pending draft varsa onu göster, yoksa item değeri
  const v = <K extends keyof Case>(key: K): Case[K] =>
    (drafts[key] !== undefined ? drafts[key] : item[key]) as Case[K];

  return (
    <div className="space-y-5">
      {/* Statü Geçişi (header popover'ının yerini aldı — inline kart grid) */}
      <StatusTransitionPanel item={item} onApplied={onTransitionApplied} />

      {/* Inline edit bilgi notu */}
      <p className="flex items-center gap-1.5 text-[12px] text-slate-500">
        <Pencil size={11} className="text-slate-400" />
        Alanlara tıklayarak düzenleyebilirsiniz. Değişiklikleri üst köşedeki <strong>Kaydet</strong> butonuyla saklayın.
      </p>

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
            { label: 'Şirket', node: <span className="block cursor-default px-2 py-1 text-sm text-slate-800">{item.companyName}</span> },
            { label: 'Müşteri', node: <span className="block cursor-default px-2 py-1 text-sm text-slate-800">{item.accountName}</span> },
            { label: 'Kategori', node: (
              <InlineEdit
                fieldKey="category"
                type="select"
                value={v('category') ?? ''}
                editing={editingField === 'category'}
                isDraft={drafts.category !== undefined}
                onStart={() => onStartEdit('category')}
                onCommit={(val) => onCommitDraft('category', val)}
                onCancel={onCancelEdit}
                options={categories.map((c) => ({ value: c.category, label: c.category }))}
              />
            )},
            { label: 'Alt Kategori', node: (
              <InlineEdit
                fieldKey="subCategory"
                type="select"
                value={v('subCategory') ?? ''}
                editing={editingField === 'subCategory'}
                isDraft={drafts.subCategory !== undefined}
                onStart={() => onStartEdit('subCategory')}
                onCommit={(val) => onCommitDraft('subCategory', val)}
                onCancel={onCancelEdit}
                options={[{ value: '', label: '— Seçin —' }, ...subCategoryOptions.map((s) => ({ value: s, label: s }))]}
                disabled={!activeCategory}
              />
            )},
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
                type="select"
                value={v('productGroup') ?? ''}
                editing={editingField === 'productGroup'}
                isDraft={drafts.productGroup !== undefined}
                onStart={() => onStartEdit('productGroup')}
                onCommit={(val) => onCommitDraft('productGroup', val)}
                onCancel={onCancelEdit}
                options={[{ value: '', label: '— Seçin —' }, ...lookupService.productGroups().map((p) => ({ value: p, label: p }))]}
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
            { label: '3. Parti Bekleniyor', node: (
              <InlineEdit
                fieldKey="thirdPartyId"
                type="select"
                value={v('thirdPartyId') ?? ''}
                editing={editingField === 'thirdPartyId'}
                isDraft={drafts.thirdPartyId !== undefined}
                onStart={() => onStartEdit('thirdPartyId')}
                onCommit={(val) => onCommitDraft('thirdPartyId', val)}
                onCancel={onCancelEdit}
                options={[{ value: '', label: '— Yok —' }, ...thirdParties.map((tp) => ({ value: tp.id, label: tp.name }))]}
                renderDisplay={() => (
                  <span className="text-sm text-slate-800">
                    {(drafts.thirdPartyName as string | undefined) ?? item.thirdPartyName ?? '—'}
                  </span>
                )}
              />
            )},
          ]}
        />
      </Section>

      {/* Atama & Eskalasyon — sol panelden bağımsız, inline-edit'li alanlar */}
      <Section title="Atama & Eskalasyon">
        <EditableGrid
          rows={[
            { label: 'Atanan Takım', node: (
              <InlineEdit
                fieldKey="assignedTeamId"
                type="select"
                value={v('assignedTeamId') ?? ''}
                editing={editingField === 'assignedTeamId'}
                isDraft={drafts.assignedTeamId !== undefined}
                onStart={() => onStartEdit('assignedTeamId')}
                onCommit={(val) => onCommitDraft('assignedTeamId', val)}
                onCancel={onCancelEdit}
                options={[{ value: '', label: '— Atanmadı —' }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
                renderDisplay={() => (
                  <span className="text-sm text-slate-800">
                    {(drafts.assignedTeamName as string | undefined) ?? item.assignedTeamName ?? '—'}
                  </span>
                )}
              />
            )},
            { label: 'Atanan Kişi', node: (
              <InlineEdit
                fieldKey="assignedPersonId"
                type="select"
                value={v('assignedPersonId') ?? ''}
                editing={editingField === 'assignedPersonId'}
                isDraft={drafts.assignedPersonId !== undefined}
                onStart={() => onStartEdit('assignedPersonId')}
                onCommit={(val) => onCommitDraft('assignedPersonId', val)}
                onCancel={onCancelEdit}
                options={[
                  { value: '', label: activeTeamId ? '— Atanmadı —' : '— Önce takım seçin —' },
                  ...personOptions.map((p) => ({ value: p.id, label: p.name })),
                ]}
                disabled={!activeTeamId}
                renderDisplay={() => (
                  <span className="text-sm text-slate-800">
                    {(drafts.assignedPersonName as string | undefined) ?? item.assignedPersonName ?? '—'}
                  </span>
                )}
              />
            )},
            { label: 'Eskalasyon', node: (
              <InlineEdit
                fieldKey="escalationLevel"
                type="select"
                value={v('escalationLevel')}
                editing={editingField === 'escalationLevel'}
                isDraft={drafts.escalationLevel !== undefined}
                onStart={() => onStartEdit('escalationLevel')}
                onCommit={(val) => onCommitDraft('escalationLevel', val)}
                onCancel={onCancelEdit}
                options={ESCALATION_LEVELS.map((l) => ({ value: l, label: ESCALATION_LEVEL_LABELS[l] }))}
                renderDisplay={() => (
                  <span className="text-sm text-slate-800">
                    {ESCALATION_LEVEL_LABELS[(drafts.escalationLevel as EscalationLevel | undefined) ?? item.escalationLevel]}
                  </span>
                )}
              />
            )},
            { label: 'Vaka Sahibi', node: <span className="block cursor-default px-2 py-1 text-sm text-slate-500" title="Otomatik atanır">{item.assignedPersonName ?? 'Atanmadı'}</span> },
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

          {/* Sunulan Teklifler — her zaman görünür; ekle/çıkar butonları taslağa yazar */}
          <OfferedSolutionsBlock
            currentIds={(v('offeredSolutions') ?? []) as string[]}
            options={offeredSolutions}
            isDraft={drafts.offeredSolutions !== undefined}
            onChange={(newIds) => onCommitDraft('offeredSolutions', newIds)}
          />
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
// Sunulan Teklifler — Churn yönetimindeki çoklu teklif seçim alanı
// ----------------------------------------------------------------

function OfferedSolutionsBlock({
  currentIds,
  options,
  isDraft,
  onChange,
}: {
  currentIds: string[];
  options: { id: string; name: string; description?: string }[];
  isDraft: boolean;
  onChange: (newIds: string[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function handleRemove(id: string) {
    onChange(currentIds.filter((x) => x !== id));
  }

  return (
    <>
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Sunulan Teklifler
            {isDraft && (
              <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
                Taslak
              </span>
            )}
          </h4>
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            + Teklif Sun
          </Button>
        </div>
        {currentIds.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-500">
            Henüz teklif sunulmadı. <strong>+ Teklif Sun</strong> ile listeden seçim yapabilirsiniz.
          </div>
        ) : (
          <ul className="space-y-1">
            {currentIds.map((id) => {
              const def = options.find((o) => o.id === id);
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-2 rounded-md bg-rose-50/60 px-3 py-1.5 text-sm ring-1 ring-rose-200"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-800">{def?.name ?? `Bilinmeyen teklif (${id})`}</div>
                    {def?.description && (
                      <div className="truncate text-[11px] text-slate-500">{def.description}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(id)}
                    className="shrink-0 rounded p-1 text-rose-500 hover:bg-rose-100 hover:text-rose-700"
                    title="Tekliften çıkar"
                    aria-label={`${def?.name ?? id} teklifini çıkar`}
                  >
                    <X size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <OfferedSolutionsPickerModal
        open={pickerOpen}
        currentIds={currentIds}
        options={options}
        onClose={() => setPickerOpen(false)}
        onSave={(newIds) => {
          onChange(newIds);
          setPickerOpen(false);
        }}
      />
    </>
  );
}

function OfferedSolutionsPickerModal({
  open,
  currentIds,
  options,
  onClose,
  onSave,
}: {
  open: boolean;
  currentIds: string[];
  options: { id: string; name: string; description?: string }[];
  onClose: () => void;
  onSave: (newIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(currentIds);

  // Modal her açılışında mevcut seçimi başlangıç olarak yükle
  useEffect(() => {
    if (open) setSelected(currentIds);
  }, [open, currentIds]);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Müşteriye Teklif Sun"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {selected.length} teklif seçildi
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Vazgeç
            </Button>
            <Button onClick={() => onSave(selected)}>Uygula</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-2">
        <p className="text-xs text-slate-500">
          Müşteriyi tutabilmek için sunulacak retention teklif(ler)ini seçin. Çoklu seçim
          mümkündür; mevcut listeye eklenir/çıkarılır.
        </p>
        {options.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-500">
            Tanımlı teklif yok. Admin → Teklif Tanımları'ndan ekleyin.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {options.map((o) => {
              const checked = selected.includes(o.id);
              return (
                <li key={o.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition ${
                      checked
                        ? 'border-rose-300 bg-rose-50/60'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(o.id)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800">{o.name}</div>
                      {o.description && (
                        <div className="text-[11px] text-slate-500">{o.description}</div>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
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
        aria-label={disabled ? undefined : `${fieldKey} alanını düzenle`}
        className={`group relative w-full rounded-md border text-left transition ${
          disabled
            ? 'cursor-default border-transparent'
            : 'cursor-pointer border-transparent hover:border-slate-200 hover:bg-slate-50'
        } ${isDraft ? 'border-amber-300 bg-amber-50' : ''}`}
      >
        <span className="block px-2 py-1 pr-7">
          {renderDisplay ? renderDisplay(value) : (value ? String(value) : <span className="text-slate-400">—</span>)}
        </span>
        {!disabled && !isDraft && (
          <Pencil
            size={12}
            aria-hidden
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
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

  // Aktif edit durumunda kullanılan ✓ ve ✗ butonları
  const editControls = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-role="commit-draft"
        onMouseDown={(e) => {
          e.preventDefault();
          onCommit(draft);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-200"
        title="Onayla (Enter)"
        aria-label="Onayla"
      >
        <Check size={14} />
      </button>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onCancel();
        }}
        className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-50 text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100"
        title="İptal (ESC)"
        aria-label="İptal"
      >
        <X size={14} />
      </button>
    </div>
  );

  if (type === 'textarea') {
    return (
      <div className="rounded-md ring-2 ring-blue-500">
        <TextArea
          autoFocus
          value={String(draft ?? '')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            // Click outside iptal — eğer relatedTarget Kaydet/Voice butonuna gitmiyorsa
            const next = e.relatedTarget as HTMLElement | null;
            if (next?.dataset?.role === 'commit-draft' || next?.dataset?.role === 'voice-input') {
              onCommit(draft);
            } else {
              onCancel();
            }
          }}
          onKeyDown={handleKey}
          placeholder={placeholder}
          rows={4}
        />
        <div className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] text-slate-500">
          <VoiceNoteButton
            onTranscript={(chunk) =>
              setDraft((prev: unknown) => {
                const cur = String(prev ?? '');
                return cur ? `${cur} ${chunk}` : chunk;
              })
            }
          />
          <div className="flex items-center gap-2">
            <span>ESC iptal</span>
            {editControls}
          </div>
        </div>
      </div>
    );
  }

  if (type === 'select') {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex-1 rounded-md ring-2 ring-blue-500">
          <Select
            autoFocus
            value={String(draft ?? '')}
            onChange={(e) => {
              setDraft(e.target.value);
              onCommit(e.target.value);
            }}
            onBlur={(e) => {
              const next = e.relatedTarget as HTMLElement | null;
              if (next?.dataset?.role === 'commit-draft') return; // commit zaten onChange'de
              onCancel();
            }}
            onKeyDown={handleKey}
          >
            {options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        {editControls}
      </div>
    );
  }

  if (type === 'checkbox') {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1 ring-2 ring-blue-500">
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
        <span className="flex-1 text-sm text-slate-700">{Boolean(draft) ? 'Var' : 'Yok'}</span>
        {editControls}
      </div>
    );
  }

  // text / date
  return (
    <div className="flex items-center gap-1.5">
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
        className="flex-1 rounded-md border border-blue-500 bg-white px-3 py-1.5 text-sm text-slate-800 ring-2 ring-blue-500/40 focus:outline-none"
      />
      {editControls}
    </div>
  );
}

function ActivityTab({ item }: { item: Case }) {
  return (
    <ol className="relative space-y-3 border-l-2 border-slate-200 pl-4">
      {item.history.map((h) => {
        const fieldLabel = h.fieldName ? CASE_FIELD_LABELS[h.fieldName] ?? h.fieldName : null;
        const hasFrom = h.fromValue != null && h.fromValue !== '' && h.fromValue !== '—';
        const hasTo = h.toValue != null && h.toValue !== '';
        return (
          <li key={h.id} className="relative">
            <span className="absolute -left-[22px] top-1.5 inline-block h-3 w-3 rounded-full bg-brand-500 ring-4 ring-white" />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="font-medium text-slate-800">{h.action}</span>
              {fieldLabel && (
                <span className="text-xs font-medium text-slate-500">{fieldLabel}{hasTo ? ':' : ''}</span>
              )}
              {hasFrom && hasTo && (
                <span className="inline-flex items-baseline gap-1.5 text-xs">
                  <span className="text-slate-500 line-through decoration-slate-300">{h.fromValue}</span>
                  <span className="text-slate-400">→</span>
                  <span className="font-medium text-slate-800">{h.toValue}</span>
                </span>
              )}
              {!hasFrom && hasTo && (
                <span className="text-xs font-medium text-slate-800">{h.toValue}</span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
              <Calendar size={11} />
              <span>{formatDateTime(h.at)}</span>
              <span>·</span>
              <span>{h.actor}</span>
            </div>
          </li>
        );
      })}
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
        <Field
          label="Yeni Not"
          actions={
            <VoiceNoteButton
              onTranscript={(chunk) => onChangeText(noteText ? `${noteText} ${chunk}` : chunk)}
              onListeningChange={setVoiceListening}
            />
          }
        >
          <TextArea
            ref={inputRef}
            value={noteText}
            onChange={(e) => onChangeText(e.target.value)}
            placeholder={voiceListening ? 'Dinleniyor…' : 'Not yazın veya mikrofona basın…'}
            rows={3}
          />
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

function CallLogsTab({
  item,
  onItemUpdated,
}: {
  item: Case;
  onItemUpdated: (c: Case) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Çağrı kayıtları — toplam <strong>{item.callLogs.length}</strong>.
        </p>
        <Button size="sm" variant="outline" leftIcon={<Mic size={12} />} onClick={() => setOpen(true)}>
          Çağrı Kaydı Ekle
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

      <NewCallLogModal
        open={open}
        item={item}
        onClose={() => setOpen(false)}
        onCreated={onItemUpdated}
      />
    </div>
  );
}

function NewCallLogModal({
  open,
  item,
  onClose,
  onCreated,
}: {
  open: boolean;
  item: Case;
  onClose: () => void;
  onCreated: (c: Case) => void;
}) {
  const [callerName, setCallerName] = useState('');
  const [durationMin, setDurationMin] = useState(5);
  const [disposition, setDisposition] = useState<CallDisposition>('Cevapladı');
  const [outcome, setOutcome] = useState<CallOutcome>('Memnun');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setCallerName('');
      setDurationMin(5);
      setDisposition('Cevapladı');
      setOutcome('Memnun');
      setDescription('');
    }
  }, [open]);

  async function handleSave() {
    if (!callerName.trim()) {
      toast({ type: 'warn', message: 'Arayan / muhatap adı zorunlu.' });
      return;
    }
    setSubmitting(true);
    const r = await caseService.addCallLog(item.id, {
      callerName: callerName.trim(),
      durationMin,
      callDisposition: disposition,
      callOutcome: outcome,
      description: description.trim() || undefined,
    });
    if (!r) {
      setSubmitting(false);
      toast({ type: 'error', message: 'Çağrı kaydı eklenemedi.' });
      return;
    }
    onCreated(r.caseUpdated);
    onClose();
    setSubmitting(false);
    toast({ type: 'success', message: 'Çağrı kaydedildi. AI özet hazırlanıyor…', duration: 1800 });

    // Auto-summarize: arka planda; sonuç gelince case'in aiCallBrief alanı güncellenir.
    void (async () => {
      const aiR = await aiService.callSummary({
        callLog: {
          note: r.callLog.description,
          outcome: r.callLog.callOutcome,
          disposition: r.callLog.callDisposition,
        },
        caseSubject: item.title,
        customerName: item.accountName,
      });
      if (aiR.ok && aiR.data.summary) {
        const updated = await caseService.update(item.id, { aiCallBrief: aiR.data.summary });
        if (updated) {
          onCreated(updated);
          toast({ type: 'success', message: 'Çağrı özeti AI tarafından hazırlandı.', duration: 2000 });
        }
      } else if (!aiR.ok) {
        // Sessiz fail — UI'da call log zaten var
        if (aiR.error.kind !== 'unconfigured') {
          toast({ type: 'warn', message: aiErrorMessage(aiR.error), duration: 2200 });
        }
      }
    })();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Çağrı Kaydı Ekle"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button onClick={handleSave} disabled={submitting || !callerName.trim()}>
            {submitting ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Muhatap" required>
          <TextInput
            autoFocus
            placeholder="ör. Ayşe Yılmaz"
            value={callerName}
            onChange={(e) => setCallerName(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Süre (dk)" required>
            <TextInput
              type="number"
              min={1}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Çağrı Sonucu" required>
            <Select
              value={disposition}
              onChange={(e) => setDisposition(e.target.value as CallDisposition)}
            >
              {CALL_DISPOSITIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Müşteri Tepkisi" required>
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)}>
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Açıklama"
          hint="AI bu metni özetleyerek aiCallBrief alanına yazacak."
          actions={
            <VoiceNoteButton
              onTranscript={(chunk) =>
                setDescription((t) => (t ? `${t} ${chunk}` : chunk))
              }
            />
          }
        >
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Çağrıda ne konuşuldu, hangi karar verildi…"
          />
        </Field>
      </div>
    </Modal>
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
