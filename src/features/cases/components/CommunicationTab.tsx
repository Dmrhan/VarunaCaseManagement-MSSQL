/**
 * Mail M6.1 — Case Detail "İletişim" sekmesi.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 3 (mimari).
 *
 * Yapı:
 *  - Üstte ÇOK-KANAL iskelet (K5): Web / E-Posta / SMS / Gelen Aramalar.
 *    Şimdilik E-Posta DOLU; diğerleri placeholder ("Yakında" rozet).
 *  - E-Posta panel: <MailThread> read-only.
 *
 * Composer (M6.2) bu component'in alt bölümüne eklenecek.
 */
import { useState } from 'react';
import { AtSign, Globe, MessageSquare, Phone } from 'lucide-react';
import { MailThread } from './MailThread';

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
  caseId: string;
}

export function CommunicationTab({ caseId }: Props) {
  const [channel, setChannel] = useState<Channel>('email');
  const active = CHANNELS.find((c) => c.key === channel) ?? CHANNELS[0];

  return (
    <div className="space-y-3">
      {/* K5 iskelet — çok-kanal tab. E-Posta dışındakiler disabled
          ("Yakında" rozet). */}
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

      {channel === 'email' && <MailThread caseId={caseId} />}

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
