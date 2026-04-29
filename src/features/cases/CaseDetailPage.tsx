import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArchiveX,
  ArrowLeft,
  Bot,
  Brain,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
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
import { CaseTypeBadge, PriorityBadge, StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { caseService, lookupService } from '@/services/caseService';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import {
  ESCALATION_LEVEL_LABELS,
  STATUS_TRANSITIONS,
  type Case,
  type CaseStatus,
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

  const [tab, setTab] = useState<TabKey>('detail');
  const [previousCases, setPreviousCases] = useState<Case[]>([]);
  const [callActive, setCallActive] = useState(false);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);

  // Status transition workflow
  const [pendingStatus, setPendingStatus] = useState<CaseStatus | ''>('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [thirdPartyId, setThirdPartyId] = useState('');
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // New note state
  const [noteText, setNoteText] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<NoteVisibility>('Internal');
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const thirdParties = useMemo(() => lookupService.thirdParties(), []);
  const offeredSolutions = useMemo(() => lookupService.offeredSolutions(), []);
  const accounts = useMemo(() => lookupService.accounts(), []);
  const { toast } = useToast();

  // Parent caseId değişirse içerideki state senkronlanır
  useEffect(() => {
    setActiveId(caseId);
  }, [caseId]);

  useEffect(() => {
    let alive = true;
    if (!activeId) return;
    setLoading(true);
    void caseService.get(activeId).then((c) => {
      if (alive) {
        setItem(c ?? null);
        setLoading(false);
        setPendingStatus('');
        setResolutionNote('');
        setCancelReason('');
        setThirdPartyId('');
        setTransitionError(null);
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

  const allowedTransitions = useMemo(
    () => (item ? STATUS_TRANSITIONS[item.status] : []),
    [item],
  );

  const requiresSupervisor = useMemo(() => {
    if (!item || pendingStatus !== 'Çözüldü') return false;
    return (
      item.priority === 'Critical' ||
      item.slaViolation ||
      item.escalationLevel === 'Direktör' ||
      item.escalationLevel === 'ÜstYönetim'
    );
  }, [item, pendingStatus]);

  async function handleApplyTransition(closePopover: () => void) {
    if (!item || !pendingStatus) return;
    setTransitionError(null);
    if (pendingStatus === 'Çözüldü' && !resolutionNote.trim()) {
      setTransitionError('Çözüldü statüsüne geçiş için Çözüm Notu zorunludur.');
      return;
    }
    if (pendingStatus === 'İptalEdildi' && !cancelReason.trim()) {
      setTransitionError('İptal için iptal gerekçesi zorunludur.');
      return;
    }
    if (pendingStatus === '3rdPartyBekleniyor' && !thirdPartyId) {
      setTransitionError('3. parti bekleniyorsa hangi tarafın beklendiği seçilmelidir.');
      return;
    }
    const tp = thirdParties.find((t) => t.id === thirdPartyId);
    const updated = await caseService.transitionStatus(item.id, pendingStatus, {
      resolutionNote: pendingStatus === 'Çözüldü' ? resolutionNote.trim() : undefined,
      cancellationReason: pendingStatus === 'İptalEdildi' ? cancelReason.trim() : undefined,
      thirdPartyId: pendingStatus === '3rdPartyBekleniyor' ? tp?.id : undefined,
      thirdPartyName: pendingStatus === '3rdPartyBekleniyor' ? tp?.name : undefined,
    });
    if (updated) {
      setItem(updated);
      setPendingStatus('');
      setResolutionNote('');
      setCancelReason('');
      setThirdPartyId('');
      closePopover();
      toast({
        type: pendingStatus === 'Çözüldü' ? 'success' : pendingStatus === 'İptalEdildi' ? 'warn' : 'info',
        title: 'Statü güncellendi',
        message: `${updated.caseNumber} → ${pendingStatus}`,
      });
    }
  }

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
            <nav className="flex items-center gap-1 text-xs text-slate-500">
              <button type="button" onClick={onBack} className="hover:text-brand-700 hover:underline">
                Vakalar
              </button>
              <ChevronRight size={11} className="text-slate-400" />
              <span className="font-mono text-slate-600">{item.caseNumber}</span>
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

              <Popover
                align="start"
                width={360}
                trigger={({ toggle }) => (
                  <button
                    type="button"
                    onClick={toggle}
                    className="inline-flex items-center gap-1 rounded transition-opacity hover:opacity-80"
                    title="Durumu değiştir"
                  >
                    <StatusPill status={item.status} />
                    <ChevronDown size={11} className="text-slate-400" />
                  </button>
                )}
              >
                {({ close }) => (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Statü Geçişi
                    </div>
                    {allowedTransitions.length === 0 ? (
                      <p className="text-sm text-slate-600">
                        <strong>{item.status}</strong> terminal durumdur — geçiş yapılamaz.
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-slate-600">Hedef:</span>
                          <Select
                            className="h-8 py-1"
                            value={pendingStatus}
                            onChange={(e) => setPendingStatus(e.target.value as CaseStatus | '')}
                          >
                            <option value="">Seçin…</option>
                            {allowedTransitions.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </Select>
                        </div>
                        {pendingStatus === 'Çözüldü' && (
                          <Field label="Çözüm Notu" required>
                            <TextArea
                              value={resolutionNote}
                              onChange={(e) => setResolutionNote(e.target.value)}
                              placeholder="Sorunun nasıl çözüldüğünü açıklayın…"
                              rows={3}
                            />
                          </Field>
                        )}
                        {pendingStatus === 'İptalEdildi' && (
                          <Field label="İptal Gerekçesi" required>
                            <TextArea
                              value={cancelReason}
                              onChange={(e) => setCancelReason(e.target.value)}
                              placeholder="İptal sebebini yazın…"
                              rows={2}
                            />
                          </Field>
                        )}
                        {pendingStatus === '3rdPartyBekleniyor' && (
                          <Field label="Beklenen 3. Parti" required hint="Bu süreçte SLA sayacı duraklatılır.">
                            <Select value={thirdPartyId} onChange={(e) => setThirdPartyId(e.target.value)}>
                              <option value="">Seçin…</option>
                              {thirdParties.map((tp) => (
                                <option key={tp.id} value={tp.id}>
                                  {tp.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        )}
                        {requiresSupervisor && (
                          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                            <span>
                              Çözüldü geçişi <strong>Supervisor onayı</strong> gerektiriyor (Critical / SLA
                              ihlali / yüksek eskalasyon). FAZ 0'da onay simülasyonludur.
                            </span>
                          </div>
                        )}
                        {transitionError && (
                          <p className="text-xs font-medium text-rose-600">{transitionError}</p>
                        )}
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={close}>
                            Vazgeç
                          </Button>
                          <Button
                            size="sm"
                            disabled={!pendingStatus}
                            onClick={() => void handleApplyTransition(close)}
                            rightIcon={<ChevronRight size={14} />}
                          >
                            Uygula
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </Popover>

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
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Save size={12} />}
              disabled
              title="Düzenleme FAZ 4'te aktif olur"
            >
              Kaydet
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
          previousCases={previousCases}
          onSelectPrevious={(id) => setActiveId(id)}
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
            {tab === 'detail' && <DetailTab item={item} offeredSolutions={offeredSolutions} />}
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
        <RightPanel item={item} offeredSolutions={offeredSolutions} />
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
  previousCases,
  onSelectPrevious,
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
  previousCases: Case[];
  onSelectPrevious: (id: string) => void;
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

      <PanelSection
        title={`Önceki Vakalar (${previousCases.length})`}
        icon={<ArchiveX size={12} />}
        hidden={previousCases.length === 0}
      >
        <ul className="space-y-1.5">
          {previousCases.slice(0, 3).map((p) => {
            const refDate = p.resolvedAt ?? p.updatedAt;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelectPrevious(p.id)}
                  className="flex w-full flex-col items-start gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <div className="flex w-full items-center gap-1">
                    <span className="font-mono text-[10px] text-slate-500">{p.caseNumber}</span>
                    <span className="ml-auto text-[10px] text-slate-500">{formatRelative(refDate)}</span>
                  </div>
                  <div className="line-clamp-2 text-xs font-medium text-slate-800">{p.title}</div>
                  <StatusPill status={p.status} />
                </button>
              </li>
            );
          })}
          {previousCases.length > 3 && (
            <li className="text-[11px] text-slate-500">+{previousCases.length - 3} vaka daha…</li>
          )}
        </ul>
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

      <PanelSection title="KPI Özeti" icon={<Target size={12} />}>
        <KpiCompact item={item} />
      </PanelSection>
    </div>
  );

  return (
    <>
      <aside className="hidden w-[280px] shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50/40 p-4 lg:block">
        {content}
      </aside>
      {drawerOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={onCloseDrawer} />
          <aside className="absolute left-0 top-0 h-full w-[280px] overflow-y-auto bg-white p-4 shadow-xl">
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
    <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50/40 p-4 xl:block">
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
          {item.aiGeneratedFlag ? (
            <div className="space-y-2 text-xs">
              {item.aiSummary && (
                <div className="rounded-md bg-indigo-50 px-2 py-1.5 text-indigo-900 ring-1 ring-indigo-200">
                  {item.aiSummary}
                </div>
              )}
              {item.aiCategoryPrediction && (
                <Row label="Kategori önerisi" value={item.aiCategoryPrediction} />
              )}
              {item.aiPriorityPrediction && (
                <Row label="Öncelik önerisi" value={item.aiPriorityPrediction} />
              )}
              {item.aiDuplicateScore != null && (
                <Row label="Duplicate skoru" value={item.aiDuplicateScore.toFixed(2)} />
              )}
              {item.aiCallBrief && (
                <div className="rounded-md bg-slate-50 px-2 py-1.5 text-slate-700 ring-1 ring-slate-200">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Çağrı Özeti
                  </div>
                  {item.aiCallBrief}
                </div>
              )}
              {item.aiFollowupRecommendation && (
                <div className="rounded-md bg-slate-50 px-2 py-1.5 text-slate-700 ring-1 ring-slate-200">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Takip Önerisi
                  </div>
                  {item.aiFollowupRecommendation}
                </div>
              )}
              {item.aiRetentionOfferSuggestion && (
                <div className="rounded-md bg-rose-50 px-2 py-1.5 text-rose-900 ring-1 ring-rose-200">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                    Retention Teklif Önerisi
                  </div>
                  {item.aiRetentionOfferSuggestion}
                </div>
              )}
              <Button size="sm" variant="outline" leftIcon={<Bot size={12} />} disabled className="w-full">
                Taslak Üret (FAZ 1+)
              </Button>
              {item.aiRejectReason && (
                <div className="rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-600 ring-1 ring-slate-200">
                  <strong>Önceki red:</strong> {item.aiRejectReason}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">
              Bu vaka için AI önerisi henüz üretilmedi.
            </p>
          )}
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

function SlaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-slate-800">{value}</div>
    </div>
  );
}

function KpiCompact({ item }: { item: Case }) {
  const minutes = (a: string, b: string) =>
    Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  const fmt = (m: number) => {
    if (m < 60) return `${m}dk`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}sa`;
    return `${Math.round(h / 24)}g`;
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
    <div className="grid grid-cols-2 gap-1.5">
      <KpiMini icon={<TrendingUp size={10} />} label="Müdahale" value={responseMin != null ? fmt(responseMin) : '—'} />
      <KpiMini icon={<CheckCircle2 size={10} />} label="Çözüm" value={resolutionMin != null ? fmt(resolutionMin) : '—'} />
      <KpiMini
        icon={<Target size={10} />}
        label="FCR"
        value={fcr ? 'Evet' : resolutionMin != null ? 'Hayır' : '—'}
        tone={fcr ? 'good' : 'neutral'}
      />
      <KpiMini
        icon={<HistoryIcon size={10} />}
        label="Y.Açılma"
        value={reopened ? 'Var' : 'Yok'}
        tone={reopened ? 'warn' : 'neutral'}
      />
    </div>
  );
}

function KpiMini({
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
    <div className={`rounded-md px-2 py-1 ring-1 ring-inset ${cls}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-600">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

// ----------------------------------------------------------------
// Tab Components
// ----------------------------------------------------------------

function DetailTab({ item, offeredSolutions }: { item: Case; offeredSolutions: { id: string; name: string }[] }) {
  return (
    <div className="space-y-5">
      <Section title="Açıklama">
        <p className="whitespace-pre-wrap text-sm text-slate-700">{item.description}</p>
      </Section>

      <Section title="Müşteri & Sınıflandırma">
        <DetailGrid
          rows={[
            ['Şirket', item.companyName],
            ['Müşteri', item.accountName],
            ['Kategori', `${item.category} / ${item.subCategory}`],
            ['Talep Türü', item.requestType],
            ['Ürün Grubu', item.productGroup ?? '—'],
            ['Origin', item.origin + (item.originDescription ? ` — ${item.originDescription}` : '')],
            ['3. Parti Bekleniyor', item.thirdPartyName ?? '—'],
          ]}
        />
      </Section>

      {item.caseType === 'ProactiveTracking' && (
        <Section title="Proaktif Takip Bilgileri" tint="violet">
          <DetailGrid
            rows={[
              ['Finansal Risk', item.financialStatus ?? '—'],
              ['Ürün Kullanımı', item.productUsage ?? '—'],
              ['Kullanım Trendi', item.usageChangeAlert ?? '—'],
              ['Müdahale Önceliği', item.responseLevel ?? '—'],
            ]}
          />
        </Section>
      )}

      {item.caseType === 'Churn' && (
        <Section title="Churn Yönetimi" tint="rose">
          <DetailGrid
            rows={[
              ['İptal Talebi', item.cancellationRequest ? 'Var' : 'Yok'],
              ['Teklif Sonucu', item.offerOutcome ?? '—'],
              ['Teklif Geçerlilik', item.offerExpiryDate ? formatDateTime(item.offerExpiryDate) : '—'],
              ['Takip Tarihi', item.followUpDate ? formatDateTime(item.followUpDate) : '—'],
              ['Churn Sonucu', item.churnResult ?? '—'],
              ['Retention Durumu', item.retentionStatus ?? '—'],
            ]}
          />
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
          {item.actionTaken && (
            <div className="mt-3">
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Yapılan Aksiyon
              </h4>
              <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                {item.actionTaken}
              </p>
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
    </div>
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
