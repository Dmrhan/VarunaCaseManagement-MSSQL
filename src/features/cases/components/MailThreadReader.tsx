/**
 * MailThreadReader — İletişim sekmesi okuma alanı (PR-2 Aşama A).
 *
 * TEK BİLEŞEN İKİ BOYUTTA (kullanıcı direktifi — kod çatallaması yasak):
 *   mode='inline'     → CommunicationTab dikey usta-detay altında normal div
 *   mode='fullscreen' → fixed inset-0 overlay (Genişlet → aynı bileşen)
 *
 * İç yapısı sabit; sadece dış wrapper değişir. Genişlet/X/ESC eventleri
 * caller (CommunicationTab) yönetir; reader durum bilmez — controlled bileşen.
 *
 * REUSE:
 *   - sanitizeMailHtml (defense-in-depth render)
 *   - Lightbox + HoverPreview (PR-1) — attachment chip'leri
 *   - normalizeSubject (PR-2 FAZ 1)
 *
 * Aksiyon barı slot'ları:
 *   - Yanıtla · İlet · Genişlet · [data-runa-slot] (RUNA yanıt önerileri
 *     gelecek; şimdi boş structural slot)
 *
 * KAPSAM DIŞI (Aşama A): alıntı katlama · klavye kısayolları · canlı yenileme.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
  Paperclip,
  Reply,
  Forward,
  X,
} from 'lucide-react';
import { sanitizeMailHtml } from '@/lib/sanitizeMailHtml';
import { normalizeSubject } from '@/lib/subjectNormalizer';
import type { CaseEmailItem } from '@/services/caseEmailService';
import { caseEmailService } from '@/services/caseEmailService';
import { Lightbox, type LightboxItem } from '@/components/attachments/Lightbox';
import { HoverPreview } from '@/components/attachments/HoverPreview';
import { formatBytes, formatDateTime } from '@/lib/format';
import { computeSenderDisplay } from '../lib/mailSender';
import { MAIL_TYPE } from '../lib/mailTypography';

export type MailThreadReaderMode = 'inline' | 'fullscreen';

interface Props {
  email: CaseEmailItem;
  caseId: string;
  mode: MailThreadReaderMode;
  /** Genişlet ikonu tıklandığında (mode='inline' → 'fullscreen'). */
  onExpand: () => void;
  /** Fullscreen kapanışı (X veya ESC). */
  onCollapse: () => void;
  /** Yanıtla tıklaması — parent composer'ı reply mode ile açar. */
  onReply: (email: CaseEmailItem) => void;
  /** İlet tıklaması — parent composer'ı forward mode ile açar. */
  onForward: (email: CaseEmailItem) => void;
  /**
   * 2026-07-04 PR-2 R5 — Reader body altında render edilecek özel içerik.
   * Parent (CommunicationTab) inline composer açık ise MailComposer node'u,
   * kapalı ise hızlı-yanıt çubuğu verir. Yoksa alt bölge gizli.
   * Hızlı-yanıt çubuğu artık reader tarafında sabit DEĞİL — parent kararı.
   */
  bottomSlot?: React.ReactNode;
  /**
   * R9.1 — Oturumdaki kullanıcının id'si (Gmail 'ben' paritesi). Header'da
   * gönderen adı ListPane ile AYNI util üstünden hesaplanır. Verilmezse
   * "Siz" hiçbir zaman tetiklenmez.
   */
  currentUserId?: string | null;
  /**
   * R10 B2+B3 — ESC katman sahipliği. Parent (CommunicationTab) EN ÜSTTEKİ
   * katmanı bilir (composer açıksa false → composer taslağı kaybolmaz;
   * lightbox açıkken bu prop true olsa dahi iç guard fs kapatmayı engeller).
   * Default true → geriye uyum.
   */
  escEnabled?: boolean;
  /**
   * Thread-seviye cid indeksi (parent CommunicationTab tüm maillerin
   * eklerinden kurar). Reader kendi ekinde bulamadığı `cid:`'i aynı vakadaki
   * diğer mailin ekiyle çözer — alıntı geçmişindeki inline görsel tutarlı
   * görünür (2026-07-08 Madde 1).
   */
  threadCidIndex?: ThreadCidIndex;
}

function joinAddresses(arr: CaseEmailItem['to']): string {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr
    .map((r) => (r.name ? `${r.name} <${r.address}>` : r.address))
    .join(', ');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Cid render — bodyHtml içindeki <img src="cid:xxx"> referanslarını
 * token'lı download URL'ine rewrite eder. MailMessageCard'daki 4 halkalı
 * fix zinciriyle uyumlu MINIMAL versiyon:
 *  - contentId lookup (3 varyant: raw, stripped, lowercase)
 *  - Bulunanda src rewrite; bulunamayanda placeholder (kırık ikon YERİNE)
 *  - Src'siz img heuristic (byName + legacy) — MailMessageCard'daki kural.
 *    Kapsam gereği burada tekrar yazıldı; ileride ortak hook'a alınacak.
 */
/** Thread-seviye cid indeksi — cid → sahibi mailin id'si + ek id'si. Reader
 *  kendi ekinde cid'i bulamazsa (yanıt/ilet alıntısı orijinalin cid'ini taşır
 *  ama görseli bu maile eklenmez) aynı vakadaki diğer mailin ekiyle çözer. */
type ThreadCidIndex = Map<string, { emailId: string; attachmentId: string; fileName: string; fileKey: string | null }>;

async function processBodyHtml(
  email: CaseEmailItem,
  caseId: string,
  cidMap: Map<string, { id: string; fileName: string }>,
  threadCidIndex?: ThreadCidIndex,
): Promise<string> {
  const html = email.bodyHtml ?? '';
  if (!html) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.querySelector('#root');
  if (!root) return html;

  // Pre-scan: gövdedeki cid: ref'ler → src'siz fallback bunları exclude eder
  const cidReferencedKeys = new Set<string>();
  const imgs = Array.from(root.querySelectorAll('img'));
  for (const img of imgs) {
    const s = (img.getAttribute('src') ?? '').trim();
    if (!s.toLowerCase().startsWith('cid:')) continue;
    const cidRaw = s.slice(4).trim();
    const cidStripped = cidRaw.replace(/^<|>$/g, '');
    cidReferencedKeys.add(cidRaw);
    cidReferencedKeys.add(cidStripped);
    cidReferencedKeys.add(cidStripped.toLowerCase());
  }
  const isAttCidReferenced = (a: { contentId: string | null }): boolean => {
    if (!a.contentId) return false;
    const raw = a.contentId.trim();
    const stripped = raw.replace(/^<|>$/g, '');
    return cidReferencedKeys.has(raw)
      || cidReferencedKeys.has(stripped)
      || cidReferencedKeys.has(stripped.toLowerCase());
  };
  const consumed = new Set<string>();
  const jobs: Array<Promise<void>> = [];
  const isOld = email.attachments.length === 0;

  for (const img of imgs) {
    const src = (img.getAttribute('src') ?? '').trim();
    const isCidSrc = src.toLowerCase().startsWith('cid:');
    const isEmptySrc = !src;
    if (!isCidSrc && !isEmptySrc) continue;

    if (isEmptySrc) {
      const alt = (img.getAttribute('alt') ?? '').trim();
      const candidates = email.attachments.filter(
        (x) => x.isInline && !consumed.has(x.id) && !isAttCidReferenced(x),
      );
      let match: { id: string; fileName: string } | null = null;
      if (alt) {
        const byName = candidates.find((x) => x.fileName === alt);
        if (byName) match = { id: byName.id, fileName: byName.fileName };
      }
      if (!match && candidates.length === 1 && candidates[0].contentId == null) {
        match = { id: candidates[0].id, fileName: candidates[0].fileName };
      }
      if (match) {
        consumed.add(match.id);
        const m = match;
        jobs.push((async () => {
          const out = await caseEmailService.getAttachmentDownload(caseId, email.id, m.id);
          if (out?.url) {
            img.setAttribute('src', out.url);
            if (!img.getAttribute('alt')) img.setAttribute('alt', m.fileName);
          } else {
            const ph = doc.createElement('span');
            ph.setAttribute('class', 'inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500');
            ph.textContent = `🖼 ${escapeHtml(m.fileName)} — dosya sunucuda bulunamadı`;
            img.replaceWith(ph);
          }
        })());
        continue;
      }
      const placeholder = doc.createElement('span');
      placeholder.setAttribute('class', 'inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700');
      const inlineNames = candidates.map((x) => x.fileName).join(', ');
      placeholder.textContent = isOld
        ? `🖼 Eski mail — inline görsel desteklenmiyor`
        : inlineNames
          ? `🖼 Gömülü görsel — ekte: ${inlineNames}`
          : `🖼 ${alt || 'görsel'} (kaynak bulunamadı)`;
      img.replaceWith(placeholder);
      continue;
    }

    const cid = src.slice(4).trim();
    const stripped = cid.replace(/^<|>$/g, '');
    const found = cidMap.get(cid) ?? cidMap.get(stripped) ?? cidMap.get(stripped.toLowerCase());
    if (!found) {
      // R2 review fix — ÇÖZÜM SIRASI kritik:
      //   1) thread-fallback (otoriter: cid'in GERÇEK sahibi başka mailde)
      //   2) legacy tek-aday (yalnız thread'de YOKSA + yol-benzeri DEĞİLSE)
      //   3) sebepli placeholder
      // Legacy fallback öne alınırsa taze kayıtlarda (Apple Mail'in cid'siz
      // inline eki: isInline=true + contentId=null) alıntıdaki cid YANLIŞ
      // eke bağlanır ve thread'deki doğru çözüm hiç denenmez. Yol-benzeri
      // cid (c:/users/... — görsel bize HİÇ ulaşmadı) hiçbir eke bağlanamaz.
      const looksLikePath = /[\\/]/.test(stripped) || /^[a-z]:/i.test(stripped);
      // 1) Thread-seviye fallback: görsel kendi ekinde yok ama aynı vakadaki
      // BAŞKA mailin ekinde olabilir (yanıt/ilet alıntısı orijinalin cid'ini
      // taşır). Sahibi mailin id'siyle indir — download endpoint emailId↔
      // attachmentId sahipliğini doğrular, caseId guard aynı.
      // İndeks TEK KANONİK anahtar (bracket-sız + lowercase) tutar → aynı
      // biçimle ara (Codex #482 alias sızıntısı guard'ı).
      const t = threadCidIndex?.get(stripped.toLowerCase());
      if (t) {
        const tm = t;
        jobs.push((async () => {
          const out = await caseEmailService.getAttachmentDownload(caseId, tm.emailId, tm.attachmentId);
          if (out?.url) {
            img.setAttribute('src', out.url);
            if (!img.getAttribute('alt')) img.setAttribute('alt', tm.fileName);
          } else {
            const ph = doc.createElement('span');
            ph.setAttribute('class', 'inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500');
            ph.textContent = `🖼 ${escapeHtml(tm.fileName)} — dosya sunucuda bulunamadı`;
            img.replaceWith(ph);
          }
        })());
        continue;
      }
      // 2) Legacy kurtarma (MailMessageCard'dan port — eski-kayıt paritesi):
      // parser-fix ÖNCESİ kayıtlarda gövdede cid:X var ama ek contentId=null
      // yazılmış (UNV-1000089 sınıfı) → cidMap VE thread indeksi boş. TEK
      // inline aday + contentId==null ise güvenle o eke bağla (uniquely
      // attributable); consumed filtresi duplicate render'ı önler. Yol-benzeri
      // cid'de DEVRE DIŞI (o görsel hiç gelmedi — logoya bağlamak yanlış atıf).
      const candidates = email.attachments.filter(
        (x) => x.isInline && !consumed.has(x.id),
      );
      const canUseLegacyFallback = !looksLikePath
        && candidates.length === 1 && candidates[0].contentId == null;
      const fallback = canUseLegacyFallback ? candidates[0] : null;
      if (fallback) {
        consumed.add(fallback.id);
        jobs.push((async () => {
          const out = await caseEmailService.getAttachmentDownload(caseId, email.id, fallback.id);
          if (out?.url) {
            img.setAttribute('src', out.url);
            if (!img.getAttribute('alt')) img.setAttribute('alt', fallback.fileName);
          } else {
            const ph = doc.createElement('span');
            ph.setAttribute('class', 'inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500');
            ph.textContent = `🖼 ${escapeHtml(fallback.fileName)} — dosya sunucuda bulunamadı`;
            img.replaceWith(ph);
          }
        })());
        continue;
      }
      // 3) Evidence Preservation PR-3 — sebepli placeholder. Bu noktaya gelen
      // cid ne mailin kendi ekinde ne thread'de var. İki sınıf:
      //   a) Yol-benzeri cid (`c:/users/...` Outlook local-path imzası) →
      //      görsel bize HİÇ ulaşmadı, gönderici tarafında kaldı — kesin.
      //   b) Diğerleri → ekte gelmemiş OLABİLİR ya da intake reddetmiş
      //      olabilir (25MB/tür/limit — skip aktivitede kayıtlı). Sebep
      //      bilinemediğinden SUÇLAMA YOK; agent'ı vaka aktivitesindeki
      //      kayda yönlendir (adversarial review fix: yanlış "göndericide
      //      kaldı" beyanı müşteriye hatalı geri dönüşe yol açıyordu).
      const ph = doc.createElement('span');
      ph.setAttribute('class', 'inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700');
      ph.setAttribute('title', `cid:${stripped}`);
      ph.textContent = looksLikePath
        ? `🖼 ${img.getAttribute('alt') || 'görsel'} — ekte gelmedi (gönderici tarafında kaldı)`
        : `🖼 ${img.getAttribute('alt') || 'görsel'} — görsel alınamadı (neden için vaka aktivitesine bakın · Dosya filtresi)`;
      img.replaceWith(ph);
      continue;
    }
    consumed.add(found.id);
    const m = found;
    jobs.push((async () => {
      const out = await caseEmailService.getAttachmentDownload(caseId, email.id, m.id);
      if (out?.url) {
        img.setAttribute('src', out.url);
        if (!img.getAttribute('alt')) img.setAttribute('alt', m.fileName);
      } else {
        const ph = doc.createElement('span');
        ph.setAttribute('class', 'inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500');
        ph.textContent = `🖼 ${escapeHtml(m.fileName)} — dosya sunucuda bulunamadı`;
        img.replaceWith(ph);
      }
    })());
  }
  await Promise.all(jobs);
  return root.innerHTML;
}

export function MailThreadReader({
  email,
  caseId,
  mode,
  onExpand,
  onCollapse,
  onReply,
  onForward,
  bottomSlot,
  currentUserId = null,
  escEnabled = true,
  threadCidIndex,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [lightboxActiveId, setLightboxActiveId] = useState<string | null>(null);

  // Cid map — 3 varyant lookup (mailparser cid format tutarsız).
  const cidMap = useMemo(() => {
    const m = new Map<string, { id: string; fileName: string }>();
    for (const a of email.attachments) {
      if (!a.contentId) continue;
      const raw = a.contentId.trim();
      const stripped = raw.replace(/^<|>$/g, '');
      m.set(raw, { id: a.id, fileName: a.fileName });
      m.set(stripped, { id: a.id, fileName: a.fileName });
      m.set(stripped.toLowerCase(), { id: a.id, fileName: a.fileName });
    }
    return m;
  }, [email.attachments]);

  useEffect(() => {
    let alive = true;
    setRewriting(true);
    setRenderedHtml(null);
    void processBodyHtml(email, caseId, cidMap, threadCidIndex).then((html) => {
      if (!alive) return;
      setRenderedHtml(html);
      setRewriting(false);
    }).catch(() => {
      if (!alive) return;
      setRenderedHtml(email.bodyHtml ?? '');
      setRewriting(false);
    });
    return () => { alive = false; };
  }, [email, caseId, cidMap, threadCidIndex]);

  // R10 B2+B3 — ESC katman sahipliği: tek tuş = tek katman.
  //   - Lightbox açıksa fs kapatma (Lightbox kendi ESC'ini tüketir)
  //   - Composer açıksa (escEnabled=false) fs kapatma (taslak koruması)
  //   - Aksi halde (üstteki katman fs ise) ESC fs'i kapatır
  useEffect(() => {
    if (mode !== 'fullscreen') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lightboxActiveId != null) return;
      if (!escEnabled) return;
      onCollapse();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, onCollapse, escEnabled, lightboxActiveId]);

  const isInbound = email.direction === 'inbound';
  const timestamp = email.receivedAt ?? email.sentAt ?? email.createdAt;
  const previewableAttachments = useMemo<LightboxItem[]>(
    () => email.attachments
      .filter((a) => (a.mimeType ?? '').toLowerCase().startsWith('image/'))
      .map((a) => ({ id: a.id, fileName: a.fileName, fileSize: a.fileSize, mimeType: a.mimeType })),
    [email.attachments],
  );

  const getAttachmentPreviewUrl = useCallback(async (att: LightboxItem) => {
    const out = await caseEmailService.getAttachmentDownload(caseId, email.id, att.id);
    return out ? { url: out.url, fileName: out.fileName } : null;
  }, [caseId, email.id]);

  const getAttachmentPreviewUrlHover = useCallback(async (att: LightboxItem) => {
    const out = await caseEmailService.getAttachmentDownload(caseId, email.id, att.id);
    return out ? { url: out.url } : null;
  }, [caseId, email.id]);

  const downloadAttachment = useCallback(async (attId: string) => {
    const r = await caseEmailService.getAttachmentDownload(caseId, email.id, attId);
    if (r?.url) {
      const a = document.createElement('a');
      a.href = r.url;
      a.download = r.fileName;
      a.click();
    }
  }, [caseId, email.id]);

  const openAttachment = (attId: string, isImage: boolean) => {
    if (isImage) setLightboxActiveId(attId);
    else void downloadAttachment(attId);
  };

  const safeBody = renderedHtml ? sanitizeMailHtml(renderedHtml) : null;

  const readerBody = (
    // R15 M2 — mode='inline' iken doğal yükseklik (iç scroll YOK; sayfa akışı).
    // Fullscreen'de flex h-full overflow-hidden (kendi overlay iç scroll'u).
    <div className={mode === 'fullscreen' ? 'flex h-full flex-col overflow-hidden' : 'flex flex-col'}>
      {/* Header — subject + ayrıntılar toggle + meta.
          R15 — dikey bütçe kalktı; nefes payı geri. Fs py-3 / inline py-2. */}
      <div className={`shrink-0 border-b border-slate-200 px-4 ${mode === 'fullscreen' ? 'py-3' : 'py-2'} dark:border-ndark-border`}>
        <div className="flex items-start gap-2">
          {/* R15 M4 — Yön ikonu YALNIZ fullscreen'de (inline'da liste satırının
              dili; yön bilgisi "ayrıntılar" içinde de mevcut). */}
          {mode === 'fullscreen' && (
            <span
              className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                isInbound
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
              }`}
              title={isInbound ? 'Gelen' : 'Giden'}
            >
              {isInbound ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {/* R6 → R11 → R13 → R14 — Konu mode-aware:
                  mode='inline' (sekme-içi dar bağlam) → T4Inline 15px medium
                  mode='fullscreen' (geniş bağlam)      → T4 17px medium
                Meta T2 (13px) muted, değişmez. İçerik başlığı TEK yer — fs
                bar başlığı 14px ile yarışmaz.
                R13 M2 — Vaka içi görüntüde [XXX-NNNN] token GİZLİ (liste ile
                aynı kural: stripCaseToken:true). Ham konu tooltip ve "ayrıntılar ▾"
                Konu satırında zaten var; fs barda ayrıca caseNumber badge.
                Composer subject GİZLEMEZ — outbound threading token'a bağlı. */}
            <h3
              className={`truncate ${mode === 'fullscreen' ? MAIL_TYPE.t4 : MAIL_TYPE.t4Inline} font-medium text-slate-900 dark:text-ndark-text`}
              title={email.subject}
            >
              {normalizeSubject(email.subject, { stripCaseToken: true }) || '(konusuz)'}
            </h3>
            <div className={`mt-0.5 flex flex-wrap items-baseline gap-x-2 ${MAIL_TYPE.t2} text-slate-500 dark:text-ndark-muted`}>
              {/* R9.1 — Gönderen adı ListPane ile AYNI util (tek kaynak).
                  Teknik email adresi "ayrıntılar ▾" içinde. */}
              <span className="font-medium">{computeSenderDisplay(email, currentUserId)}</span>
              <span>·</span>
              <span>{formatDateTime(timestamp)}</span>
            </div>
          </div>
          {/* 2026-07-04 PR-2 (görsel tur R2) — Aksiyon barı ÜST başlığa
              taşındı: Yanıtla · İlet · Genişlet/Küçült + X (fullscreen)
              + RUNA slot. Header shrink-0 flex row olduğu için uzun mail
              scroll'da SABIT görünür (sticky davranışı). Alt bar YALNIZ
              hızlı-yanıt (aşağıda). */}
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onReply(email)}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-brand-600 px-2.5 py-1.5 ${MAIL_TYPE.t2} font-medium text-white hover:bg-brand-700`}
              title="Yanıtla"
            >
              <Reply size={13} /> Yanıtla
            </button>
            <button
              type="button"
              onClick={() => onForward(email)}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-2.5 py-1.5 ${MAIL_TYPE.t2} font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 dark:text-ndark-text dark:ring-ndark-border dark:hover:bg-ndark-bg`}
              title="İlet"
            >
              <Forward size={13} /> İlet
            </button>
            {mode === 'inline' ? (
              <button
                type="button"
                onClick={onExpand}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-2.5 py-1.5 ${MAIL_TYPE.t2} font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 dark:text-ndark-text dark:ring-ndark-border dark:hover:bg-ndark-bg`}
                title="Genişlet"
              >
                <Maximize2 size={13} /> Genişlet
              </button>
            ) : (
              <button
                type="button"
                onClick={onCollapse}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-2.5 py-1.5 ${MAIL_TYPE.t2} font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 dark:text-ndark-text dark:ring-ndark-border dark:hover:bg-ndark-bg`}
                title="Küçült"
              >
                <Minimize2 size={13} /> Küçült
              </button>
            )}
            {/* RUNA yanıt önerileri slot'u — structural, boş */}
            <div data-runa-slot="reader-actions" className="ml-1 flex items-center gap-1" />
            {mode === 'fullscreen' && (
              <button
                type="button"
                onClick={onCollapse}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-ndark-muted dark:hover:bg-ndark-bg"
                aria-label="Kapat"
                title="Kapat (Esc)"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
        {/* ayrıntılar ▾ — CC/BCC/tam adresler */}
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className={`mt-1 inline-flex items-center gap-1 ${MAIL_TYPE.t2} text-slate-500 hover:text-slate-700 dark:text-ndark-muted`}
          aria-expanded={detailsOpen}
        >
          {detailsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          ayrıntılar
        </button>
        {detailsOpen && (
          <div className={`mt-1 space-y-0.5 rounded bg-slate-50 px-2 py-1.5 ${MAIL_TYPE.t2} text-slate-600 dark:bg-ndark-bg dark:text-ndark-muted`}>
            {/* R13 M2 — Konu ham hâli (token dahil). Üst başlık token'sız gösterir;
                buradan ve tooltip'ten ham hale ulaşılır. */}
            <div><span className="font-medium">Konu:</span> {email.subject || '(konusuz)'}</div>
            <div><span className="font-medium">Kime:</span> {joinAddresses(email.to) || '—'}</div>
            {email.cc.length > 0 && <div><span className="font-medium">Cc:</span> {joinAddresses(email.cc)}</div>}
            {email.bcc.length > 0 && <div><span className="font-medium">Bcc:</span> {joinAddresses(email.bcc)}</div>}
            <div><span className="font-medium">Kimden:</span> {email.from.name ? `${email.from.name} <${email.from.address}>` : email.from.address}</div>
          </div>
        )}
      </div>

      {/* Body — 2026-07-04 PR-2 R6 cilası: max-w-[760px] mx-auto padding.
          R15 M2 — mode='inline' iken doğal yükseklik (overflow-visible, sayfa
          akışı). Fullscreen'de flex-1 overflow-auto (kendi iç scroll'u). */}
      <div className={mode === 'fullscreen' ? 'flex-1 overflow-auto p-6' : 'p-4'}>
        <div className="mx-auto max-w-[760px]">
          {rewriting && (
            <div className="text-xs text-slate-400">Görseller çözülüyor…</div>
          )}
          {!rewriting && safeBody && (
            <div
              className="prose prose-sm max-w-none leading-relaxed dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: safeBody }}
            />
          )}
          {!rewriting && !safeBody && (
            <p className="text-sm text-slate-500 italic">(içerik yok)</p>
          )}

          {/* Ek chip'leri — HoverPreview + Lightbox.
              Evidence Preservation PR-3: GERÇEK EK ≠ GÖVDE-İÇİ GÖRSEL ayrımı.
              Gerçek ekler (dosya olarak gönderilenler) önde/belirgin; gövde
              içine gömülü görseller (imza logosu, yapıştırılan screenshot)
              ayrı soluk grupta — agent hangisinin "dosya eki" olduğunu
              karıştırmaz. İkisi de önizlenebilir (kanıt erişimi aynı). */}
          {email.attachments.length > 0 && (() => {
            // Adversarial review fix — "gövde-içi" = isInline && contentId.
            // Apple Mail gibi istemciler GERÇEK ekleri (PDF dahil) disposition:
            // inline gönderir → isInline=true ama cid'siz; bunlar gerçek ektir,
            // soluk gruba düşmemeli. cid'li olanlar gövdede gömülü görsellerdir.
            const isBodyInline = (a: (typeof email.attachments)[number]) =>
              a.isInline && !!a.contentId;
            const realAtts = email.attachments.filter((a) => !isBodyInline(a));
            const inlineAtts = email.attachments.filter(isBodyInline);
            const renderChip = (a: (typeof email.attachments)[number], faded: boolean) => {
              const isImage = (a.mimeType ?? '').toLowerCase().startsWith('image/');
              return (
                <HoverPreview<LightboxItem & { uploadedBy?: string | null; uploadedAt?: string | null }>
                  key={a.id}
                  item={{
                    id: a.id,
                    fileName: a.fileName,
                    fileSize: a.fileSize,
                    mimeType: a.mimeType,
                  }}
                  getPreviewUrl={getAttachmentPreviewUrlHover}
                >
                  <button
                    type="button"
                    onClick={() => openAttachment(a.id, isImage)}
                    className={`inline-flex min-h-[36px] items-center gap-1 rounded-full px-2 py-1 text-xs ${
                      faded
                        ? 'bg-slate-50 text-slate-500 hover:bg-slate-100 dark:bg-ndark-card dark:text-ndark-muted'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-ndark-bg dark:text-ndark-text'
                    }`}
                    title={isImage ? 'Önizle' : 'İndir'}
                  >
                    <Paperclip size={11} />
                    <span className="max-w-[220px] truncate">{a.fileName}</span>
                    <span className={`${MAIL_TYPE.t1} opacity-60`}>{formatBytes(a.fileSize)}</span>
                  </button>
                </HoverPreview>
              );
            };
            return (
              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-ndark-border">
                {realAtts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {realAtts.map((a) => renderChip(a, false))}
                  </div>
                )}
                {inlineAtts.length > 0 && (
                  <div className={`flex flex-wrap items-center gap-1.5 ${realAtts.length > 0 ? 'mt-2' : ''}`}>
                    <span className={`${MAIL_TYPE.t1} text-slate-400 dark:text-ndark-muted`}>
                      gövde içi görseller:
                    </span>
                    {inlineAtts.map((a) => renderChip(a, true))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* 2026-07-04 PR-2 R5 — Alt bölge parent kararı (bottomSlot).
          Inline composer açık: parent MailComposer node'u verir.
          Kapalı: parent hızlı-yanıt çubuğu verir (aynı bileşen, kapalı hali).
          bottomSlot yoksa alt bölge gizli. Yanıtla/İlet üst başlıkta (R2). */}
      {bottomSlot && (
        <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2 dark:border-ndark-border dark:bg-ndark-card">
          {bottomSlot}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* 2026-07-04 PR-2 (görsel tur R4) — Wrapper switch KALDIRILDI.
          Reader iç yapısı sabit; dış layout parent (CommunicationTab)
          yönetir. Sekme içi: reader inline mode (üst liste + reader alt).
          Fullscreen: reader mode='fullscreen' Gmail düzeni içinde
          (sol liste + reader sağda). Kod çatallaması yok — readerBody
          hâlâ TEK yerde tanımlı. */}
      <div className="flex h-full min-h-0 flex-col bg-white dark:bg-ndark-card">
        {readerBody}
      </div>

      {/* Lightbox — mode'dan bağımsız (üstünde katman) */}
      <Lightbox<LightboxItem>
        open={lightboxActiveId != null}
        onClose={() => setLightboxActiveId(null)}
        items={previewableAttachments}
        activeId={lightboxActiveId ?? ''}
        onNavigate={setLightboxActiveId}
        getPreviewUrl={getAttachmentPreviewUrl}
        onDownload={(a) => void downloadAttachment(a.id)}
      />
    </>
  );
}
