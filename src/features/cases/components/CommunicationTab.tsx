/**
 * Mail M6.1 + M6.2b + M6.3-realign — Case Detail "İletişim" sekmesi.
 *
 * n4b paritesi (M6.3-realign):
 *  - E-Posta sekmesi = TABLO (yön / from / to / cc / bcc / tarih /
 *    konu+ek / aksiyonlar).
 *  - Üstte SADECE "+ Yeni e-posta" — "Yanıtla" KALDIRILDI (satır içi
 *    aksiyona taşındı).
 *  - Composer = TAM EKRAN: thread'in yerini alır; Vazgeç ile thread'e
 *    döner.
 *  - Satır ikonları: Görüntüle / Yanıtla (reply-all) / İlet (forward).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Globe, Info, MessageSquare, Phone, Plus } from 'lucide-react';
import { MailThread, type MailThreadHandle } from './MailThread';
import { MailComposer } from './MailComposer';
import { Button } from '@/components/ui/Button';
import { caseEmailService, type CaseEmailItem, type EmailConfigDebug, type EmailConfigReason, type ReplyContext, type ForwardContext } from '@/services/caseEmailService';
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

interface Props {
  item: Case;
}

export function CommunicationTab({ item }: Props) {
  const [channel, setChannel] = useState<Channel>('email');
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyCtx, setReplyCtx] = useState<ReplyContext | null>(null);
  const [forwardCtx, setForwardCtx] = useState<ForwardContext | null>(null);
  const [signatureHtml, setSignatureHtml] = useState<string | null>(null);
  // Codex fix — Reply/Forward konu prefill: composer açıkken mode değişirse
  // (örn. reply açıkken forward'a geç) initialReplyContext/initialForwardContext
  // prop değişiyor ama composer'ın internal state'i (subject vs.) ilk
  // mount'ta sabitlendiği için yenilenmiyordu. composeKey her openX'te
  // değişir → composer remount → useState initializer subject'i yeni
  // ctx.subject ile doldurur.
  const [composeKey, setComposeKey] = useState(0);
  // M6.3-realign — config-yok hali. mailConfigState:
  //   'loading'   → aliases fetch'i bekleniyor (ilk render)
  //   'configured'→ 1+ alias var, normal akış
  //   'missing'   → 0 alias, "Mail entegrasyonu yapılandırılmamış" banner
  const [mailConfigState, setMailConfigState] = useState<'loading' | 'configured' | 'missing'>('loading');
  // Debug/log için reason (banner'da development modunda gösterilebilir)
  const [missingReason, setMissingReason] = useState<EmailConfigReason | null>(null);
  const [configDebug, setConfigDebug] = useState<EmailConfigDebug | null>(null);
  const threadRef = useRef<MailThreadHandle>(null);
  const active = CHANNELS.find((c) => c.key === channel) ?? CHANNELS[0];

  // İmzayı sessizce yükle (silent fetch — config-yok şirketlerde 404 →
  // toast yok, null döner).
  useEffect(() => {
    let alive = true;
    void caseEmailService.getEmailSignature(item.id).then((s) => {
      if (alive) setSignatureHtml(s);
    });
    return () => { alive = false; };
  }, [item.id]);

  // M6.3-realign (revize) — dedicated email-config endpoint'i.
  // configured kararı backend'de listActiveWithSettingFallback'e dayanır
  // → composer dropdown ile aynı kaynak. UNIVERA gibi config TAM +
  // manuel FromAlias YOK senaryosunda configured=true döner
  // (reason='fallback-from-address').
  useEffect(() => {
    let alive = true;
    void caseEmailService.getEmailConfig(item.id).then((cfg) => {
      if (!alive) return;
      setMailConfigState(cfg.configured ? 'configured' : 'missing');
      setMissingReason(cfg.configured ? null : cfg.reason);
      setConfigDebug(cfg.debug ?? null);
    });
    return () => { alive = false; };
  }, [item.id]);

  const openReply = useCallback(async (_email?: CaseEmailItem) => {
    // reply-context backend son inbound'u baz alıyor. Email-specific
    // reply için ileride backend `?inReplyTo=` parametresi eklenebilir.
    const ctx = await caseEmailService.getReplyContext(item.id);
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
    setComposerOpen(false);
    setReplyCtx(null);
    setForwardCtx(null);
    threadRef.current?.refresh({ scrollToLast: true });
  }, []);

  const handleCancel = useCallback(() => {
    setComposerOpen(false);
    setReplyCtx(null);
    setForwardCtx(null);
  }, []);

  return (
    <div className="space-y-3">
      {/* K5 iskelet — çok-kanal tab. E-Posta dışındakiler disabled. */}
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
              aria-label={c.enabled ? c.label : `${c.label} (yakında)`}
              title={c.enabled ? c.label : `${c.label} — yakında`}
            >
              {c.icon}
              <span>{c.label}</span>
              {!c.enabled && (
                <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-px text-[9px] uppercase tracking-wide text-slate-500 dark:bg-ndark-card dark:text-ndark-muted">
                  Yakında
                </span>
              )}
            </button>
          );
        })}
      </div>

      {channel === 'email' && mailConfigState === 'loading' && (
        <div className="py-8 text-center text-sm text-slate-500 dark:text-ndark-muted">
          Yükleniyor…
        </div>
      )}

      {channel === 'email' && mailConfigState === 'missing' && (
        // M6.3-realign — config-yok hali. Toast yağmuru YOK; tek temiz
        // banner. Mesaj backend'in döndürdüğü reason'a göre hassaslaşır.
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
            {/* Development modunda detaylı teşhis payload'ı — admin'in
                hangi companyId'ye kaydettiği vs vakanın companyId'si
                mismatch'ini görmek için */}
            {(import.meta as { env?: { DEV?: boolean } }).env?.DEV && missingReason && (
              <div className="mt-2 rounded border border-amber-200 bg-amber-100 p-2 font-mono text-[10px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-900/40">
                <p className="font-sans font-semibold">[teşhis]</p>
                <p>reason: <b>{missingReason}</b></p>
                {configDebug && (
                  <>
                    <p>caseCompanyId: <b>{configDebug.caseCompanyId}</b></p>
                    <p>caseCompanyName: {configDebug.caseCompanyName ?? '—'}</p>
                    <p>settingExists: <b>{String(configDebug.settingExists)}</b></p>
                    {configDebug.settingExists && (
                      <>
                        <p>settingEnabled: {String(configDebug.settingEnabled)}</p>
                        <p>settingFromAddress: {configDebug.settingFromAddress || '(boş)'}</p>
                        <p>aliasActiveCount: {configDebug.aliasActiveCount}</p>
                      </>
                    )}
                    {missingReason === 'no-setting' && Array.isArray(configDebug.settingCompanies) && (
                      <div className="mt-2">
                        <p className="font-sans text-amber-800">
                          ⚠ Bu vakanın{' '}
                          <b>{configDebug.caseCompanyId}</b> companyId'sinde
                          ExternalMailSetting YOK.
                          {configDebug.settingCompanies.length > 0
                            ? ' Yetkili olduğunuz başka şirketlerde setting var:'
                            : ' Yetkili olduğunuz başka şirketlerde de setting yok.'}
                        </p>
                        {configDebug.settingCompanies.length > 0 && (
                          <table className="mt-1 w-full border-collapse text-[10px]">
                            <thead>
                              <tr className="border-b border-amber-300 text-left">
                                <th className="px-1 py-0.5">name</th>
                                <th className="px-1 py-0.5">companyId</th>
                                <th className="px-1 py-0.5">enabled</th>
                                <th className="px-1 py-0.5">from?</th>
                                <th className="px-1 py-0.5">match?</th>
                              </tr>
                            </thead>
                            <tbody>
                              {configDebug.settingCompanies.map((s) => {
                                const sameName =
                                  configDebug.caseCompanyName &&
                                  s.name &&
                                  s.name.trim().toLowerCase() ===
                                    configDebug.caseCompanyName.trim().toLowerCase();
                                return (
                                  <tr
                                    key={s.companyId}
                                    className={
                                      sameName
                                        ? 'bg-rose-100 dark:bg-rose-900/40'
                                        : ''
                                    }
                                  >
                                    <td className="px-1 py-0.5">{s.name ?? '—'}</td>
                                    <td className="px-1 py-0.5">{s.companyId}</td>
                                    <td className="px-1 py-0.5">{String(s.enabled)}</td>
                                    <td className="px-1 py-0.5">{String(s.hasFromAddress)}</td>
                                    <td className="px-1 py-0.5">
                                      {sameName ? '🔥 aynı isim, farklı ID' : ''}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {channel === 'email' && mailConfigState === 'configured' && (
        <>
          {composerOpen ? (
            // M6.3-realign — TAM EKRAN composer; thread'i değiştirir.
            <MailComposer
              key={composeKey}
              item={item}
              initialReplyContext={replyCtx}
              initialForwardContext={forwardCtx}
              initialSignatureHtml={signatureHtml}
              onSent={handleSent}
              onCancel={handleCancel}
            />
          ) : (
            <>
              {/* Toolbar — n4b paritesi: sadece "+ Yeni e-posta". */}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  leftIcon={<Plus size={13} />}
                  onClick={openNew}
                >
                  Yeni e-posta
                </Button>
              </div>

              <MailThread
                ref={threadRef}
                caseId={item.id}
                onReply={(email) => void openReply(email)}
                onForward={(email) => void openForward(email)}
              />
            </>
          )}
        </>
      )}

      {channel !== 'email' && (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center dark:border-ndark-border dark:bg-ndark-card">
          <p className="text-sm text-slate-600 dark:text-ndark-muted">
            {active.label} kanalı yakında eklenecek.
          </p>
        </div>
      )}
    </div>
  );
}
