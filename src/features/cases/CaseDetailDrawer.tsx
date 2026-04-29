import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Calendar,
  ChevronRight,
  Clock,
  FileText,
  History,
  Layers,
  MessageSquare,
  Paperclip,
  Send,
  ShieldAlert,
  User,
} from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextArea } from '@/components/ui/Field';
import { CaseTypeBadge, PriorityBadge, StatusPill } from '@/components/ui/StatusPill';
import { caseService } from '@/services/caseService';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import {
  STATUS_TRANSITIONS,
  type Case,
  type CaseStatus,
  type NoteVisibility,
} from './types';

interface CaseDetailDrawerProps {
  caseId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

type Tab = 'overview' | 'notes' | 'files' | 'history';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Genel',     icon: <FileText size={14} /> },
  { key: 'notes',    label: 'Notlar',    icon: <MessageSquare size={14} /> },
  { key: 'files',    label: 'Dosyalar',  icon: <Paperclip size={14} /> },
  { key: 'history',  label: 'Geçmiş',    icon: <History size={14} /> },
];

export function CaseDetailDrawer({ caseId, onClose, onChanged }: CaseDetailDrawerProps) {
  const [item, setItem] = useState<Case | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  // Status transition workflow state
  const [pendingStatus, setPendingStatus] = useState<CaseStatus | ''>('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [thirdParty, setThirdParty] = useState('');
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // New note state
  const [noteText, setNoteText] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<NoteVisibility>('Internal');

  const open = Boolean(caseId);

  const load = async () => {
    if (!caseId) return;
    setLoading(true);
    const fetched = await caseService.get(caseId);
    setItem(fetched ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (open) {
      void load();
      setTab('overview');
      setPendingStatus('');
      setResolutionNote('');
      setCancelReason('');
      setThirdParty('');
      setTransitionError(null);
      setNoteText('');
      setNoteVisibility('Internal');
    } else {
      setItem(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

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

  async function handleApplyTransition() {
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
    if (pendingStatus === '3rdPartyBekleniyor' && !thirdParty.trim()) {
      setTransitionError('3. parti bekleniyorsa hangi tarafın beklendiği yazılmalıdır.');
      return;
    }
    const updated = await caseService.transitionStatus(item.id, pendingStatus, {
      resolutionNote: pendingStatus === 'Çözüldü' ? resolutionNote.trim() : undefined,
      cancellationReason: pendingStatus === 'İptalEdildi' ? cancelReason.trim() : undefined,
      thirdPartyWaitingFor: pendingStatus === '3rdPartyBekleniyor' ? thirdParty.trim() : undefined,
    });
    if (updated) {
      setItem(updated);
      setPendingStatus('');
      setResolutionNote('');
      setCancelReason('');
      setThirdParty('');
      onChanged();
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
      onChanged();
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title={item?.title ?? (loading ? 'Yükleniyor…' : 'Vaka')}
      subtitle={item ? `${item.caseNumber} · ${item.accountName}` : undefined}
    >
      {loading && !item && <div className="p-6 text-sm text-slate-500">Yükleniyor…</div>}
      {!loading && !item && <div className="p-6 text-sm text-slate-500">Vaka bulunamadı.</div>}
      {item && (
        <div className="flex h-full flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-6 py-3">
            <StatusPill status={item.status} />
            <CaseTypeBadge type={item.caseType} />
            <PriorityBadge priority={item.priority} />
            {item.slaViolation && (
              <Badge tint="rose" icon={<ShieldAlert size={12} />}>
                SLA İhlali
              </Badge>
            )}
            {item.slaPaused && <Badge tint="amber">SLA Duraklatıldı</Badge>}
            <span className="ml-auto text-xs text-slate-500">
              <Clock size={12} className="mr-1 inline" />
              Açılış {formatRelative(item.createdAt)}
            </span>
          </div>

          <nav className="flex border-b border-slate-200 px-3">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  tab === t.key
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-600 hover:text-slate-800'
                }`}
              >
                {t.icon}
                {t.label}
                {t.key === 'notes' && item.notes.length > 0 && (
                  <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">
                    {item.notes.length}
                  </span>
                )}
                {t.key === 'files' && item.files.length > 0 && (
                  <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">
                    {item.files.length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {tab === 'overview' && (
              <div className="space-y-5">
                <Section title="Açıklama">
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{item.description}</p>
                </Section>

                <Section title="Müşteri & Sınıflandırma">
                  <DetailGrid
                    rows={[
                      ['Müşteri', <InlineWith icon={<Building2 size={14} />} text={item.accountName} />],
                      ['Kategori', `${item.category} / ${item.subCategory}`],
                      ['Talep Türü', item.requestType],
                      ['Ürün Grubu', item.productGroup ?? '—'],
                      ['Origin', item.origin + (item.originDescription ? ` — ${item.originDescription}` : '')],
                    ]}
                  />
                </Section>

                <Section title="Atama">
                  <DetailGrid
                    rows={[
                      ['Takım', item.assignedTeamName ?? '—'],
                      ['Kişi', <InlineWith icon={<User size={14} />} text={item.assignedPersonName ?? '—'} />],
                      ['Eskalasyon', item.escalationLevel],
                      ['3. Parti Bekleniyor', item.thirdPartyWaitingFor ?? '—'],
                    ]}
                  />
                </Section>

                <Section title="SLA & Tarihler">
                  <DetailGrid
                    rows={[
                      ['Yanıt SLA', item.slaResponseDueAt ? formatDateTime(item.slaResponseDueAt) : '—'],
                      ['Çözüm SLA', item.slaResolutionDueAt ? formatDateTime(item.slaResolutionDueAt) : '—'],
                      ['Açılış', formatDateTime(item.createdAt)],
                      ['Son Güncelleme', formatDateTime(item.updatedAt)],
                      ['Çözüm', item.resolvedAt ? formatDateTime(item.resolvedAt) : '—'],
                    ]}
                  />
                </Section>

                {item.resolutionNote && (
                  <Section title="Çözüm Notu">
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

                <Section title="Statü Geçişi">
                  {allowedTransitions.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      Bu vaka <strong>{item.status}</strong> statüsünde — terminal durum, geçiş yapılamaz.
                    </p>
                  ) : (
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-600">Hedef Statü:</span>
                        <Select
                          className="h-8 max-w-xs py-1"
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
                          />
                        </Field>
                      )}
                      {pendingStatus === 'İptalEdildi' && (
                        <Field label="İptal Gerekçesi" required>
                          <TextArea
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            placeholder="İptal sebebini yazın…"
                          />
                        </Field>
                      )}
                      {pendingStatus === '3rdPartyBekleniyor' && (
                        <Field
                          label="Beklenen 3. Parti"
                          required
                          hint="Bu süreçte SLA sayacı duraklatılır."
                        >
                          <TextArea
                            value={thirdParty}
                            onChange={(e) => setThirdParty(e.target.value)}
                            placeholder="ör. Hukuk departmanı, X tedarikçisi…"
                            rows={2}
                          />
                        </Field>
                      )}

                      {requiresSupervisor && (
                        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                          <span>
                            Çözüldü geçişi <strong>Supervisor onayı</strong> gerektiriyor (Critical / SLA ihlali /
                            yüksek eskalasyon). FAZ 0'da onay simülasyonludur.
                          </span>
                        </div>
                      )}

                      {transitionError && (
                        <p className="text-xs font-medium text-rose-600">{transitionError}</p>
                      )}

                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          disabled={!pendingStatus}
                          onClick={handleApplyTransition}
                          rightIcon={<ChevronRight size={14} />}
                        >
                          Statüyü Uygula
                        </Button>
                      </div>
                    </div>
                  )}
                </Section>
              </div>
            )}

            {tab === 'notes' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <Field label="Yeni Not">
                    <TextArea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Not yazın…"
                      rows={3}
                    />
                  </Field>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-600">Görünürlük:</span>
                      <button
                        onClick={() => setNoteVisibility('Internal')}
                        className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${
                          noteVisibility === 'Internal'
                            ? 'bg-slate-200 text-slate-800 ring-slate-300'
                            : 'bg-white text-slate-500 ring-slate-200'
                        }`}
                      >
                        İç Not
                      </button>
                      <button
                        onClick={() => setNoteVisibility('Customer')}
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
                      onClick={handleAddNote}
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
                            isInternal
                              ? 'bg-slate-50 ring-slate-200'
                              : 'bg-blue-50 ring-blue-200'
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
            )}

            {tab === 'files' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Maks. 25MB / dosya · 20 dosya / vaka. <em>FAZ 0'da yükleme devre dışı.</em>
                </p>
                {item.files.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">Henüz dosya yok.</p>
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
            )}

            {tab === 'history' && (
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
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Layers size={12} />
        {title}
      </h3>
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

function InlineWith({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-700">
      <span className="text-slate-400">{icon}</span>
      {text}
    </span>
  );
}
