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
  /** Tenant default imza HTML — composer açılınca gövde sonuna append. */
  initialSignatureHtml?: string | null;
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
  initialSignatureHtml = null,
  onSent,
  onCancel,
}: MailComposerProps) {
  const { toast } = useToast();
  const [aliases, setAliases] = useState<FromAliasOption[]>([]);
  const [fromId, setFromId] = useState<string>('');
  const [to, setTo] = useState<ContactPickerValue[]>(initialReplyContext?.to ?? []);
  const [cc, setCc] = useState<ContactPickerValue[]>(initialReplyContext?.cc ?? []);
  const [bcc, setBcc] = useState<ContactPickerValue[]>(initialReplyContext?.bcc ?? []);
  const [showCc, setShowCc] = useState(cc.length > 0);
  const [showBcc, setShowBcc] = useState(bcc.length > 0);
  const [subject, setSubject] = useState<string>(initialReplyContext?.subject ?? '');
  // Composer açıldıktan SONRA gelen imza için (slow network):
  // useState initializer prop güncellenince yeniden çağrılmaz; o yüzden
  // baseline body'yi ref'te tutarız ve effect ile imza bir kez append edilir.
  // Kullanıcı yazmaya başladıysa (body baseline'dan değiştiyse) ASLA
  // dokunmayız — composer içeriğini ezmemek için.
  // Codex review fix (M6.2b): late-arriving signature.
  const initialBaselineBodyRef = useRef<string>(
    initialSignatureHtml ? `<p></p>${initialSignatureHtml}` : '<p></p>',
  );
  const [bodyHtml, setBodyHtml] = useState<string>(initialBaselineBodyRef.current);
  const signatureAppendedRef = useRef<boolean>(!!initialSignatureHtml);

  useEffect(() => {
    if (signatureAppendedRef.current) return;
    if (!initialSignatureHtml) return;
    setBodyHtml((cur) => {
      // Body hala baseline ('<p></p>') durumunda mı? → append güvenli.
      if (cur === initialBaselineBodyRef.current) {
        const next = `<p></p>${initialSignatureHtml}`;
        initialBaselineBodyRef.current = next;
        signatureAppendedRef.current = true;
        return next;
      }
      // Kullanıcı yazmaya başlamış — dokunma. Yine de "yine deneme" diye
      // flag set et.
      signatureAppendedRef.current = true;
      return cur;
    });
  }, [initialSignatureHtml]);
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

  const selectedAlias = aliases.find((a) => a.id === fromId) ?? null;
  const hideFromDropdown = aliases.length <= 1;

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

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-ndark-border dark:bg-ndark-card">
      {/* From */}
      {!hideFromDropdown && (
        <Field label="Gönderen">
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
        </Field>
      )}
      {hideFromDropdown && selectedAlias && (
        <p className="mb-2 text-xs text-slate-500 dark:text-ndark-muted">
          Gönderen: <span className="font-medium text-slate-700 dark:text-ndark-text">
            {selectedAlias.displayName ? `${selectedAlias.displayName} <${selectedAlias.address}>` : selectedAlias.address}
          </span>
        </p>
      )}

      {/* To/Cc/Bcc */}
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <ContactPicker
              label="Kime"
              values={to}
              onChange={setTo}
              suggestions={suggestions}
              disabled={submitting}
            />
          </div>
          <div className="mt-5 flex gap-1 text-xs">
            {!showCc && <button type="button" className="text-brand-600 hover:underline" onClick={() => setShowCc(true)}>+Cc</button>}
            {!showBcc && <button type="button" className="text-brand-600 hover:underline" onClick={() => setShowBcc(true)}>+Bcc</button>}
          </div>
        </div>
        {showCc && (
          <ContactPicker label="Cc" values={cc} onChange={setCc} suggestions={suggestions} disabled={submitting} />
        )}
        {showBcc && (
          <ContactPicker label="Bcc" values={bcc} onChange={setBcc} suggestions={suggestions} disabled={submitting} />
        )}
      </div>

      {/* Subject */}
      <Field label="Konu" className="mt-2">
        <TextInput
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={submitting}
          placeholder={`Re: [${item.caseNumber}] ...`}
        />
      </Field>

      {/* Editor */}
      <div className="mt-2">
        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-ndark-muted">Mesaj</label>
        <RichTextEditor value={bodyHtml} onChange={setBodyHtml} disabled={submitting} />
      </div>

      {/* Attachments */}
      <div className="mt-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void handleAttach(e.target.files)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            leftIcon={<Paperclip size={13} />}
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting || uploading}
          >
            {uploading ? 'Yükleniyor…' : 'Ek ekle'}
          </Button>
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
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Vazgeç
          </Button>
        )}
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
    </div>
  );
}
