/**
 * Mail M6.2b — MailComposer (UI shell).
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 9 + Bölüm 6.
 *
 * Bu bileşen ARAYÜZ + WIRING:
 *  - From dropdown: caseEmailService.getFromAliases (1 alias → gizli + default)
 *  - To/Cc/Bcc: ContactPicker (öneri kaynağı parent'tan)
 *  - Reply prefill: caseEmailService.getReplyContext (parent çağırır,
 *    initialDraft olarak prop)
 *  - Editor: RichTextEditor (TipTap) — sanitize-html allowlist
 *    uyumlu çıktı + DOMPurify (M6.1 deseni) render path'i için
 *  - Ek: caseService.addFile reuse → attachmentId
 *  - Gönder: caseEmailService.sendEmail (POST /:id/emails)
 *
 * GUARD PARİTESİ (kullanıcı talebi):
 *  - Backend 3-katman gate (M6.2a + Codex P1 fix): scope + security-filter
 *    + resource-policy. UI yalın hata mesajları gösterir (apiFetch toast).
 *  - Gönder butonu: pending-state'lerde disabled (busy/from yok/recipient
 *    yok); çift-gönderim önlenir (busy ref).
 *
 * KENAR DURUMLAR:
 *  - reply-context boş → composer manuel mod (To boş, subject boş)
 *  - From tek alias → dropdown YOK + default seçili
 *  - Cc/Bcc → varsayılan gizli (toggle ile aç)
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { MAIL_TYPE } from '../lib/mailTypography';
import DOMPurify from 'dompurify';
import { Paperclip, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { caseService } from '@/services/caseService';
import {
  caseEmailService,
  type FromAliasOption,
  type ReplyContext,
} from '@/services/caseEmailService';
import { ContactPicker } from './ContactPicker';
import { RichTextEditor, type PasteImageResult } from './RichTextEditor';
import { normalizeSubject } from '@/lib/subjectNormalizer';
import type { Case, CaseFile } from '../types';

// Ctrl+V inline görsel için sıkı kısıt (composer-özgü):
//  - Yalnız raster image mime (SVG hariç — XSS riski, mail istemcileri de
//    çoğunlukla göstermez)
//  - Boyut: 10MB (mail istemcisi tarafında büyük gövde riskini azaltır;
//    mevcut ek limitiyle uyumlu, backend zaten 25MB raw body sınırı uygular)
const INLINE_PASTE_ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
]);
const INLINE_PASTE_MAX_SIZE = 10 * 1024 * 1024;

export interface MailComposerProps {
  item: Case;
  /** "Yanıtla" tıklanmışsa reply-context'ten doldurulur; yoksa boş. */
  initialReplyContext?: ReplyContext | null;
  /**
   * M6.3-realign — "İlet" akışı için forward prefill. Verildiyse:
   *  - subject = "Fwd: ..."
   *  - alıcılar boş (agent manuel ekler)
   *  - quotedBodyHtml gövde sonuna alıntı olarak eklenir
   */
  initialForwardContext?: {
    caseNumber: string | null;
    subject: string;
    quotedBodyHtml: string;
  } | null;
  /**
   * @deprecated M6.3b Faz 2 — Yerine initialTenantSignatureHtml +
   *   initialAgentSignatureHtml. Geri uyumluluk için kalır;
   *   verilirse tenant olarak yorumlanır (agent null).
   */
  initialSignatureHtml?: string | null;
  /**
   * @deprecated Compose-Signature F3 — Yerine initialComposedSignatureHtml.
   * Eski caller'lar tenant ham şablonu geçirebiliyordu; composer artık
   * "kompoze edilmiş" effective imzayı kullanır. Verilirse composedHtml'in
   * fallback'i olarak yorumlanır (geri uyum).
   */
  initialTenantSignatureHtml?: string | null;
  /** M6.3b Faz 2 — Per-agent override imza (User.signatureHtml). */
  initialAgentSignatureHtml?: string | null;
  /**
   * Compose-Signature F3 — Tenant şablonunun Person bilgileriyle render
   * edilmiş hali (composedHtml). agentHtml override yoksa composer
   * "İmzam" varsayılan olarak bunu kullanır.
   */
  initialComposedSignatureHtml?: string | null;
  /** Composer'dan inbound/outbound CaseEmail oluşunca thread refresh. */
  onSent?: () => void;
  /** Vazgeç butonu. */
  onCancel?: () => void;
  /**
   * 2026-07-04 PR-2 R5+R7 — Layout modu:
   *  - 'overlay' (default) → fullscreen mail yazma alanı (Yeni e-posta,
   *    İlet, inline'dan Büyüt). MailComposer'ın kendi CSS wrapper'ı
   *    yerine parent'ın verdiği alan; ancak buton alt satırı sabit.
   *  - 'inline' → Reader body altında kompakt satır-içi Yanıtla
   *    (Gmail paritesi). Kompakt üst özet + Ayrıntılar toggle + editör +
   *    Gönder/Vazgeç/Ek/Büyüt.
   * TEK bileşen kuralı: mod prop'u DEĞİŞTİĞİNDE state korunur
   * (component instance aynı); "Büyüt" tıklamada taslak otomatik taşınır.
   */
  layoutMode?: 'overlay' | 'inline';
  /** Inline'dan overlay'a taşı ("Büyüt" ikonu). layoutMode='inline' için. */
  onGrow?: () => void;
  /**
   * R10.1 — Dock görünüm varyantı (fs+inline). true iken:
   *  - Header (E-Postayı Yanıtla) + Müşteri/Kimden/Konu alanları ayrıntılara alınır
   *  - Üstte tek satır özet: "Yanıtla → [Kime chip'leri] · ayrıntılar ▾"
   *  - Editor mount'ta autofocus
   *  - Kimden alias tanımsız uyarısı özet satırında kompakt kalır (gönderim engelini gizleme)
   * Aynı MailComposer instance — sadece görünüm varyantı.
   */
  compactDock?: boolean;
  /**
   * R10.1 — ESC ile composer'dan çıkış zinciri. Parent (CommunicationTab)
   * ESC yakalar → ref.current?.() çağırır → composer içi:
   *   - onay modalı açıksa modalı kapatır (ikinci ESC = vazgeç)
   *   - DIRTY ise onay modalı açar
   *   - temizse doğrudan onCancel çağırır
   * Parent kontrol için imperative ref alır. Verilmezse composer eskisi
   * gibi Vazgeç butonu + onCancel'a bağlı kalır.
   */
  cancelRequestRef?: MutableRefObject<(() => void) | null>;
}

interface UploadedFileRef {
  id: string;
  fileName: string;
  fileSize: number;
  // Ctrl+V ile eklenmiş inline görsel — editörde blob URL src ile render
  // edilir (browser cid:'yi göstermez). Send öncesi bodyHtml içindeki blobUrl
  // → cid:{id} REPLACE edilir. Kullanıcı editörden görseli silerse blobUrl
  // artık bodyHtml'de yok → inline attachment listeden düşer.
  inline?: boolean;
  blobUrl?: string;
}

type ContactPickerValue = { address: string; name: string | null };

export function MailComposer({
  item,
  initialReplyContext = null,
  initialForwardContext = null,
  initialSignatureHtml = null,
  initialTenantSignatureHtml = null,
  initialAgentSignatureHtml = null,
  initialComposedSignatureHtml = null,
  onSent,
  onCancel,
  layoutMode = 'overlay',
  onGrow,
  compactDock = false,
  cancelRequestRef,
}: MailComposerProps) {
  const { toast } = useToast();
  // R7 (2026-07-04) — Advanced toggle: Cc/Bcc/İmza/Şablon kompakt gizli
  // (kullanıcı direktifi tutarlılık — inline & overlay AYNI desen).
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [aliases, setAliases] = useState<FromAliasOption[]>([]);
  const [fromId, setFromId] = useState<string>('');
  const [to, setTo] = useState<ContactPickerValue[]>(initialReplyContext?.to ?? []);
  const [cc, setCc] = useState<ContactPickerValue[]>(initialReplyContext?.cc ?? []);
  const [bcc, setBcc] = useState<ContactPickerValue[]>(initialReplyContext?.bcc ?? []);
  // Yanıt VEYA ilet alıntısı — composer örneği ikisinden yalnız biridir.
  // Baseline body'nin sonuna eklenir ve imza-swap'larında korunur (Option A:
  // standart nested quoting; parent gövde zinciri kendiliğinden taşır).
  const activeQuotedHtml =
    initialForwardContext?.quotedBodyHtml ?? initialReplyContext?.quotedBodyHtml ?? '';
  // M6.3-realign — Cc/Bcc her zaman görünür (n4b spec). Setter
  // gerekmiyor; sadece downstream handleSubmit kullanımına string
  // kalsın diye sabit readonly.
  const showCc = true;
  const showBcc = true;
  // Önizleme modu
  const [previewing, setPreviewing] = useState(false);
  // Compose-Signature F3 — Kompoze imza fallback chain:
  //   effectiveHtml = override (agentHtml) ?? composed (companyTemplate +
  //     Person.name + Person.title) ?? legacy tenantHtml ?? none
  //
  // Composer dropdown sadeleşti: "İmzam" = effective; "İmzasız" = none.
  // Eski "tenant raw" seçeneği KALDIRILDI — composed zaten şirket
  // bloğunu içerir; admin kontrolü dışında ikinci bir "ham tenant"
  // göstermek kafa karıştırıcıydı.
  //
  // Geri uyumluluk: eski caller initialSignatureHtml veya
  // initialTenantSignatureHtml verirse composed yoksa fallback olarak
  // kullanılır (legacy behavior).
  const agentHtml = initialAgentSignatureHtml ?? null;
  const composedHtml = initialComposedSignatureHtml
    ?? initialTenantSignatureHtml
    ?? initialSignatureHtml
    ?? null;
  // Effective: composer "İmzam" seçeneğine eklediğimiz HTML.
  const effectiveSignatureHtml = agentHtml ?? composedHtml;

  // İmza dropdown — n4b S2/S5/S6 endüstri parite. 2 opsiyon:
  //   'mine' = effectiveSignatureHtml (override ?? composed)
  //   'none' = yok
  const initialSignatureChoice: 'mine' | 'none' = effectiveSignatureHtml ? 'mine' : 'none';
  const [signatureSelection, setSignatureSelection] = useState<'mine' | 'none'>(
    initialSignatureChoice,
  );
  // Seçimden HTML'e map — initial + dropdown değişimi için.
  const resolveSignatureHtml = (sel: 'mine' | 'none'): string | null => {
    if (sel === 'mine') return effectiveSignatureHtml;
    return null;
  };
  // initial baseline body için seçili imzanın HTML'i.
  const initialSelectedSignatureHtml = resolveSignatureHtml(initialSignatureChoice);
  // Codex P2 fix — body'de o an "etkin" imzayı takip et. Dropdown değişiminde
  // body'deki ESKİ imzayı yeni seçimle SWAP edebilelim diye ref'te tut.
  const currentSignatureHtmlRef = useRef<string | null>(initialSelectedSignatureHtml);
  // 2026-07-04 PR-2 — Reply/forward açılışında subject normalize (yığın
  // "RE: Re: [EXTERNAL] RE: RE:" gürültüsü tek RE:'ye iner; [UNV-x]
  // token korunur — backend applyCaseTokenToSubject de idempotent).
  // Header threading (In-Reply-To/References) subject'ten bağımsız →
  // dış istemci threading'i etkilenmez. Kullanıcı manuel editleyebilir
  // (state ilk mount initializer'da; sonraki edit'ler ham).
  const [subject, setSubject] = useState<string>(() => {
    const raw = initialReplyContext?.subject ?? initialForwardContext?.subject ?? '';
    if (!raw) return '';
    const clean = normalizeSubject(raw);
    if (!clean) return raw;
    if (initialReplyContext) return clean.startsWith('RE:') ? clean : `RE: ${clean}`;
    if (initialForwardContext) return clean.startsWith('Fwd:') ? clean : `Fwd: ${clean}`;
    return clean;
  });
  // Composer açıldıktan SONRA gelen imza için (slow network):
  // useState initializer prop güncellenince yeniden çağrılmaz; o yüzden
  // baseline body'yi ref'te tutarız ve effect ile imza bir kez append edilir.
  // Kullanıcı yazmaya başladıysa (body baseline'dan değiştiyse) ASLA
  // dokunmayız — composer içeriğini ezmemek için.
  // Codex review fix (M6.2b): late-arriving signature.
  // M6.3-realign — forward bağlamı baseline body'sinin sonuna alıntı
  // ekler. İmza varsa imzanın altında olur (alıntı doğal sırayla
  // gözüksün diye sırayla append). Forward+imza birlikte olduğunda da
  // doğru çalışır.
  const initialBaselineBodyRef = useRef<string>(
    (() => {
      let html = '<p></p>';
      if (initialSelectedSignatureHtml) html += initialSelectedSignatureHtml;
      if (activeQuotedHtml) html += activeQuotedHtml;
      return html;
    })(),
  );
  const [bodyHtml, setBodyHtml] = useState<string>(initialBaselineBodyRef.current);
  const signatureAppendedRef = useRef<boolean>(!!initialSelectedSignatureHtml);

  useEffect(() => {
    if (signatureAppendedRef.current) return;
    if (!initialSelectedSignatureHtml) return;
    setBodyHtml((cur) => {
      // Body hala baseline durumunda mı? → append güvenli.
      if (cur === initialBaselineBodyRef.current) {
        // Codex P2 fix — yanıt/ilet alıntısı (activeQuotedHtml) KORUNMALI.
        const next = `<p></p>${initialSelectedSignatureHtml}${activeQuotedHtml}`;
        initialBaselineBodyRef.current = next;
        signatureAppendedRef.current = true;
        // Codex P2 fix — late-loaded signature tracking:
        //   (a) currentSignatureHtmlRef body'ye eklenen yeni imzayla
        //       güncellenmeli. Aksi halde dropdown swap effect oldSig=null
        //       sanar → strip yapmaz → ikinci imza ekler → "İmzasız"
        //       seçimi de orijinal imzayı silemez.
        //   (b) signatureSelection state'i body ile senkron olmalı.
        //       İlk render'da prop'lar null'du → 'none' state. Async
        //       fetch sonrası body'ye imza eklendi → dropdown da
        //       fallback chain'e ('agent' veya 'tenant') güncellensin
        //       ki agent dropdown'da 'İmzasız' görürken body'de imza
        //       olmasın (yanıltıcı UI).
        currentSignatureHtmlRef.current = initialSelectedSignatureHtml;
        setSignatureSelection(initialSignatureChoice);
        return next;
      }
      // Kullanıcı yazmaya başlamış — dokunma. currentSignatureHtmlRef
      // null kalır (body'ye imza koyamadık); sonraki swap effect'te
      // oldSig=null → strip yok, sadece newSig inject (tek imza).
      signatureAppendedRef.current = true;
      return cur;
    });
  }, [initialSelectedSignatureHtml, initialSignatureChoice, activeQuotedHtml]);

  // Codex P2 fix — Dropdown değişimi: body'deki ESKİ imzayı yeni seçimle
  // SWAP et. Aksi halde agent "İmzasız" seçse bile başlangıç imzası
  // gönderilirdi (select sadece UI state'iydi).
  //
  // Strateji: body bir önceki etkin imza ile bitiyorsa (forward case'inde
  // imzanın altına quoted eklenir; bu durumda quoted'tan ÖNCEKİ kısımda
  // imza var) — basitlik için kontrol body'nin "<p></p>${oldSig}" prefix'i
  // veya endsWith(oldSig) durumunu sırayla dener. Bulamazsa (agent body'yi
  // yoğun değiştirdiyse) silent skip — agent isterse manuel düzenler.
  useEffect(() => {
    const oldSig = currentSignatureHtmlRef.current;
    const newSig = resolveSignatureHtml(signatureSelection);
    if (oldSig === newSig) return; // ilk render veya aynı seçim
    setBodyHtml((cur) => {
      let next = cur;
      let newSigInsertHandled = false;
      if (oldSig) {
        // 1) Sonu imzayla bitiyor mu? (forward + quoted YOK durumu)
        if (next.endsWith(oldSig)) {
          next = next.slice(0, -oldSig.length);
        } else {
          // 2) `<p></p>${oldSig}${rest}` paterni (forward + quoted VAR)
          const prefix = `<p></p>${oldSig}`;
          if (next.startsWith(prefix)) {
            next = '<p></p>' + next.slice(prefix.length);
          } else if (next.includes(oldSig)) {
            // 3) Codex P2 fix — Template insert sonrası imza ortada
            //    kalabiliyor (insertTemplateBody template'i imzanın
            //    ÖNCESİNE ekler):
            //      `<p></p>TEMPLATEoldSig` veya
            //      `<p></p>TEMPLATEoldSigQUOTED`
            //    İmzanın ilk occurrence'ını strip + aynı pozisyona yeni
            //    imzayı koy. Quote'a dokunmadan.
            const i = next.indexOf(oldSig);
            const before = next.slice(0, i);
            const after = next.slice(i + oldSig.length);
            next = before + (newSig ?? '') + after;
            newSigInsertHandled = true;
          } else {
            // Agent body'yi çok değiştirdi — silent skip.
            currentSignatureHtmlRef.current = newSig;
            return cur;
          }
        }
      }
      if (newSig && !newSigInsertHandled) {
        // yanıt/ilet alıntısı varsa quoted body'nin BAŞINA imza enjekte et.
        const quoted = activeQuotedHtml;
        if (quoted && next.endsWith(quoted)) {
          next = next.slice(0, -quoted.length) + newSig + quoted;
        } else {
          next = next + newSig;
        }
      }
      currentSignatureHtmlRef.current = newSig;
      return next;
    });
  }, [signatureSelection, agentHtml, composedHtml, activeQuotedHtml]);
  const [attachments, setAttachments] = useState<UploadedFileRef[]>([]);
  const [uploading, setUploading] = useState(false);

  // R10.1 — ESC ile Vazgeç zinciri: dirty baseline + confirm modal.
  const initialToRef = useRef<ContactPickerValue[]>(initialReplyContext?.to ?? []);
  const initialCcRef = useRef<ContactPickerValue[]>(initialReplyContext?.cc ?? []);
  const initialBccRef = useRef<ContactPickerValue[]>(initialReplyContext?.bcc ?? []);
  const initialSubjectRef = useRef<string>(subject);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const isDirty = useMemo(() => {
    if (bodyHtml !== initialBaselineBodyRef.current) return true;
    if (attachments.length > 0) return true;
    if (subject !== initialSubjectRef.current) return true;
    const eqList = (a: ContactPickerValue[], b: ContactPickerValue[]) =>
      a.length === b.length && a.every((x, i) => x.address === b[i]?.address);
    if (!eqList(to, initialToRef.current)) return true;
    if (!eqList(cc, initialCcRef.current)) return true;
    if (!eqList(bcc, initialBccRef.current)) return true;
    return false;
  }, [bodyHtml, attachments, subject, to, cc, bcc]);

  const requestCancel = useCallback(() => {
    // 3-durum:
    //   (a) confirm modalı zaten açık → modal kapan (ikinci ESC = vazgeç)
    //   (b) dirty → modal aç
    //   (c) temiz → doğrudan onCancel
    if (showCancelConfirm) { setShowCancelConfirm(false); return; }
    if (isDirty) { setShowCancelConfirm(true); return; }
    onCancel?.();
  }, [showCancelConfirm, isDirty, onCancel]);

  useEffect(() => {
    if (!cancelRequestRef) return;
    cancelRequestRef.current = requestCancel;
    return () => { if (cancelRequestRef) cancelRequestRef.current = null; };
  }, [cancelRequestRef, requestCancel]);

  // Codex P2 R1 fix: çoklu paste'te uploading boolean tek bit — ilk upload
  // bitince false'a düşer, diğerleri hâlâ pending. Sayaç ile pendingPastes
  // === 0 olana kadar canSend disable.
  const [pendingPastes, setPendingPastes] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Blob URL cleanup — component unmount'ta tüm inline blob URL'leri revoke
  // et (memory leak guard). Send başarılı olunca onSent callback composer'ı
  // kapatır → unmount → cleanup.
  const attachmentsRef = useRef<UploadedFileRef[]>([]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => () => {
    for (const a of attachmentsRef.current) {
      if (a.blobUrl) URL.revokeObjectURL(a.blobUrl);
    }
  }, []);

  // Suggestions kaynağı — şimdilik vakanın customerContact alanları.
  // Genişletilmiş account contacts öneri listesi M6.3'te.
  const suggestions = useMemo(() => {
    const out: { email: string; name: string | null }[] = [];
    if (item.customerContactEmail) {
      out.push({
        email: item.customerContactEmail,
        name: item.customerContactName ?? null,
      });
    }
    return out;
  }, [item]);

  // From alias'ları yükle
  useEffect(() => {
    let alive = true;
    void caseEmailService.getFromAliases(item.id).then((items) => {
      if (!alive) return;
      setAliases(items);
      // From varsayılanı (2026-07-08) — Multi-inbox: mail hangi paylaşımlı
      // kutuya geldiyse cevap o kutudan çıksın. reply-context'in önerdiği
      // adrese eşleşen alias öncelikli; yoksa tenant default; o da yoksa ilk.
      const suggested = initialReplyContext?.suggestedFromAddress?.trim().toLowerCase();
      const byInbox = suggested
        ? items.find((a) => a.address.trim().toLowerCase() === suggested)
        : null;
      const def = byInbox ?? items.find((a) => a.isDefault) ?? items[0] ?? null;
      if (def) setFromId(def.id);
    });
    return () => { alive = false; };
  }, [item.id, initialReplyContext]);

  // M6.3b Faz 3 — Mail Şablonu dropdown beslemesi.
  const [templates, setTemplates] = useState<import('@/services/caseEmailService').CaseEmailTemplateItem[]>([]);
  const [templateBusy, setTemplateBusy] = useState(false);
  // Subject replace + missing placeholder confirm modal state
  // Codex P2 fix — missing.length > 0 ise agent uyarısı + onay
  const [pendingTemplate, setPendingTemplate] = useState<{
    id: string;
    subject: string | null;
    bodyHtml: string;
    missing: string[];
    needsSubjectChoice: boolean;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void caseEmailService.listEmailTemplates(item.id).then((items) => {
      if (alive) setTemplates(items);
    });
    return () => { alive = false; };
  }, [item.id]);

  // Template seçimi: render + insert.
  // Codex P2 fix — missing placeholder VAR ise agent'a uyarı modalı.
  // Subject mevcut + farklı VAR ise replace confirm.
  // İki kondisyon birleşik modal'da gösterilir.
  async function applyTemplate(templateId: string) {
    if (!templateId) return;
    setTemplateBusy(true);
    try {
      const rendered = await caseEmailService.renderEmailTemplate(item.id, templateId);
      if (!rendered) return; // apiFetch toast attı; silent skip
      const hasSubject = typeof rendered.subject === 'string' && rendered.subject.trim();
      const hasMissing = (rendered.missing?.length ?? 0) > 0;
      const needsSubjectChoice = !!hasSubject && !!subject && subject !== rendered.subject;
      if (needsSubjectChoice || hasMissing) {
        // Modal: subject onay VE/VEYA missing uyarısı.
        setPendingTemplate({
          id: templateId,
          subject: rendered.subject,
          bodyHtml: rendered.bodyHtml,
          missing: rendered.missing ?? [],
          needsSubjectChoice,
        });
        return;
      }
      // Doğrudan uygula.
      if (hasSubject) setSubject(rendered.subject!);
      insertTemplateBody(rendered.bodyHtml);
    } finally {
      setTemplateBusy(false);
    }
  }

  // Codex P2 fix — Template insert pozisyonu.
  //
  // Eskiden `cur + rendered.bodyHtml` ile en sona ekleniyordu. Composer
  // baseline body'sinin formu:
  //   `<p></p>${signatureHtml}${quotedBodyHtml}`
  // İmza ve/veya forward quote VAR iken sona eklemek:
  //   `<p></p>` + imza + quote + TEMPLATE ← yanlış sıra; agent mailin
  //   sonunda template, üstünde imza ve forward quote görür.
  //
  // Doğru sıralama (n4b parite / Gmail):
  //   TEMPLATE → İMZA → QUOTE
  //
  // Strateji: cur içinde signature ve/veya quote izini ara, onların
  // ÖNCESİNE inject et. Hiçbiri yoksa (kullanıcı tüm baseline'ı silmişse)
  // sona append.
  function insertTemplateBody(bodyHtml: string) {
    setBodyHtml((cur) => {
      const sig = currentSignatureHtmlRef.current ?? '';
      const quoted = activeQuotedHtml;
      // 1. Önce signature varsa onun başlangıcını bul
      if (sig && cur.includes(sig)) {
        const i = cur.indexOf(sig);
        return cur.slice(0, i) + bodyHtml + cur.slice(i);
      }
      // 2. Signature yoksa ama forward quote varsa onun başlangıcını bul
      if (quoted && cur.endsWith(quoted)) {
        return cur.slice(0, cur.length - quoted.length) + bodyHtml + quoted;
      }
      // 3. Hiçbiri yok → sona append (kullanıcı baseline'ı silmiş; v1)
      return cur + bodyHtml;
    });
  }

  function confirmTemplate(replaceSubject: boolean) {
    if (!pendingTemplate) return;
    if (replaceSubject && pendingTemplate.subject) {
      setSubject(pendingTemplate.subject);
    }
    insertTemplateBody(pendingTemplate.bodyHtml);
    setPendingTemplate(null);
  }

  const selectedAlias = aliases.find((a) => a.id === fromId) ?? null;
  // Codex fix — From dropdown HER ZAMAN görünür (n4b paritesi). "Tek
  // alias ise gizle" mantığı KALDIRILDI; agent gönderen adresini her
  // zaman görsün.
  const noAliasesConfigured = aliases.length === 0;

  async function handleAttach(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const r = await caseService.addFile(item.id, f);
        if (!r) continue;
        if ('error' in r) {
          toast({ type: 'error', message: r.error });
          continue;
        }
        const caseFile: CaseFile = r.file;
        setAttachments((cur) => [...cur, {
          id: caseFile.id,
          fileName: caseFile.fileName,
          fileSize: caseFile.fileSize,
        }]);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removeAttachment(id: string) {
    setAttachments((cur) => cur.filter((a) => a.id !== id));
  }

  // Ctrl+V ile görsel yapıştırma: RichTextEditor'dan çağrılır.
  // Guard'lar SUNUCUDA da doğrulanır — bu FE kısıtları UX için
  // (backend uploadWhitelist.js kesin karar verir).
  //
  // Codex P2 R1: pendingPastes sayacı — çoklu görsel yapıştırma sırasında
  // her upload kendi +1/-1'ini yapar. canSend hepsi bitene kadar disable.
  // "İlk upload bitince Send açılır → diğerleri pending → gönderilmez"
  // hatasını önler.
  const handlePasteImage = useCallback(async (file: File, blobUrl: string): Promise<PasteImageResult> => {
    if (!INLINE_PASTE_ALLOWED_MIME.has(file.type)) {
      const msg = 'Yalnız PNG/JPG/GIF/WebP görselleri gövde içine yapıştırılabilir.';
      toast({ type: 'warn', message: msg });
      return { ok: false, error: msg };
    }
    if (file.size > INLINE_PASTE_MAX_SIZE) {
      const msg = `Görsel boyutu ${Math.round(INLINE_PASTE_MAX_SIZE / (1024 * 1024))}MB sınırını aşıyor.`;
      toast({ type: 'warn', message: msg });
      return { ok: false, error: msg };
    }
    setPendingPastes((n) => n + 1);
    try {
      const r = await caseService.addFile(item.id, file);
      if (!r) return { ok: false, error: 'upload_failed' };
      if ('error' in r) {
        toast({ type: 'error', message: r.error });
        return { ok: false, error: r.error };
      }
      const caseFile: CaseFile = r.file;
      setAttachments((cur) => [...cur, {
        id: caseFile.id,
        fileName: caseFile.fileName,
        fileSize: caseFile.fileSize,
        inline: true,
        blobUrl,
      }]);
      return { ok: true, cid: caseFile.id };
    } finally {
      setPendingPastes((n) => n - 1);
    }
  }, [item.id, toast]);

  // Codex P2 R1 fix: pendingPastes === 0 kontrolü — çoklu görsel paste'te
  // hepsi tamamlanmadan Send tetiklenemez (aksi halde henüz upload olmamış
  // görsel gönderilmez, mail'de sadece blob URL kalır → müşteride broken img).
  const canSend = !!selectedAlias && to.length > 0 && !submitting && !uploading && pendingPastes === 0;

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) return;
    if (!selectedAlias) {
      toast({ type: 'warn', message: 'Gönderen adresi seçilmedi.' });
      return;
    }
    if (to.length === 0) {
      toast({ type: 'warn', message: 'En az bir alıcı gerekir.' });
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      // Codex P2 R1 fix: bodyHtml içindeki blob URL'leri cid:{id} ile REPLACE
      // et (editörde blob URL renderable src'ti; mail için standart cid:).
      // Editörden silinmiş görselin blobUrl'i bodyHtml'de olmaz → inline
      // attachment listeden düşer ("silinen görsel gönderime girmez" dikişi).
      let payloadHtml = bodyHtml;
      const activeInlineIds = new Set<string>();
      for (const a of attachments) {
        if (a.inline && a.blobUrl && payloadHtml.includes(a.blobUrl)) {
          payloadHtml = payloadHtml.split(a.blobUrl).join(`cid:${a.id}`);
          activeInlineIds.add(a.id);
        }
      }
      // DOMPurify ile final pass (defense-in-depth; backend de sanitize eder)
      // Sanitize AFTER replace — cid: allowed default'ta, blob: değil.
      const safeBody = DOMPurify.sanitize(payloadHtml, { USE_PROFILES: { html: true } });

      const attachmentIds = attachments
        .filter((a) => (a.inline ? activeInlineIds.has(a.id) : true))
        .map((a) => a.id);

      const r = await caseEmailService.sendEmail(item.id, {
        fromAddress: selectedAlias.address,
        to,
        cc: showCc ? cc : [],
        bcc: showBcc ? bcc : [],
        subject,
        bodyHtml: safeBody,
        attachments: attachmentIds,
        // Codex P2 fix — satır içi Yanıtla'da composer'a reply-context'in
        // inReplyTo'su geldi; threading o satıra göre kurulsun.
        // Forward/Yeni mail durumunda null (eski davranış — backend son inbound).
        inReplyTo: initialReplyContext?.inReplyTo ?? null,
      });
      if (r?.ok) {
        toast({ type: 'success', title: 'Mail gönderildi', message: r.previewUrl ? 'Önizleme URL\'i log\'da.' : '' });
        onSent?.();
      }
      // r === undefined ise apiFetch zaten toast attı (403/policy/scope vs.)
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [attachments, bcc, bodyHtml, cc, item.id, onSent, selectedAlias, showBcc, showCc, subject, to, toast]);

  // Önizleme: DOMPurify ile sanitize edilmiş bodyHtml.
  // Codex P2 R1 — ALLOWED_URI_REGEXP: composer'da inline paste görselleri
  // blob URL src ile render edilir (editör'de renderable). Preview sanitize'ı
  // default'ta blob: strip eder → kullanıcı önizlemede broken image görürdü.
  //
  // Codex P2 R2 (2026-07-03) — `data:` KALDIRILDI.
  // Neden: DOMPurify ALLOWED_URI_REGEXP TÜM URI-taşıyan attribute'lara
  // uygulanır (href dahil). Yapıştırılan HTML'de <a href="data:text/html,
  // <script>..."> kalır ve dangerouslySetInnerHTML ile preview'a girer →
  // XSS potansiyeli. İmzalar http(s)/cid kullanıyor, inline paste blob:
  // yeterli; data: pratik ihtiyaç yok.
  // Whitelist: http/https + blob (paste preview) + cid (backend sonrası) + mailto/tel.
  const previewHtml = useMemo(() => {
    return DOMPurify.sanitize(bodyHtml, {
      USE_PROFILES: { html: true },
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'width', 'height', 'style', 'class'],
      FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed', 'link', 'meta', 'style'],
      ALLOWED_URI_REGEXP: /^(?:https?|blob|cid|mailto|tel):/i,
    });
  }, [bodyHtml]);

  const mode = initialForwardContext
    ? 'forward'
    : initialReplyContext
      ? 'reply'
      : 'new';
  const title = mode === 'reply'
    ? 'E-Postayı Yanıtla'
    : mode === 'forward'
      ? 'E-Postayı İlet'
      : 'Yeni E-posta';

  const summaryVerb = mode === 'reply' ? 'Yanıtla →' : mode === 'forward' ? 'İlet →' : 'Yeni mail →';
  const closeAndCancel = () => { setShowCancelConfirm(false); onCancel?.(); };

  return (
    // M6.3-realign — TAM EKRAN composer. Parent (CommunicationTab)
    // composer açıkken thread'i gizler; bu container thread alanını
    // doldurur.
    // R10.1 — relative: iç confirm modalı absolute inset-0 ile bunun içinde açılır.
    <div className="relative rounded-lg border border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
      {/* Header — compactDock modunda gizli (fs bar zaten context taşır) */}
      {!compactDock && (
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-ndark-border">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">{title}</h3>
          {item.caseNumber && (
            <span className={`${MAIL_TYPE.t1} text-slate-500 dark:text-ndark-muted`}>
              [{item.caseNumber}]
            </span>
          )}
        </div>
      )}

      <div className="space-y-3 p-3">
        {/* R10.1 — Dock kompakt özet satırı: verb + Kime chip'ler + ayrıntılar
            toggle. Kime düzenlenmek istenirse Ayrıntılar açılır. */}
        {compactDock && (
          <div className={`flex items-center gap-2 ${MAIL_TYPE.t2}`}>
            <span className="shrink-0 font-medium text-slate-500 dark:text-ndark-muted">{summaryVerb}</span>
            <div className="min-w-0 flex-1 truncate">
              {to.length === 0 ? (
                <span className="italic text-slate-400 dark:text-ndark-muted">(alıcı yok — Ayrıntılar'dan ekleyin)</span>
              ) : (
                to.map((r, i) => (
                  <span
                    key={`${r.address}-${i}`}
                    className={`mr-1 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 ${MAIL_TYPE.t2} text-slate-700 dark:bg-ndark-bg dark:text-ndark-text`}
                    title={r.address}
                  >
                    {r.name || r.address}
                  </span>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className={`shrink-0 inline-flex items-center gap-1 ${MAIL_TYPE.t2} text-slate-500 hover:text-slate-700 dark:text-ndark-muted`}
              aria-expanded={showAdvanced}
              title="Müşteri / Kimden / Kime / Cc / Bcc / Konu / İmza / Şablon"
            >
              <span>{showAdvanced ? '▾' : '▸'}</span>
              ayrıntılar
            </button>
          </div>
        )}
        {/* R10.1 — Alias tanımsız uyarısı kompakt özette de görünür kalır
            (gönderim engelini gizleme). Kısa versiyon: bar/link/mesaj tek satır. */}
        {compactDock && noAliasesConfigured && (
          <div
            className={`rounded-md border border-amber-300 bg-amber-50 px-2 py-1 ${MAIL_TYPE.t1} text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200`}
            role="alert"
          >
            <b>Kimden tanımsız:</b> "{item.companyName}" için gönderen adresi yok
            (Ayrıntılar → Kimden altında yönlendirme).
          </div>
        )}

        {/* Müşteri — compactDock'ta yalnız Ayrıntılar altında */}
        {(!compactDock || showAdvanced) && (
        <Field label="Müşteri">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text">
            {item.accountName || item.customerCompanyName || item.customerContactName || item.customerContactEmail || '—'}
          </div>
        </Field>
        )}

        {/* From — Codex fix: HER ZAMAN görünür (n4b paritesi). Boş ise net
            uyarı + Send pasif. R10.1 — compactDock'ta Ayrıntılar altında. */}
        {(!compactDock || showAdvanced) && (
        <Field label="Kimden">
          {noAliasesConfigured ? (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
              role="alert"
            >
              <p className="font-medium">
                "{item.companyName}" için gönderen e-posta adresi tanımlı değil.
              </p>
              <p className="mt-1 text-xs">
                Admin → Yönetim Paneli → <b>Mail Entegrasyonu</b> →
                ilgili şirket → <b>From Alias</b> bölümünden bir gönderen
                adresi ekleyin (SMTP/IMAP credentials ayrı; "From Alias" listesi
                composer'ı besler).
              </p>
            </div>
          ) : (
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text"
            >
              {aliases.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName ? `${a.displayName} <${a.address}>` : a.address}
                  {a.isDefault ? ' (varsayılan)' : ''}
                </option>
              ))}
            </select>
          )}
        </Field>
        )}

        {/* Kime — kompakt dock DIŞINDA her zaman görünür; dock modunda
            özet satırında chip'ler var + Ayrıntılar altında düzenlenir. */}
        {(!compactDock || showAdvanced) && (
        <ContactPicker
          label="Kime"
          values={to}
          onChange={setTo}
          suggestions={suggestions}
          disabled={submitting}
        />
        )}
        {/* R7 + R10.1 — Ayrıntılar toggle: dock'ta özet satırında zaten var,
            gizli. Overlay/tab-içi'nde satır-içi toggle mevcut kalır. */}
        {!compactDock && (
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-ndark-muted"
          aria-expanded={showAdvanced}
        >
          <span>{showAdvanced ? '▾' : '▸'}</span>
          ayrıntılar (Cc / Bcc / İmza / Şablon)
        </button>
        )}
        {showAdvanced && (
          <>
            <ContactPicker
              label="Kopya (Cc)"
              values={cc}
              onChange={setCc}
              suggestions={suggestions}
              disabled={submitting}
            />
            <ContactPicker
              label="Gizli Kopya (Bcc)"
              values={bcc}
              onChange={setBcc}
              suggestions={suggestions}
              disabled={submitting}
            />
          </>
        )}
        {/* Visibility toggles geri uyumluluk için sessizce mantıkta;
            UI'da herzaman görünür. */}
        <input type="hidden" value={showCc ? '1' : '0'} onChange={() => undefined} />
        <input type="hidden" value={showBcc ? '1' : '0'} onChange={() => undefined} />

        {/* Compose-Signature F3 — Kompoze imza (Ayrıntılar altında, R7). */}
        {showAdvanced && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="İmza">
            <select
              value={signatureSelection}
              onChange={(e) => setSignatureSelection(e.target.value as 'none' | 'mine')}
              disabled={submitting}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text"
              title={
                agentHtml
                  ? 'Kişisel imza override\'ınız (Mail İmzam menüsünden)'
                  : composedHtml
                    ? 'Şirket şablonu + adınız/unvanınız (Person kartından)'
                    : 'İmza tanımlı değil'
              }
            >
              <option value="none">İmzasız</option>
              <option value="mine" disabled={!effectiveSignatureHtml}>
                {effectiveSignatureHtml ? 'İmzam' : 'İmzam (tanımlı değil)'}
              </option>
            </select>
          </Field>
          <Field label="Mail Şablonu">
            <select
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (id) void applyTemplate(id);
                e.target.value = ''; // her seçim sonrası placeholder'a dön
              }}
              disabled={submitting || templateBusy || templates.length === 0}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text"
              title={templates.length === 0 ? 'Bu şirkette mail şablonu tanımlı değil' : 'Şablonu seç → metin/konu otomatik eklenir'}
            >
              <option value="">
                {templates.length === 0 ? 'Şablon yok' : 'Şablon seçin…'}
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.category ? `[${t.category}] ${t.name}` : t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        )}

        {/* Subject — compactDock'ta Ayrıntılar altında (reply RE: otomatik değeri korunur). */}
        {(!compactDock || showAdvanced) && (
        <Field label="Konu">
          <TextInput
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={submitting}
            placeholder={
              mode === 'reply'
                ? `Re: [${item.caseNumber}] ...`
                : mode === 'forward'
                  ? `Fwd: ...`
                  : `Konu yazın`
            }
          />
        </Field>
        )}

        {/* Attachments */}
        <Field label="Eklentiler">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleAttach(e.target.files)}
          />
          <div
            className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50/40 p-2 dark:border-ndark-border dark:bg-ndark-bg/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void handleAttach(e.dataTransfer.files); }}
          >
            <Button
              type="button"
              variant="outline"
              leftIcon={<Paperclip size={13} />}
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting || uploading}
            >
              {uploading ? 'Yükleniyor…' : 'Dosya Ekle'}
            </Button>
            <span className={`${MAIL_TYPE.t1} text-slate-500 dark:text-ndark-muted`}>veya sürükle-bırak</span>
            {attachments.map((a) => (
              <span
                key={a.id}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                  a.inline
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                    : 'bg-slate-100 text-slate-700 dark:bg-ndark-bg dark:text-ndark-text'
                }`}
                title={a.inline ? 'Gövde içinde görsel — silmek için editörden görseli sil.' : undefined}
              >
                <Paperclip size={11} />
                {a.fileName}
                {a.inline && <span className={`${MAIL_TYPE.t1} opacity-70`}>(gövde)</span>}
                {/* Codex P2 R1: inline pill'de Kaldır butonu YOK — kullanıcı
                    click'lerse attachments düşer ama bodyHtml'de <img> kalır
                    → orphan CID → müşteride broken image. Inline'ı editörden
                    silsin, send öncesi filter otomatik düşürür. */}
                {!a.inline && (
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.id)}
                    className="text-slate-400 hover:text-rose-500"
                    title="Kaldır"
                  >
                    <X size={11} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </Field>

        {/* Editor / Preview */}
        <Field label="Metin">
          {previewing ? (
            <div className="rounded-md border border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
              <div className={`border-b border-slate-100 px-3 py-1.5 ${MAIL_TYPE.t1} text-slate-500 dark:border-ndark-border dark:text-ndark-muted`}>
                Önizleme (sanitize edilmiş)
              </div>
              <div
                className="prose prose-sm max-w-none px-3 py-2 dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          ) : (
            <RichTextEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              disabled={submitting}
              onPasteImage={handlePasteImage}
              autoFocus={compactDock}
            />
          )}
        </Field>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-3 py-2 dark:border-ndark-border">
        {/* R5 — Büyüt (yalnız inline mode): tam alan overlay'a taşı, taslak korunur. */}
        {layoutMode === 'inline' && onGrow && (
          <Button
            type="button"
            variant="outline"
            onClick={onGrow}
            disabled={submitting}
            title="Tam ekran composer'a taşı (taslak korunur)"
            className="mr-auto"
          >
            Büyüt ↗
          </Button>
        )}
        {onCancel && (
          <Button type="button" variant="ghost" onClick={requestCancel} disabled={submitting}>
            Vazgeç
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => setPreviewing((v) => !v)}
          disabled={submitting}
        >
          {previewing ? 'Düzenle' : 'Önizleme'}
        </Button>
        <Button
          type="button"
          variant="primary"
          leftIcon={<Send size={13} />}
          onClick={() => void handleSubmit()}
          disabled={!canSend}
          title={!selectedAlias ? 'Gönderen yok' : to.length === 0 ? 'Alıcı eksik' : undefined}
        >
          {submitting ? 'Gönderiliyor…' : 'Gönder'}
        </Button>
      </div>

      {/* R10.1 — Vazgeç onay modalı. ESC ile veya Vazgeç butonuyla tetiklenir;
          composer dirty ise buradan geçer. İkinci ESC modalı kapatır (composer
          açık kalır, taslak durur). "Kapat" onaylanırsa onCancel çalışır. */}
      {showCancelConfirm && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowCancelConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Vazgeç onayı"
            className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl dark:bg-ndark-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-ndark-text">
              Taslak kaydedilmez. Kapatılsın mı?
            </h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-ndark-muted">
              Yazdıklarınız kaybolacak. ESC ile vazgeç, "Kapat" ile taslağı bırak.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowCancelConfirm(false)}
              >
                Vazgeç
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={closeAndCancel}
              >
                Kapat
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* M6.3b Faz 3 — Şablon uygulama onay modalı.
          n4b S11 endüstri parite: subject replace onayı.
          Codex P2 fix: missing placeholder uyarısı. */}
      {pendingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPendingTemplate(null)}>
          <div
            className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl dark:bg-ndark-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-ndark-text">
              Şablon uygulanacak
            </h3>

            {/* Missing placeholder uyarısı — agent farkında olmadan eksik
                değişkenle mail göndermesin (Codex P2 fix). */}
            {pendingTemplate.missing.length > 0 && (
              <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                <p className="font-semibold">⚠ Bilinmeyen değişkenler boş bırakıldı:</p>
                <p className="mt-1 font-mono">
                  {pendingTemplate.missing.map((m) => `{{${m}}}`).join(', ')}
                </p>
                <p className={`mt-1 ${MAIL_TYPE.t1} opacity-80`}>
                  Şablonu uyguladıktan sonra metinde boşluk varsa kontrol edin.
                </p>
              </div>
            )}

            {pendingTemplate.needsSubjectChoice && (
              <>
                <p className="mb-2 text-xs text-slate-600 dark:text-ndark-muted">
                  Mevcut konu: <span className="font-mono">{subject}</span>
                  <br />
                  Şablon konusu: <span className="font-mono">{pendingTemplate.subject}</span>
                </p>
                <p className="mb-3 text-xs text-slate-500">
                  "Konuyu koru" seçerseniz konu değişmez; şablon metni yine eklenir.
                </p>
              </>
            )}

            {!pendingTemplate.needsSubjectChoice && pendingTemplate.missing.length > 0 && (
              <p className="mb-3 text-xs text-slate-500">
                Devam etmek istiyor musunuz?
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPendingTemplate(null)}>
                Vazgeç
              </Button>
              {pendingTemplate.needsSubjectChoice ? (
                <>
                  <Button type="button" variant="outline" onClick={() => confirmTemplate(false)}>
                    Konuyu koru
                  </Button>
                  <Button type="button" variant="primary" onClick={() => confirmTemplate(true)}>
                    Konuyu değiştir
                  </Button>
                </>
              ) : (
                <Button type="button" variant="primary" onClick={() => confirmTemplate(false)}>
                  Yine de uygula
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
