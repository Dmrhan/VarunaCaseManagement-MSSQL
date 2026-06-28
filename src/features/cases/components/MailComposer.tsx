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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { RichTextEditor } from './RichTextEditor';
import type { Case, CaseFile } from '../types';

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
  /** M6.3b Faz 2 — Tenant default imza (ExternalMailSetting.signatureHtml). */
  initialTenantSignatureHtml?: string | null;
  /** M6.3b Faz 2 — Per-agent imza (User.signatureHtml). */
  initialAgentSignatureHtml?: string | null;
  /** Composer'dan inbound/outbound CaseEmail oluşunca thread refresh. */
  onSent?: () => void;
  /** Vazgeç butonu. */
  onCancel?: () => void;
}

interface UploadedFileRef {
  id: string;
  fileName: string;
  fileSize: number;
}

type ContactPickerValue = { address: string; name: string | null };

export function MailComposer({
  item,
  initialReplyContext = null,
  initialForwardContext = null,
  initialSignatureHtml = null,
  initialTenantSignatureHtml = null,
  initialAgentSignatureHtml = null,
  onSent,
  onCancel,
}: MailComposerProps) {
  const { toast } = useToast();
  const [aliases, setAliases] = useState<FromAliasOption[]>([]);
  const [fromId, setFromId] = useState<string>('');
  const [to, setTo] = useState<ContactPickerValue[]>(initialReplyContext?.to ?? []);
  const [cc, setCc] = useState<ContactPickerValue[]>(initialReplyContext?.cc ?? []);
  const [bcc, setBcc] = useState<ContactPickerValue[]>(initialReplyContext?.bcc ?? []);
  // M6.3-realign — Cc/Bcc her zaman görünür (n4b spec). Setter
  // gerekmiyor; sadece downstream handleSubmit kullanımına string
  // kalsın diye sabit readonly.
  const showCc = true;
  const showBcc = true;
  // Önizleme modu
  const [previewing, setPreviewing] = useState(false);
  // M6.3b Faz 2 — fallback chain: agent > tenant > none.
  // Geri uyumluluk: eski caller initialSignatureHtml verirse tenant
  // olarak yorumla (agent null).
  const tenantHtml = initialTenantSignatureHtml ?? initialSignatureHtml ?? null;
  const agentHtml = initialAgentSignatureHtml ?? null;
  // İmza dropdown — n4b S2/S5/S6 endüstri parite.
  //   Otomatik insert: default fallback (agent > tenant)
  //   Composer toggle: 'agent' | 'tenant' | 'none'
  const initialSignatureChoice: 'agent' | 'tenant' | 'none' = agentHtml
    ? 'agent'
    : tenantHtml
      ? 'tenant'
      : 'none';
  const [signatureSelection, setSignatureSelection] = useState<'agent' | 'tenant' | 'none'>(
    initialSignatureChoice,
  );
  // Seçimden HTML'e map — initial + dropdown değişimi için.
  const resolveSignatureHtml = (sel: 'agent' | 'tenant' | 'none'): string | null => {
    if (sel === 'agent') return agentHtml;
    if (sel === 'tenant') return tenantHtml;
    return null;
  };
  // initial baseline body için seçili imzanın HTML'i.
  const initialSelectedSignatureHtml = resolveSignatureHtml(initialSignatureChoice);
  // Codex P2 fix — body'de o an "etkin" imzayı takip et. Dropdown değişiminde
  // body'deki ESKİ imzayı yeni seçimle SWAP edebilelim diye ref'te tut.
  const currentSignatureHtmlRef = useRef<string | null>(initialSelectedSignatureHtml);
  const [subject, setSubject] = useState<string>(
    initialReplyContext?.subject ?? initialForwardContext?.subject ?? '',
  );
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
      if (initialForwardContext?.quotedBodyHtml) html += initialForwardContext.quotedBodyHtml;
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
        // Codex P2 fix — forward quotedBodyHtml KORUNMALI.
        const quoted = initialForwardContext?.quotedBodyHtml ?? '';
        const next = `<p></p>${initialSelectedSignatureHtml}${quoted}`;
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
  }, [initialSelectedSignatureHtml, initialSignatureChoice, initialForwardContext]);

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
      if (oldSig) {
        // 1) Sonu imzayla bitiyor mu? (forward + quoted YOK durumu)
        if (next.endsWith(oldSig)) {
          next = next.slice(0, -oldSig.length);
        } else {
          // 2) `<p></p>${oldSig}${rest}` paterni (forward + quoted VAR)
          const prefix = `<p></p>${oldSig}`;
          if (next.startsWith(prefix)) {
            next = '<p></p>' + next.slice(prefix.length);
          } else {
            // Agent body'yi çok değiştirdi — silent skip.
            currentSignatureHtmlRef.current = newSig;
            return cur;
          }
        }
      }
      if (newSig) {
        // forward bağlamı varsa quoted body'nin BAŞINA imza enjekte et.
        const quoted = initialForwardContext?.quotedBodyHtml ?? '';
        if (quoted && next.endsWith(quoted)) {
          next = next.slice(0, -quoted.length) + newSig + quoted;
        } else {
          next = next + newSig;
        }
      }
      currentSignatureHtmlRef.current = newSig;
      return next;
    });
  }, [signatureSelection, agentHtml, tenantHtml, initialForwardContext]);
  const [attachments, setAttachments] = useState<UploadedFileRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const def = items.find((a) => a.isDefault) ?? items[0] ?? null;
      if (def) setFromId(def.id);
    });
    return () => { alive = false; };
  }, [item.id]);

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
  // Codex P2 fix — missing placeholder VAR ise agent'a uyarı modalı
  // (bilinmeyen {{var}} → boş render → agent farkında olmadan eksik
  // değişkenle mail gönderebilirdi).
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
      // Body insert — cursor pozisyonu yerine basit append (TipTap state
      // composer'ın internal'ında; v1 append; v2 cursor için TipTap
      // editor ref gerek).
      setBodyHtml((cur) => cur + rendered.bodyHtml);
    } finally {
      setTemplateBusy(false);
    }
  }

  function confirmTemplate(replaceSubject: boolean) {
    if (!pendingTemplate) return;
    if (replaceSubject && pendingTemplate.subject) {
      setSubject(pendingTemplate.subject);
    }
    setBodyHtml((cur) => cur + pendingTemplate.bodyHtml);
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

  const canSend = !!selectedAlias && to.length > 0 && !submitting && !uploading;

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
      // DOMPurify ile final pass (defense-in-depth; backend de sanitize eder)
      const safeBody = DOMPurify.sanitize(bodyHtml, { USE_PROFILES: { html: true } });
      const r = await caseEmailService.sendEmail(item.id, {
        fromAddress: selectedAlias.address,
        to,
        cc: showCc ? cc : [],
        bcc: showBcc ? bcc : [],
        subject,
        bodyHtml: safeBody,
        attachments: attachments.map((a) => a.id),
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

  // Önizleme: DOMPurify ile sanitize edilmiş bodyHtml
  const previewHtml = useMemo(() => {
    return DOMPurify.sanitize(bodyHtml, {
      USE_PROFILES: { html: true },
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'width', 'height', 'style', 'class'],
      FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed', 'link', 'meta', 'style'],
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

  return (
    // M6.3-realign — TAM EKRAN composer. Parent (CommunicationTab)
    // composer açıkken thread'i gizler; bu container thread alanını
    // doldurur.
    <div className="rounded-lg border border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-ndark-border">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">{title}</h3>
        {item.caseNumber && (
          <span className="text-[10px] text-slate-500 dark:text-ndark-muted">
            [{item.caseNumber}]
          </span>
        )}
      </div>

      <div className="space-y-3 p-3">
        {/* Müşteri (read-only — vaka context'i) */}
        <Field label="Müşteri">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text">
            {item.accountName || item.customerCompanyName || item.customerContactName || item.customerContactEmail || '—'}
          </div>
        </Field>

        {/* From — Codex fix: HER ZAMAN görünür (n4b paritesi). Boş ise net
            uyarı + Send pasif. */}
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

        {/* To/Cc/Bcc — n4b: 3'ü de görünür */}
        <ContactPicker
          label="Kime"
          values={to}
          onChange={setTo}
          suggestions={suggestions}
          disabled={submitting}
        />
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
        {/* Visibility toggles geri uyumluluk için sessizce mantıkta;
            UI'da herzaman görünür. */}
        <input type="hidden" value={showCc ? '1' : '0'} onChange={() => undefined} />
        <input type="hidden" value={showBcc ? '1' : '0'} onChange={() => undefined} />

        {/* M6.3b Faz 2 — İmza + Şablon AYRI dropdown (n4b S6).
            n4b S2 endüstri parite: otomatik insert (fallback chain).
            Agent değiştirebilir: 'Kişisel imzam' / 'Şirket varsayılan' /
            'İmzasız'. Faz 3'te Mail Şablonu ayrı dropdown'la gelir.
            Selection değişimi composer açıkken canlı baseline rewrite
            mantığı şu an YOK — initial seçim baseline'a injekt edilir;
            agent değiştirirse baseline'ı manuel düzenler (basit v1). */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="İmza">
            <select
              value={signatureSelection}
              onChange={(e) => setSignatureSelection(e.target.value as 'none' | 'tenant' | 'agent')}
              disabled={submitting}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-ndark-border dark:bg-ndark-bg dark:text-ndark-text"
            >
              <option value="none">İmzasız</option>
              <option value="agent" disabled={!agentHtml}>
                {agentHtml ? 'Kişisel imzam' : 'Kişisel imzam (tanımlı değil)'}
              </option>
              <option value="tenant" disabled={!tenantHtml}>
                {tenantHtml ? 'Şirket varsayılan imzası' : 'Şirket varsayılan imzası (tanımlı değil)'}
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

        {/* Subject */}
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
            <span className="text-[11px] text-slate-500 dark:text-ndark-muted">veya sürükle-bırak</span>
            {attachments.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-ndark-bg dark:text-ndark-text">
                <Paperclip size={11} />
                {a.fileName}
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="text-slate-400 hover:text-rose-500"
                  title="Kaldır"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        </Field>

        {/* Editor / Preview */}
        <Field label="Metin">
          {previewing ? (
            <div className="rounded-md border border-slate-200 bg-white dark:border-ndark-border dark:bg-ndark-card">
              <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-500 dark:border-ndark-border dark:text-ndark-muted">
                Önizleme (sanitize edilmiş)
              </div>
              <div
                className="prose prose-sm max-w-none px-3 py-2 dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          ) : (
            <RichTextEditor value={bodyHtml} onChange={setBodyHtml} disabled={submitting} />
          )}
        </Field>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-3 py-2 dark:border-ndark-border">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
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
                <p className="mt-1 text-[10px] opacity-80">
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
