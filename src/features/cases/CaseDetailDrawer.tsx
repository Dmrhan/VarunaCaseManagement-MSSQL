import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Brain,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  History as HistoryIcon,
  MessageSquare,
  Paperclip,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  User,
  Wallet,
} from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { Popover } from '@/components/ui/Popover';
import { Field, Select, TextArea } from '@/components/ui/Field';
import { CaseTypeBadge, PriorityBadge, StatusPill } from '@/components/ui/StatusPill';
import { caseService, lookupService } from '@/services/caseService';
import { useToast } from '@/components/ui/Toast';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import {
  ESCALATION_LEVEL_LABELS,
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

export function CaseDetailDrawer({ caseId, onClose, onChanged }: CaseDetailDrawerProps) {
  const [item, setItem] = useState<Case | null>(null);
  const [loading, setLoading] = useState(false);

  // Status transition workflow state (tetiklendiğinde popover içinden kullanılır)
  const [pendingStatus, setPendingStatus] = useState<CaseStatus | ''>('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [thirdPartyId, setThirdPartyId] = useState('');
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // New note state
  const [noteText, setNoteText] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<NoteVisibility>('Internal');

  const thirdParties = useMemo(() => lookupService.thirdParties(), []);
  const offeredSolutions = useMemo(() => lookupService.offeredSolutions(), []);
  const { toast } = useToast();

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
      setPendingStatus('');
      setResolutionNote('');
      setCancelReason('');
      setThirdPartyId('');
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
      onChanged();
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
      onChanged();
      toast({
        type: 'success',
        message: noteVisibility === 'Internal' ? 'İç not eklendi.' : 'Müşteriye görünür not eklendi.',
        duration: 2500,
      });
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title={item?.title ?? (loading ? 'Yükleniyor…' : 'Vaka')}
      subtitle={item ? `${item.caseNumber} · ${item.companyName} · ${item.accountName}` : undefined}
    >
      {loading && !item && <div className="p-6 text-sm text-slate-500">Yükleniyor…</div>}
      {!loading && !item && <div className="p-6 text-sm text-slate-500">Vaka bulunamadı.</div>}
      {item && (
        <div className="flex h-full flex-col">
          {/* Üst şerit: status (popover) + tipler + sla badges */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-6 py-3">
            <Popover
              align="start"
              width={360}
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="rounded transition-opacity hover:opacity-80"
                  title="Durumu değiştir"
                >
                  <StatusPill status={item.status} />
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
                        <Field
                          label="Beklenen 3. Parti"
                          required
                          hint="Bu süreçte SLA sayacı duraklatılır."
                        >
                          <Select
                            value={thirdPartyId}
                            onChange={(e) => setThirdPartyId(e.target.value)}
                          >
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
                            Çözüldü geçişi <strong>Supervisor onayı</strong> gerektiriyor (Critical / SLA ihlali /
                            yüksek eskalasyon). FAZ 0'da onay simülasyonludur.
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

            <CaseTypeBadge type={item.caseType} />
            <PriorityBadge priority={item.priority} />
            {item.slaViolation && (
              <Badge tint="rose" icon={<ShieldAlert size={12} />}>
                SLA İhlali
              </Badge>
            )}
            {item.slaPausedAt && <Badge tint="amber">SLA Duraklatıldı</Badge>}
            <span className="ml-auto text-xs text-slate-500">
              <Clock size={12} className="mr-1 inline" />
              Açılış {formatRelative(item.createdAt)}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <Accordion>
              <AccordionItem
                title="Genel Bilgi"
                icon={<FileText size={14} />}
                defaultOpen
              >
                <div className="space-y-4">
                  <div>
                    <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Açıklama
                    </h4>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{item.description}</p>
                  </div>

                  <DetailGrid
                    rows={[
                      ['Şirket', item.companyName],
                      ['Müşteri', <InlineWith icon={<Building2 size={14} />} text={item.accountName} />],
                      ['Kategori', `${item.category} / ${item.subCategory}`],
                      ['Talep Türü', item.requestType],
                      ['Ürün Grubu', item.productGroup ?? '—'],
                      ['Origin', item.origin + (item.originDescription ? ` — ${item.originDescription}` : '')],
                      ['Takım', item.assignedTeamName ?? '—'],
                      ['Kişi', <InlineWith icon={<User size={14} />} text={item.assignedPersonName ?? 'Atanmadı'} />],
                      ['Eskalasyon', ESCALATION_LEVEL_LABELS[item.escalationLevel]],
                      ['3. Parti Bekleniyor', item.thirdPartyName ?? '—'],
                    ]}
                  />

                  {item.resolutionNote && (
                    <div>
                      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Çözüm Notu
                      </h4>
                      <p className="whitespace-pre-wrap rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
                        {item.resolutionNote}
                      </p>
                    </div>
                  )}

                  {item.cancellationReason && (
                    <div>
                      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        İptal Gerekçesi
                      </h4>
                      <p className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                        {item.cancellationReason}
                      </p>
                    </div>
                  )}
                </div>
              </AccordionItem>

              {item.caseType === 'ProactiveTracking' && (
                <AccordionItem
                  title="Proaktif Takip Bilgileri"
                  icon={<TrendingUp size={14} />}
                  tint="violet"
                >
                  <DetailGrid
                    rows={[
                      ['Finansal Risk', item.financialStatus ?? '—'],
                      ['Ürün Kullanımı', item.productUsage ?? '—'],
                      ['Kullanım Trendi', item.usageChangeAlert ?? '—'],
                      ['Müdahale Önceliği', item.responseLevel ?? '—'],
                    ]}
                  />
                  <div className="mt-4">
                    <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <Calendar size={12} />
                      Çağrı Kayıtları ({item.callLogs.length})
                    </h4>
                    {item.callLogs.length === 0 ? (
                      <p className="text-xs text-slate-400">Henüz çağrı kaydı yok.</p>
                    ) : (
                      <ul className="space-y-2">
                        {item.callLogs.map((cl) => (
                          <li
                            key={cl.id}
                            className="rounded-md bg-violet-50/60 px-3 py-2 text-sm ring-1 ring-violet-200"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-slate-800">{cl.callerName}</span>
                              <span className="text-[11px] text-slate-500">
                                {formatDateTime(cl.callDate)} · {cl.durationMin} dk
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <Badge tint="violet">{cl.callDisposition}</Badge>
                              <Badge tint="slate">{cl.callOutcome}</Badge>
                              {cl.nextFollowupDate && (
                                <span className="text-[11px] text-slate-600">
                                  Sonraki: {formatDateTime(cl.nextFollowupDate)}
                                </span>
                              )}
                            </div>
                            {cl.description && (
                              <p className="mt-1 text-xs text-slate-700">{cl.description}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </AccordionItem>
              )}

              {item.caseType === 'Churn' && (
                <AccordionItem
                  title="Churn Yönetimi"
                  icon={<Wallet size={14} />}
                  tint="rose"
                >
                  <DetailGrid
                    rows={[
                      ['İptal Talebi', item.cancellationRequest ? 'Var' : 'Yok'],
                      ['Teklif Sonucu', item.offerOutcome ?? '—'],
                      ['Teklif Geçerlilik', item.offerExpiryDate ? formatDateTime(item.offerExpiryDate) : '—'],
                      ['Takip Tarihi', item.followUpDate ? formatDateTime(item.followUpDate) : '—'],
                      ['Churn Sonucu', item.churnResult ?? '—'],
                      ['Retention', item.retentionStatus ?? '—'],
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
                              {def?.description && (
                                <span className="ml-1 text-xs text-slate-600">— {def.description}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {item.offerRejectionReason && (
                    <div className="mt-3">
                      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Red Gerekçesi
                      </h4>
                      <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-200">
                        {item.offerRejectionReason}
                      </p>
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
                </AccordionItem>
              )}

              <AccordionItem
                title="SLA & Tarihler"
                icon={<Clock size={14} />}
              >
                <DetailGrid
                  rows={[
                    ['Yanıt SLA', item.slaResponseDueAt ? formatDateTime(item.slaResponseDueAt) : '—'],
                    ['Çözüm SLA', item.slaResolutionDueAt ? formatDateTime(item.slaResolutionDueAt) : '—'],
                    ['SLA Duraklatıldı', item.slaPausedAt ? formatDateTime(item.slaPausedAt) : 'Hayır'],
                    ['Toplam Pause Süresi', `${item.slaPausedDurationMin} dk`],
                    ['Açılış', formatDateTime(item.createdAt)],
                    ['Son Güncelleme', formatDateTime(item.updatedAt)],
                    ['Çözüm', item.resolvedAt ? formatDateTime(item.resolvedAt) : '—'],
                  ]}
                />
                {item.slaViolation && (
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                    <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
                    <span>
                      Bu vaka SLA ihlalindedir. Çözüm sürecindeki gecikme nedeniyle Supervisor onayı gerekebilir.
                    </span>
                  </div>
                )}
              </AccordionItem>

              <AccordionItem
                title="KPI İzleme"
                icon={<Target size={14} />}
                defaultOpen={false}
              >
                <KpiPanel item={item} />
              </AccordionItem>

              {item.aiGeneratedFlag && (
                <AccordionItem
                  title="AI Paneli"
                  icon={<Sparkles size={14} />}
                  badge={<Badge tint="indigo">{item.aiConfidenceScore != null ? `${Math.round(item.aiConfidenceScore * 100)}%` : 'AI'}</Badge>}
                  defaultOpen={false}
                >
                  <AiPanel item={item} />
                </AccordionItem>
              )}

              <AccordionItem
                title={`Notlar (${item.notes.length})`}
                icon={<MessageSquare size={14} />}
                defaultOpen={false}
              >
                <div className="space-y-3">
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
                    <p className="py-4 text-center text-sm text-slate-500">Henüz not yok.</p>
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
              </AccordionItem>

              <AccordionItem
                title={`Dosyalar (${item.files.length})`}
                icon={<Paperclip size={14} />}
                defaultOpen={false}
              >
                <p className="mb-2 text-xs text-slate-500">
                  Maks. 25MB / dosya · 20 dosya / vaka. <em>FAZ 0'da yükleme devre dışı.</em>
                </p>
                {item.files.length === 0 ? (
                  <p className="py-2 text-center text-sm text-slate-500">Henüz dosya yok.</p>
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
              </AccordionItem>

              <AccordionItem
                title={`Tarihçe (${item.history.length})`}
                icon={<HistoryIcon size={14} />}
                defaultOpen={false}
              >
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
              </AccordionItem>
            </Accordion>
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ----------------------------------------------------------------
// Helper sub-components
// ----------------------------------------------------------------

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

// Spec 11.3 — KPI İzleme: İlk Temas Çözüm / Yeniden Açılma / Müdahale Süresi / Çözüm Süresi
function KpiPanel({ item }: { item: Case }) {
  const minutes = (a: string, b: string) =>
    Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  const fmt = (m: number) => {
    if (m < 60) return `${m} dk`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} saat`;
    return `${Math.round(h / 24)} gün`;
  };

  // Müdahale süresi: oluşturuldu → ilk İncelemede geçişi
  const firstReview = item.history.find(
    (h) => h.action === 'Statü değişti' && h.toValue === 'İncelemede',
  );
  const responseMin = firstReview ? minutes(item.createdAt, firstReview.at) : null;

  // Çözüm süresi: oluşturuldu → resolvedAt
  const resolutionMin = item.resolvedAt ? minutes(item.createdAt, item.resolvedAt) : null;

  // İlk temas çözüm: müdahale + çözüm aynı 24 saat içinde mi?
  const firstContact = responseMin != null && resolutionMin != null && resolutionMin <= 24 * 60;

  // Yeniden açılma: history içinde Çözüldü → YenidenAcildi geçişi var mı?
  const reopened = item.history.some(
    (h) => h.action === 'Statü değişti' && h.fromValue === 'Çözüldü' && h.toValue === 'YenidenAcildi',
  );

  return (
    <div className="grid grid-cols-2 gap-3">
      <KpiTile
        label="Müdahale Süresi"
        value={responseMin != null ? fmt(responseMin) : '—'}
        hint="Açılış → İncelemede"
        icon={<TrendingUp size={14} />}
      />
      <KpiTile
        label="Çözüm Süresi"
        value={resolutionMin != null ? fmt(resolutionMin) : '—'}
        hint="Açılış → Çözüldü"
        icon={<CheckCircle2 size={14} />}
      />
      <KpiTile
        label="İlk Temas Çözüm"
        value={firstContact ? 'Evet' : resolutionMin != null ? 'Hayır' : '—'}
        hint="24 saat içinde çözüldü mü"
        icon={<Target size={14} />}
        tone={firstContact ? 'good' : resolutionMin != null ? 'warn' : 'neutral'}
      />
      <KpiTile
        label="Yeniden Açılma"
        value={reopened ? 'Var' : 'Yok'}
        hint="Çözüldü → Yeniden Açıldı"
        icon={<HistoryIcon size={14} />}
        tone={reopened ? 'warn' : 'neutral'}
      />
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: 'neutral' | 'good' | 'warn';
}) {
  const toneCls =
    tone === 'good' ? 'bg-emerald-50 ring-emerald-200' :
    tone === 'warn' ? 'bg-amber-50 ring-amber-200' :
                       'bg-slate-50 ring-slate-200';
  return (
    <div className={`rounded-md p-3 ring-1 ring-inset ${toneCls}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-600">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-base font-semibold text-slate-900">{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

// Spec 11.3 — AI Paneli (vaka özeti + öneriler)
function AiPanel({ item }: { item: Case }) {
  return (
    <div className="space-y-3">
      {item.aiSummary && (
        <div className="rounded-md bg-indigo-50 px-3 py-2 ring-1 ring-indigo-200">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-800">
            <Brain size={12} /> AI Özeti
          </div>
          <p className="text-sm text-indigo-900">{item.aiSummary}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {item.aiCategoryPrediction && (
          <SuggestionTile label="Kategori önerisi" value={item.aiCategoryPrediction} />
        )}
        {item.aiPriorityPrediction && (
          <SuggestionTile label="Öncelik önerisi" value={item.aiPriorityPrediction} />
        )}
        {item.aiDuplicateScore != null && (
          <SuggestionTile label="Duplicate skoru" value={item.aiDuplicateScore.toFixed(2)} />
        )}
        {item.aiConfidenceScore != null && (
          <SuggestionTile label="AI güven skoru" value={`${Math.round(item.aiConfidenceScore * 100)}%`} />
        )}
      </div>

      {item.aiCallBrief && (
        <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Çağrı Özeti
          </div>
          <p className="text-sm text-slate-700">{item.aiCallBrief}</p>
        </div>
      )}

      {item.aiFollowupRecommendation && (
        <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Takip Önerisi
          </div>
          <p className="text-sm text-slate-700">{item.aiFollowupRecommendation}</p>
        </div>
      )}

      {item.aiRetentionOfferSuggestion && (
        <div className="rounded-md bg-rose-50 px-3 py-2 ring-1 ring-rose-200">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-800">
            Retention Teklif Önerisi
          </div>
          <p className="text-sm text-rose-900">{item.aiRetentionOfferSuggestion}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
        <Button size="sm" variant="outline" leftIcon={<Bot size={14} />} disabled>
          Taslak Üret (FAZ 1+)
        </Button>
        {item.aiRejectReason && (
          <Badge tint="slate">Önceki red: {item.aiRejectReason}</Badge>
        )}
      </div>
    </div>
  );
}

function SuggestionTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white px-3 py-2 ring-1 ring-slate-200">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm font-medium text-slate-800">{value}</div>
    </div>
  );
}
