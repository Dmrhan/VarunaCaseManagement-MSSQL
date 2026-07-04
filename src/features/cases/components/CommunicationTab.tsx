/**
 * Case Detail "İletişim" sekmesi — PR-2 Aşama A yeniden tasarım.
 *
 * ESKİ: 8 kolonlu tablo (MailThread) + tam-ekran composer.
 * YENİ: dikey usta-detay (üst kompakt liste + alt MailThreadReader) +
 *   Genişlet aksiyon → aynı reader fullscreen overlay.
 *
 * Yerleşim grameri DEĞİŞMEDİ (3 kolon + sekmeler aynen); yalnız
 * İletişim sekmesinin İÇİ.
 *
 * TEK BİLEŞEN İKİ BOYUTTA (kod çatallaması yasak):
 *   readerMode='inline'     → dikey usta-detay altında
 *   readerMode='fullscreen' → MailThreadReader kendi overlay'ini açar
 *
 * Composer flow (kullanıcı direktifi):
 *   - Composer açık → composer görünür, reader/liste gizli
 *   - Gönderim sonrası → BULUNDUĞU görünüme dönüş (readerMode korunur)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, AtSign, Globe, Info, MessageSquare, Paperclip, Phone, Plus } from 'lucide-react';
import { MailComposer } from './MailComposer';
import { MailThreadReader, type MailThreadReaderMode } from './MailThreadReader';
import { Button } from '@/components/ui/Button';
import { caseEmailService, type CaseEmailItem, type EmailConfigReason, type ReplyContext, type ForwardContext } from '@/services/caseEmailService';
import { normalizeSubject } from '@/lib/subjectNormalizer';
import { formatDateTime } from '@/lib/format';
import type { Case } from '../types';

type Channel = 'email' | 'web' | 'sms' | 'incoming-call';

interface ChannelConfig {
  key: Channel;
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
}

const CHANNELS: ChannelConfig[] = [
  { key: 'email',         label: 'E-Posta',        icon: <AtSign size={14} />,           enabled: true },
  { key: 'web',           label: 'Web',            icon: <Globe size={14} />,            enabled: false },
  { key: 'sms',           label: 'SMS',            icon: <MessageSquare size={14} />,    enabled: false },
  { key: 'incoming-call', label: 'Gelen Aramalar', icon: <Phone size={14} />,            enabled: false },
];

// Split ratio localStorage kuralı — kullanıcı direktifi guard'ları:
const SPLIT_STORAGE_KEY = 'pr2.commTab.splitRatio';
const SPLIT_DEFAULT = 0.35;
const SPLIT_MIN = 0.20;
const SPLIT_MAX = 0.60;

function loadSplitRatio(): number {
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY);
    if (!raw) return SPLIT_DEFAULT;
    const v = Number.parseFloat(raw);
    if (!Number.isFinite(v) || v < SPLIT_MIN || v > SPLIT_MAX) return SPLIT_DEFAULT;
    return v;
  } catch {
    return SPLIT_DEFAULT;
  }
}

function saveSplitRatio(v: number): void {
  try { localStorage.setItem(SPLIT_STORAGE_KEY, String(v)); } catch { /* no-op */ }
}

interface Props {
  item: Case;
  onCaseShouldRefresh?: () => void;
}

export function CommunicationTab({ item, onCaseShouldRefresh }: Props) {
  const [channel, setChannel] = useState<Channel>('email');
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyCtx, setReplyCtx] = useState<ReplyContext | null>(null);
  const [forwardCtx, setForwardCtx] = useState<ForwardContext | null>(null);
  const [tenantSignatureHtml, setTenantSignatureHtml] = useState<string | null>(null);
  const [agentSignatureHtml, setAgentSignatureHtml] = useState<string | null>(null);
  const [composedSignatureHtml, setComposedSignatureHtml] = useState<string | null>(null);
  const [composeKey, setComposeKey] = useState(0);
  const [mailConfigState, setMailConfigState] = useState<'loading' | 'configured' | 'missing'>('loading');
  const [missingReason, setMissingReason] = useState<EmailConfigReason | null>(null);

  // Mail listesi + seçim + reader modu (Aşama A yeni state)
  const [emails, setEmails] = useState<CaseEmailItem[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readerMode, setReaderMode] = useState<MailThreadReaderMode>('inline');

  // Drag-to-resize state
  const [splitRatio, setSplitRatio] = useState<number>(() => loadSplitRatio());
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const active = CHANNELS.find((c) => c.key === channel) ?? CHANNELS[0];

  // İmzayı sessizce yükle
  useEffect(() => {
    let alive = true;
    void caseEmailService.getEmailSignatureBundle(item.id).then((b) => {
      if (!alive) return;
      setTenantSignatureHtml(b.tenantHtml);
      setAgentSignatureHtml(b.agentHtml);
      setComposedSignatureHtml(b.composedHtml);
    });
    return () => { alive = false; };
  }, [item.id]);

  // Config
  useEffect(() => {
    let alive = true;
    void caseEmailService.getEmailConfig(item.id).then((cfg) => {
      if (!alive) return;
      setMailConfigState(cfg.configured ? 'configured' : 'missing');
      setMissingReason(cfg.configured ? null : cfg.reason);
    });
    return () => { alive = false; };
  }, [item.id]);

  // Mail listesi — refresh callback
  const loadEmails = useCallback(async () => {
    setEmailsLoading(true);
    const items = await caseEmailService.listEmails(item.id);
    setEmails(items);
    setEmailsLoading(false);
    // Default seçim: en son mesaj (backend kronolojik → array son elemanı)
    if (items.length > 0) {
      setSelectedId((cur) => (cur && items.some((e) => e.id === cur)) ? cur : items[items.length - 1].id);
    } else {
      setSelectedId(null);
    }
  }, [item.id]);

  useEffect(() => {
    if (channel === 'email' && mailConfigState === 'configured') {
      void loadEmails();
    }
  }, [channel, mailConfigState, loadEmails]);

  const openReply = useCallback(async (email?: CaseEmailItem) => {
    const ctx = await caseEmailService.getReplyContext(item.id, email?.id);
    setReplyCtx(ctx ?? null);
    setForwardCtx(null);
    setComposerOpen(true);
    setComposeKey((k) => k + 1);
  }, [item.id]);

  const openForward = useCallback(async (email: CaseEmailItem) => {
    const ctx = await caseEmailService.getForwardContext(item.id, email.id);
    setForwardCtx(ctx ?? null);
    setReplyCtx(null);
    setComposerOpen(true);
    setComposeKey((k) => k + 1);
  }, [item.id]);

  const openNew = useCallback(() => {
    setReplyCtx(null);
    setForwardCtx(null);
    setComposerOpen(true);
    setComposeKey((k) => k + 1);
  }, []);

  const handleSent = useCallback(() => {
    // Kullanıcı direktifi: BULUNDUĞU görünüme dön — readerMode DOKUNULMAZ.
    setComposerOpen(false);
    setReplyCtx(null);
    setForwardCtx(null);
    void loadEmails();
    onCaseShouldRefresh?.();
  }, [loadEmails, onCaseShouldRefresh]);

  const handleCancel = useCallback(() => {
    setComposerOpen(false);
    setReplyCtx(null);
    setForwardCtx(null);
  }, []);

  const selectedEmail = useMemo(
    () => emails.find((e) => e.id === selectedId) ?? null,
    [emails, selectedId],
  );

  // Drag-resize handlers
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const ratio = y / rect.height;
      const clamped = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, ratio));
      setSplitRatio(clamped);
    };
    const onUp = () => {
      setDragging(false);
      // Sürükleme sonu → localStorage'a kaydet (final değer)
      setSplitRatio((v) => { saveSplitRatio(v); return v; });
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const resetSplit = useCallback(() => {
    setSplitRatio(SPLIT_DEFAULT);
    saveSplitRatio(SPLIT_DEFAULT);
  }, []);

  return (
    <div className="space-y-3">
      {/* Kanal chips */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-2 dark:border-ndark-border">
        {CHANNELS.map((c) => {
          const isActive = c.key === channel;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => c.enabled && setChannel(c.key)}
              disabled={!c.enabled}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed ${
                isActive
                  ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200 dark:bg-brand-900/30 dark:text-brand-300 dark:ring-brand-900/40'
                  : c.enabled
                    ? 'text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg'
                    : 'text-slate-400 dark:text-ndark-muted opacity-60'
              }`}
              aria-current={isActive ? 'page' : undefined}
              title={c.enabled ? c.label : `${c.label} — Yakında`}
            >
              {c.icon}
              <span>{c.label}</span>
            </button>
          );
        })}
      </div>

      {channel === 'email' && mailConfigState === 'loading' && (
        <div className="py-8 text-center text-sm text-slate-500 dark:text-ndark-muted">Yükleniyor…</div>
      )}

      {channel === 'email' && mailConfigState === 'missing' && (
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
          role="status"
        >
          <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">
              {missingReason === 'disabled'
                ? `"${item.companyName}" için mail entegrasyonu kapalı.`
                : `"${item.companyName}" için mail entegrasyonu yapılandırılmamış.`}
            </p>
            <p className="mt-1 text-xs">
              Admin → Yönetim Paneli → <b>Mail Entegrasyonu</b> → ilgili
              şirket → SMTP/IMAP credentials + gönderen adresi (From) tanımlı
              olmalı. Düzenleme tamamlanınca bu sekme otomatik aktifleşir.
            </p>
          </div>
        </div>
      )}

      {channel === 'email' && mailConfigState === 'configured' && (
        <>
          {composerOpen ? (
            <MailComposer
              key={composeKey}
              item={item}
              initialReplyContext={replyCtx}
              initialForwardContext={forwardCtx}
              initialTenantSignatureHtml={tenantSignatureHtml}
              initialAgentSignatureHtml={agentSignatureHtml}
              initialComposedSignatureHtml={composedSignatureHtml}
              onSent={handleSent}
              onCancel={handleCancel}
            />
          ) : (
            <>
              {/* Toolbar — sadece Yeni e-posta */}
              <div className="flex justify-end">
                <Button type="button" variant="primary" leftIcon={<Plus size={13} />} onClick={openNew}>
                  Yeni e-posta
                </Button>
              </div>

              {emailsLoading ? (
                <div className="py-8 text-center text-sm text-slate-500 dark:text-ndark-muted">Yükleniyor…</div>
              ) : emails.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center dark:border-ndark-border dark:bg-ndark-card">
                  <p className="text-sm text-slate-600 dark:text-ndark-muted">Henüz mesaj yok.</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Bu vakada gelen/giden mail bulunmuyor. "Yeni e-posta" ile yazabilirsiniz.
                  </p>
                </div>
              ) : (
                <div
                  ref={containerRef}
                  className="relative flex min-h-[560px] flex-col overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-ndark-border"
                  style={{ height: 'calc(100vh - 320px)', minHeight: 560 }}
                >
                  {/* ÜST — kompakt mesaj listesi */}
                  <div
                    className="min-h-0 shrink-0 overflow-auto bg-white dark:bg-ndark-card"
                    style={{ height: `${splitRatio * 100}%` }}
                  >
                    <ul className="divide-y divide-slate-100 dark:divide-ndark-border">
                      {emails.map((e) => {
                        const inbound = e.direction === 'inbound';
                        const ts = e.receivedAt ?? e.sentAt ?? e.createdAt;
                        const isSelected = e.id === selectedId;
                        return (
                          <li key={e.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(e.id)}
                              className={`flex w-full min-h-[40px] items-center gap-2 px-3 py-2 text-left text-xs transition ${
                                isSelected
                                  ? 'bg-brand-50 text-brand-900 dark:bg-brand-900/20 dark:text-brand-100'
                                  : 'hover:bg-slate-50 dark:hover:bg-ndark-bg'
                              }`}
                              title={e.subject}
                            >
                              <span
                                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                                  inbound
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                }`}
                                aria-label={inbound ? 'Gelen' : 'Giden'}
                              >
                                {inbound ? <ArrowDown size={10} /> : <ArrowUp size={10} />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-baseline gap-1.5">
                                  <span className="truncate font-medium text-slate-800 dark:text-ndark-text">
                                    {e.from.name || e.from.address}
                                  </span>
                                  <span className="truncate text-slate-500 dark:text-ndark-muted">
                                    {normalizeSubject(e.subject) || '(konusuz)'}
                                    {e.bodyText && ` — ${e.bodyText.slice(0, 80)}`}
                                  </span>
                                </span>
                              </span>
                              {e.attachments.length > 0 && (
                                <span className="inline-flex shrink-0 items-center gap-0.5 text-slate-500 dark:text-ndark-muted">
                                  <Paperclip size={11} />
                                  <span>{e.attachments.length}</span>
                                </span>
                              )}
                              <span className="shrink-0 text-slate-400 dark:text-ndark-muted">
                                {formatDateTime(ts)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {/* Drag handle — sürükleyerek yeniden boyutlandır. Direktif:
                      görünür (ince çizgi + hover'da belirginleşen tutamaç),
                      ≥8px tutma alanı, cursor: row-resize, çift-tık → varsayılan. */}
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    aria-valuemin={SPLIT_MIN * 100}
                    aria-valuemax={SPLIT_MAX * 100}
                    aria-valuenow={Math.round(splitRatio * 100)}
                    tabIndex={0}
                    onMouseDown={() => setDragging(true)}
                    onDoubleClick={resetSplit}
                    className="group relative flex h-2 shrink-0 cursor-row-resize items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-ndark-border dark:hover:bg-slate-700"
                    title="Sürükle: yeniden boyutlandır · Çift-tık: varsayılan (35/65)"
                  >
                    <span className="pointer-events-none h-0.5 w-8 rounded-full bg-slate-400 group-hover:w-12 group-hover:bg-slate-500 dark:bg-ndark-muted" />
                  </div>

                  {/* ALT — okuma alanı */}
                  <div className="min-h-0 flex-1 bg-white dark:bg-ndark-card">
                    {selectedEmail ? (
                      <MailThreadReader
                        email={selectedEmail}
                        caseId={item.id}
                        mode={readerMode}
                        onExpand={() => setReaderMode('fullscreen')}
                        onCollapse={() => setReaderMode('inline')}
                        onReply={(e) => void openReply(e)}
                        onForward={(e) => void openForward(e)}
                        onQuickReply={(e) => void openReply(e)}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-400">
                        Bir mesaj seçin
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {channel !== 'email' && (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center dark:border-ndark-border dark:bg-ndark-card">
          <p className="text-sm text-slate-600 dark:text-ndark-muted">{active.label} kanalı yakında eklenecek.</p>
        </div>
      )}
    </div>
  );
}
