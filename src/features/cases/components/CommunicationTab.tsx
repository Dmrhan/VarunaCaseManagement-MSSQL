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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AtSign, Globe, Info, MessageSquare, Phone, Plus, Send, X } from 'lucide-react';
import { MailComposer } from './MailComposer';
import { MailThreadReader, type MailThreadReaderMode } from './MailThreadReader';
import { MailThreadListPane } from './MailThreadListPane';
import { MAIL_TYPE } from '../lib/mailTypography';
import { Button } from '@/components/ui/Button';
import { caseEmailService, type CaseEmailItem, type EmailConfigReason, type ReplyContext, type ForwardContext } from '@/services/caseEmailService';
import { useAuth } from '@/services/AuthContext';
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

// R15 (2026-07-04) — Sekme-içi drag/ölçüm makinesi TAMAMEN silindi
// (3 layout regresyonun kaynağıydı: 0px liste, kesilen gövde, feedback loop).
// Sekme-içi liste = başlık + 3 tam satır sabit + liste-içi scroll. Gövde
// doğal yükseklik → sayfa akışına serbest.
//
// KALDI: Fullscreen (Gmail düzeni) sol drag — tam ekran deneyimi bozulmasın.
const FS_SPLIT_STORAGE_KEY = 'pr2.commTab.fullscreenListRatio';
const FS_SPLIT_DEFAULT = 0.28;
const FS_SPLIT_MIN = 0.18;
const FS_SPLIT_MAX = 0.40;

// Handle görünürlük hint — 1 kerelik (fs drag için)
const HANDLE_HINT_STORAGE_KEY = 'pr2.commTab.handleHintSeen';

function loadRatio(key: string, def: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return def;
    const v = Number.parseFloat(raw);
    if (!Number.isFinite(v) || v < min || v > max) return def;
    return v;
  } catch {
    return def;
  }
}

function saveRatio(key: string, v: number): void {
  try { localStorage.setItem(key, String(v)); } catch { /* no-op */ }
}

function loadHandleHintSeen(): boolean {
  try { return localStorage.getItem(HANDLE_HINT_STORAGE_KEY) === '1'; } catch { return true; }
}

function saveHandleHintSeen(): void {
  try { localStorage.setItem(HANDLE_HINT_STORAGE_KEY, '1'); } catch { /* no-op */ }
}

interface Props {
  item: Case;
  onCaseShouldRefresh?: () => void;
  /**
   * R10.3 (2026-07-04) — Tam-ekran üst başlık barı müşteri adı tıklaması.
   * App'in CustomerCardModal popup'ını açar (Detay sekmesindeki kardeş
   * desen — accounts sayfası navigasyonu DEĞİL). R10 B5'te yanlışlıkla
   * onOpenAccount'a bağlanmıştı → tam-ekran + İletişim bağlamı kayboluyordu.
   * Verilmezse müşteri adı düz metin gösterilir.
   */
  onShowCustomer?: (accountId: string) => void;
}

export function CommunicationTab({ item, onCaseShouldRefresh, onShowCustomer }: Props) {
  // R9.1 — Oturumdaki kullanıcının id'si (Gmail "ben" paritesi için ListPane
  // + Reader'a geçilir; kendi mail'inde "Siz" yalnız burada tetiklenir).
  // REUSE: mevcut auth context; yeni fetch yok.
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const [channel, setChannel] = useState<Channel>('email');
  const [composerOpen, setComposerOpen] = useState(false);
  // R10.1 — Composer'ın "ESC ile Vazgeç" imperative handle'ı. Composer
  // içindeki requestCancel; parent ESC dinleyicisi bu ref üzerinden tetikler.
  // Dirty ise composer confirm modal açar, temizse doğrudan onCancel'a döner.
  const composerCancelRef = useRef<(() => void) | null>(null);
  // 2026-07-04 PR-2 R5 — Composer layout modu:
  //   - 'inline': Reader body altında satır-içi (Yanıtla + hızlı-yanıt)
  //   - 'overlay': Fullscreen alan (Yeni e-posta + İlet + Büyüt)
  // "Büyüt" tıklama → inline'dan overlay'a, taslak korunur (state lifted).
  const [composerLayout, setComposerLayout] = useState<'inline' | 'overlay'>('overlay');
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

  // R15 — Sekme-içi drag/ölçüm makinesi TAMAMEN silindi. Kalan: fs drag.
  const [fsSplitRatio, setFsSplitRatio] = useState<number>(
    () => loadRatio(FS_SPLIT_STORAGE_KEY, FS_SPLIT_DEFAULT, FS_SPLIT_MIN, FS_SPLIT_MAX),
  );
  const [draggingV, setDraggingV] = useState(false); // vertical (fullscreen)
  const fsContainerRef = useRef<HTMLDivElement>(null);
  // Handle görünürlük hint — ilk sürüklemede kapanır (fs drag için)
  const [handleHintSeen, setHandleHintSeen] = useState<boolean>(() => loadHandleHintSeen());
  const dismissHandleHint = useCallback(() => {
    if (handleHintSeen) return;
    setHandleHintSeen(true);
    saveHandleHintSeen();
  }, [handleHintSeen]);

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
    // R14.2 (2026-07-04) — Otomatik açılış GERİ (R9 davranışı).
    // Mevcut seçim listede kaldıysa korunur (refresh persistence); aksi
    // halde en yeni mesaj (array son elemanı) auto-select. R12 katlı
    // başlangıçtan kullanıcı kararıyla vazgeçildi.
    setSelectedId((cur) => {
      if (cur && items.some((e) => e.id === cur)) return cur;
      return items.length > 0 ? items[items.length - 1].id : null;
    });
  }, [item.id]);

  useEffect(() => {
    if (channel === 'email' && mailConfigState === 'configured') {
      void loadEmails();
    }
  }, [channel, mailConfigState, loadEmails]);

  // R5 — Yanıtla + hızlı-yanıt → INLINE composer (reader body altında)
  const openReply = useCallback(async (email?: CaseEmailItem) => {
    const ctx = await caseEmailService.getReplyContext(item.id, email?.id);
    setReplyCtx(ctx ?? null);
    setForwardCtx(null);
    setComposerLayout('inline');
    setComposerOpen(true);
    setComposeKey((k) => k + 1);
  }, [item.id]);

  // R5 — İlet → OVERLAY composer (tam alan)
  const openForward = useCallback(async (email: CaseEmailItem) => {
    const ctx = await caseEmailService.getForwardContext(item.id, email.id);
    setForwardCtx(ctx ?? null);
    setReplyCtx(null);
    setComposerLayout('overlay');
    setComposerOpen(true);
    setComposeKey((k) => k + 1);
  }, [item.id]);

  // R5 — Yeni e-posta → OVERLAY composer
  const openNew = useCallback(() => {
    setReplyCtx(null);
    setForwardCtx(null);
    setComposerLayout('overlay');
    setComposerOpen(true);
    setComposeKey((k) => k + 1);
  }, []);

  // R5 — Büyüt: inline → overlay (aynı composer instance, state korunur —
  // MailComposer prop değişimi state kaybettirmez).
  const growComposer = useCallback(() => {
    setComposerLayout('overlay');
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

  // R10.1 — ESC katman zinciri: lightbox > composer > fullscreen.
  //   - Composer açıkken parent ESC yakalar → composerCancelRef.current?.()
  //     (composer içi: dirty → confirm modal / temiz → onCancel / modal
  //     açıksa modal kapan).
  //   - Composer kapanınca fullscreen AÇIK KALIR (Reader ESC bir sonraki
  //     tuşta onCollapse eder).
  //   - Sekme-içi inline'da da aynı davranış (Reader ESC yok, tab dışı).
  //   - Lightbox açıkken Reader ESC listener zaten pas geçiyor; Lightbox
  //     kendi window listener'ı ile onClose'u yönetir.
  useEffect(() => {
    if (!composerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      composerCancelRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composerOpen]);

  const selectedEmail = useMemo(
    () => emails.find((e) => e.id === selectedId) ?? null,
    [emails, selectedId],
  );

  // Thread-seviye cid indeksi (Madde 1, 2026-07-08) — GÖRÜNTÜLENEN mailin inline
  // eklerinde bulunamayan cid'i aynı vakadaki diğer mailin ekiyle çözer (yanıt/
  // ilet alıntısı orijinalin cid'ini taşır ama görseli yeni maile eklenmez).
  //
  // Codex #480 P2 — kaynak KISITI: bir mail yalnız KENDİNDEN ÖNCEKİ mesajları
  // alıntılar. İndeks yalnız selectedEmail'den THREAD SIRASINDA önceki mailleri
  // kaynak alır. Ham timestamp yerine SIRALI POZİSYON: aynı ts kovasındaki
  // sonraki mail eski maile sızmasın (Codex #482 — ts + kararlı tiebreak).
  //
  // Codex #481/#482 P2 — BELİRSİZLİK + KANONİKLEŞTİRME: cid tek kanonik anahtara
  // (bracket-sız + lowercase) indirilir; `<Logo>`/`logo`/`LOGO` alias'ları aynı
  // anahtara düşer. Bir cid önceki maillerde AYRI DOSYAYA işaret ediyorsa
  // çözülmez (placeholder) — tek anahtar sayesinde alias sızıntısı yok.
  //
  // Evidence Preservation fix (adversarial review, 2026-07-09) — belirsizlik
  // artık EK İD'siyle değil DOSYA KİMLİĞİYLE (fileKey = storageKey hash'i)
  // ölçülür. Snapshot compiler aynı cid'i (aynı DOSYA) birden fazla mailin
  // altına meşru olarak kopyalar; ek-id karşılaştırması bu kopyaları yanlışlıkla
  // "belirsiz" sayıp legacy thread-fallback'i bozuyordu. Aynı fileKey = aynı
  // görsel → belirsiz DEĞİL; farklı fileKey = gerçekten farklı dosya → belirsiz.
  const threadCidIndex = useMemo(() => {
    const m = new Map<string, { emailId: string; attachmentId: string; fileName: string; fileKey: string | null }>();
    if (!selectedEmail) return m;
    const canon = (s: string) => s.trim().replace(/^<|>$/g, '').toLowerCase();
    const tsOf = (e: CaseEmailItem) => new Date(e.sentAt ?? e.receivedAt ?? e.createdAt).getTime();
    // Kararlı thread sırası: ts → createdAt → id. Seçili mailin pozisyonundan
    // ÖNCEKİLER kaynak (kendisi ve sonrakiler hariç).
    const ordered = [...emails].sort((a, b) =>
      tsOf(a) - tsOf(b)
      || a.createdAt.localeCompare(b.createdAt)
      || a.id.localeCompare(b.id));
    const curIdx = ordered.findIndex((e) => e.id === selectedEmail.id);
    const sources = curIdx < 0 ? [] : ordered.slice(0, curIdx);
    const ambiguous = new Set<string>();
    for (const e of sources) {
      for (const a of e.attachments) {
        if (!a.contentId) continue;
        const k = canon(a.contentId);
        if (!k) continue;
        const existing = m.get(k);
        if (existing) {
          // Aynı dosyaya işaret eden kopya (snapshot) → belirsiz değil.
          // fileKey herhangi birinde yoksa güvenli taraf: ek-id kıyası.
          const sameFile = existing.fileKey != null && a.fileKey != null
            ? existing.fileKey === a.fileKey
            : existing.attachmentId === a.id;
          if (!sameFile) ambiguous.add(k); // farklı DOSYA → belirsiz
        } else {
          m.set(k, { emailId: e.id, attachmentId: a.id, fileName: a.fileName, fileKey: a.fileKey ?? null });
        }
      }
    }
    for (const k of ambiguous) m.delete(k); // belirsizleri çözme
    return m;
  }, [emails, selectedEmail]);

  // R5+R8 — Reader alt bölge (bottomSlot) YALNIZ hızlı-yanıt button
  // (composer kapalı iken). Composer AÇIK ise bottomSlot=null: composer
  // asla reader.bottomSlot'ta render EDİLMEZ. Böylece composer TEK JSX
  // yerde (aşağıda kök seviyesinde) tanımlı → mode değişiminde React
  // fiber tree'de konum sabit → state korunur (R8 fix).
  //
  // Hızlı-yanıt = composer'ın "kapalı hali" (aynı akış: openReply çağrır).
  const renderReaderBottom = useCallback((email: CaseEmailItem): ReactNode => {
    if (composerOpen) return null;
    return (
      <button
        type="button"
        onClick={() => void openReply(email)}
        className={`flex w-full min-h-[40px] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left ${MAIL_TYPE.t2} text-slate-500 hover:bg-slate-100 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-muted`}
      >
        <Send size={12} />
        <span>Hızlı yanıt yaz… (Yanıtla ile aynı bileşen)</span>
      </button>
    );
  }, [composerOpen, openReply]);

  // R15 — Sekme-içi drag/ölçüm makinesi tamamen silindi (uygun yorumu 3. maddede).

  // Vertical (fullscreen Gmail düzeni) drag effect
  useEffect(() => {
    if (!draggingV) return;
    const onMove = (e: MouseEvent) => {
      const el = fsContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
      const clamped = Math.max(FS_SPLIT_MIN, Math.min(FS_SPLIT_MAX, ratio));
      setFsSplitRatio(clamped);
    };
    const onUp = () => {
      setDraggingV(false);
      setFsSplitRatio((v) => { saveRatio(FS_SPLIT_STORAGE_KEY, v); return v; });
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingV]);

  // R15 — resetSplit KALDIRILDI (sekme-içi drag yok).
  const resetFsSplit = useCallback(() => {
    setFsSplitRatio(FS_SPLIT_DEFAULT);
    saveRatio(FS_SPLIT_STORAGE_KEY, FS_SPLIT_DEFAULT);
  }, []);

  return (
    // R15 — Doğal akış: viewport-sabit zincir kaldırıldı; sayfa scroll'una döndü.
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
          {/* 2026-07-04 PR-2 (görsel tur R1) — Composer artık OVERLAY (fixed
              inset-0 z-50). Reader/liste her zaman render; composer üstünde
              katmandır. Kapat/Gönder → composerOpen=false → arkada mode
              korunan reader (inline veya fullscreen) tekrar görünür.
              Eski sekme-içi conditional swap KALDIRILDI — "Yeni e-posta"
              dahil TÜM composer akışları overlay üzerinden gider.
              R12 (2026-07-04) — Tam-genişlik "Yeni e-posta" toolbar satırı
              KALDIRILDI; buton ListPane başlık çubuğuna kompakt olarak
              taşındı (onNewEmail prop). Dikey yer listeye kazandırıldı. */}
              {emailsLoading ? (
                <div className="py-8 text-center text-sm text-slate-500 dark:text-ndark-muted">Yükleniyor…</div>
              ) : emails.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center dark:border-ndark-border dark:bg-ndark-card">
                  <p className="text-sm text-slate-600 dark:text-ndark-muted">Henüz mesaj yok.</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Bu vakada gelen/giden mail bulunmuyor.
                  </p>
                  <div className="mt-3 flex justify-center">
                    <Button type="button" variant="primary" leftIcon={<Plus size={13} />} onClick={openNew}>
                      Yeni e-posta
                    </Button>
                  </div>
                </div>
              ) : (
                // R15 — Sekme-içi doğal akış: liste sabit (rowsCap 174 + kendi
                // scroll'u) + reader AYRI KART yüzey (ring/rounded + nefes
                // payı) doğal yükseklikte. Sayfa scroll'u serbest.
                <div className="flex flex-col gap-3">
                  {/* ÜST — liste kartı (başlık + 3 tam satır; liste-içi scroll).
                      SABİT yükseklik (h-[174px]): max-h + h-full çocuk zincirinde
                      parent auto ile döngüye giriyordu (child natural expand).
                      Sabit height → clamp temiz, ListPane iç scroll çalışır. */}
                  <div className="h-[174px] overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-ndark-border">
                    <MailThreadListPane
                      emails={emails}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      className="h-full"
                      caseTitle={item.title}
                      currentUserId={currentUserId}
                      onNewEmail={openNew}
                    />
                  </div>

                  {/* ALT — Reader AYRI KART (R15 M4 görsel hiyerarşi:
                      "üstte liste, altta AÇIK MAİL" okunmalı). */}
                  {selectedEmail && (
                    <div
                      // Alan israfı fix'i (kullanıcı direktifi 2026-07-09):
                      // dikey (sekme-içi) modda composer açıkken reader
                      // kompakt yüksekliğe (35vh) sıkıştırılır — gövde
                      // İÇERİDE kayar, yanıt kutusu yukarıda başlar.
                      // Composer kapaliyken kısıt yok (eski görünüm).
                      className={`rounded-lg bg-white shadow-sm ring-1 ring-slate-200 dark:bg-ndark-card dark:ring-ndark-border ${
                        composerOpen && composerLayout === 'inline'
                          ? 'flex max-h-[35vh] min-h-0 flex-col overflow-hidden'
                          : ''
                      }`}
                    >
                      <MailThreadReader
                        email={selectedEmail}
                        caseId={item.id}
                        mode="inline"
                        onExpand={() => setReaderMode('fullscreen')}
                        onCollapse={() => setReaderMode('inline')}
                        onReply={(e) => void openReply(e)}
                        onForward={(e) => void openForward(e)}
                        bottomSlot={renderReaderBottom(selectedEmail)}
                        currentUserId={currentUserId}
                        escEnabled={!composerOpen}
                        threadCidIndex={threadCidIndex}
                      />
                    </div>
                  )}
                </div>
              )}
        </>
      )}

      {/* R4: Fullscreen Gmail düzeni — SOL liste + dikey handle + SAĞ reader.
          MailThreadListPane sekme içi ÜST pane ile AYNI bileşen (yeniden yazma yok).
          Composer overlay z-50 bunun üstünde açılır. ESC → sekme görünümüne dön. */}
      {readerMode === 'fullscreen' && emails.length > 0 && selectedEmail && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mail thread (genişletilmiş)"
          className="fixed inset-0 z-40 flex flex-col bg-white dark:bg-ndark-bg"
        >
          {/* R10 B5 + R10.3 — Tam-ekran üst başlık barı. Vaka context taşıyıcı:
              caseNumber (mono badge) + title (semibold truncate) + · Müşteri
              (tıklanabilir → onShowCustomer = CustomerCardModal popup, Detay
              sekmesindeki kardeş desen) + · İletişim kişisi (muted) + X. */}
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 dark:border-ndark-border dark:bg-ndark-card">
            <span className={`shrink-0 rounded bg-slate-100 px-2 py-0.5 ${MAIL_TYPE.barCaseNo} text-slate-700 dark:bg-ndark-bg dark:text-ndark-text`}>
              {item.caseNumber}
            </span>
            <h2
              className={`min-w-0 flex-1 truncate ${MAIL_TYPE.barTitle} text-slate-900 dark:text-ndark-text`}
              title={item.title}
            >
              {item.title}
            </h2>
            {item.accountName && (
              <>
                <span className="shrink-0 text-slate-300 dark:text-ndark-muted">·</span>
                {onShowCustomer && item.accountId ? (
                  <button
                    type="button"
                    onClick={() => onShowCustomer(item.accountId)}
                    className={`shrink-0 truncate ${MAIL_TYPE.barCustomer} text-brand-700 hover:underline dark:text-brand-300`}
                    title={`Müşteri kartını aç: ${item.accountName}`}
                  >
                    {item.accountName}
                  </button>
                ) : (
                  <span className={`shrink-0 truncate ${MAIL_TYPE.barCustomer} text-slate-700 dark:text-ndark-text`}>
                    {item.accountName}
                  </span>
                )}
              </>
            )}
            {item.customerContactName && (
              <>
                <span className="shrink-0 text-slate-300 dark:text-ndark-muted">·</span>
                <span
                  className={`shrink-0 truncate ${MAIL_TYPE.barCustomer} text-slate-500 dark:text-ndark-muted`}
                  title="İletişim kişisi"
                >
                  {item.customerContactName}
                </span>
              </>
            )}
            <button
              type="button"
              onClick={() => setReaderMode('inline')}
              className="ml-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-bg"
              aria-label="Kapat"
              title="Kapat (Esc)"
            >
              <X size={18} />
            </button>
          </div>
          <div ref={fsContainerRef} className="flex min-h-0 w-full flex-1">
            {/* SOL — mesaj listesi */}
            <div
              className="min-h-0 shrink-0 border-r border-slate-200 dark:border-ndark-border"
              style={{ width: `${fsSplitRatio * 100}%` }}
            >
              <MailThreadListPane
                emails={emails}
                selectedId={selectedId}
                onSelect={setSelectedId}
                className="h-full"
                variant="fullscreen"
                caseTitle={item.title}
                currentUserId={currentUserId}
                onNewEmail={openNew}
              />
            </div>

            {/* R3+R4 VERTICAL drag handle — Gmail dikey ayırıcı:
                - Sınır çizgisi her zaman görünür (border-x)
                - Ortada nokta tutamaç (3 dot dikey)
                - Hover'da tutamaç genişler + arka plan koyulaşır
                - cursor: col-resize (sekme içi'nden farklı — direktif)
                - Aynı 1 kerelik hint mekanizması */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-valuemin={FS_SPLIT_MIN * 100}
              aria-valuemax={FS_SPLIT_MAX * 100}
              aria-valuenow={Math.round(fsSplitRatio * 100)}
              tabIndex={0}
              onMouseDown={() => { setDraggingV(true); dismissHandleHint(); }}
              onDoubleClick={resetFsSplit}
              className="group relative flex w-3 shrink-0 cursor-col-resize items-center justify-center border-x border-slate-300 bg-slate-100 hover:bg-slate-200 dark:border-ndark-border dark:bg-ndark-border/60 dark:hover:bg-slate-700"
              title="Sürükle: yeniden boyutlandır · Çift-tık: varsayılan (28/72)"
            >
              <span className="pointer-events-none flex flex-col gap-1">
                <span className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-slate-600" />
                <span className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-slate-600" />
                <span className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-slate-600" />
              </span>
              {!handleHintSeen && (
                <div className={`pointer-events-none absolute left-full ml-2 top-1/2 z-20 -translate-y-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 ${MAIL_TYPE.t1} text-white shadow-lg`}>
                  Sürükleyerek yeniden boyutlandır · Çift-tık: varsayılan
                </div>
              )}
            </div>

            {/* SAĞ — okuma alanı (aynı reader, mode='fullscreen') */}
            <div className="min-w-0 flex-1">
              <MailThreadReader
                email={selectedEmail}
                caseId={item.id}
                mode="fullscreen"
                onExpand={() => setReaderMode('fullscreen')}
                onCollapse={() => setReaderMode('inline')}
                onReply={(e) => void openReply(e)}
                onForward={(e) => void openForward(e)}
                bottomSlot={renderReaderBottom(selectedEmail)}
                currentUserId={currentUserId}
                escEnabled={!composerOpen}
                threadCidIndex={threadCidIndex}
              />
            </div>
          </div>
        </div>
      )}

      {/* R8 (2026-07-04) — Composer TEK JSX yerde (fiber tree'de konum sabit).
          Wrapper class layoutMode'a göre değişir; MailComposer instance'ı
          aynı kalır → mode geçişinde state korunur (subject/body/Kime/Cc
          hepsi doğal olarak taşınır).
          Reader'daki mode çözümüyle AYNI desen: iç içerik sabit, dış
          wrapper mode conditional.
          R10 B1 (2026-07-04) — 3. durum: readerMode='fullscreen' && layoutMode='inline'
          → sağ okuma panelinin altına DOCK et (Gmail-inline hissi). Wrapper
          sabit-pozisyon, sol kenar dinamik (fsSplitRatio → drag ratio değişince
          left güncellenir). Composer instance yine TEK. */}
      {composerOpen && (
        <div
          className={
            // UX fix (2026-07-09) — overlay/dock'ta overflow-auto KALDIRILDI:
            // kaydırma composer İÇİNE taşındı (alanlar+editör kayar), aksiyon
            // barı (Büyüt/Vazgeç/Önizleme/Gönder) hep görünür (footer freeze).
            // Overlay'de composer inset-0'ı doldurur → bar gerçek sayfa dibinde.
            composerLayout === 'overlay'
              ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-white dark:bg-ndark-bg'
              : readerMode === 'fullscreen'
                ? 'fixed bottom-0 right-0 z-50 flex max-h-[55%] flex-col overflow-hidden border-t border-l border-slate-200 bg-white shadow-2xl dark:border-ndark-border dark:bg-ndark-bg'
                : 'mt-3 rounded-lg ring-1 ring-slate-200 dark:ring-ndark-border'
          }
          style={
            composerLayout === 'inline' && readerMode === 'fullscreen'
              ? { left: `${fsSplitRatio * 100}%` }
              : undefined
          }
        >
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
            layoutMode={composerLayout}
            onGrow={growComposer}
            compactDock={composerLayout === 'inline' && readerMode === 'fullscreen'}
            cancelRequestRef={composerCancelRef}
          />
        </div>
      )}

      {channel !== 'email' && (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center dark:border-ndark-border dark:bg-ndark-card">
          <p className="text-sm text-slate-600 dark:text-ndark-muted">{active.label} kanalı yakında eklenecek.</p>
        </div>
      )}
    </div>
  );
}
