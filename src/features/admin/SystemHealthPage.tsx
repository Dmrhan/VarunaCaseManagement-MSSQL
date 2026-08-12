/**
 * SystemHealthPage — Sistem Sağlığı panosu (Faz 2, 2026-07-10).
 *
 * SystemAdmin-only teşhis ekranı; onaylı mockup'ın canlı hali.
 * Veri: GET /api/system/health (60 sn otomatik yenileme + elle ↻).
 *
 * İlkeler (mockup ile birebir):
 *  - Exception-first: en üstte "Dikkat gerektirenler" şeridi — admin 3
 *    saniyede tarar; yeşiller aşağıda detayda.
 *  - Eşikler her kartta GÖRÜNÜR (neden kırmızı sorusu hiç doğmaz). Eşik
 *    sabitleri Zabbix template makrolarıyla senkron tutulur (aşağıda TH).
 *  - ALARM burada ÇALMAZ — alarm/eskalasyon Zabbix'te; bu pano teşhis.
 *  - İş metrikleri yok (SLA/backlog → Operasyon Panosu).
 *  - Kaynak rozetleri: VARUNA (health) / ZABBIX (makine — Faz 2.1'de
 *    zabbixClient'tan bağlanacak; şimdilik kurulum-durum kartı).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, HardDrive, Inbox, ListChecks,
  Mail, RefreshCw, ShieldCheck, Timer,
} from 'lucide-react';
import { getSystemHealth, type SystemHealth, type HealthCronRun } from '@/services/systemHealthService';

// ── Eşikler — docs/integrations/zabbix template makrolarıyla senkron ──
const TH = {
  pendingWarn: 50,
  oldestPendingWarnMin: 24 * 60,
  loopCritPer5m: 15, // ≈3/dk — 6 Temmuz döngü olayı önlemi
  diskWarnPct: 20,
  diskCritPct: 10,
  inboundStaleWarnMin: 720, // mesai dışı doğal büyür — cömert eşik
};

type Level = 'ok' | 'warn' | 'crit';

interface Alert { level: Exclude<Level, 'ok'>; text: string; hint: string }

// ── biçimleyiciler ──
const fmtBytes = (b: number | null | undefined): string => {
  if (b == null || !Number.isFinite(b)) return '—';
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
};
const fmtMin = (m: number | null | undefined): string => {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m >= 525600) return 'hiç';
  if (m >= 2880) return `${Math.round(m / 1440)} gün`;
  if (m >= 120) return `${Math.round(m / 60)} sa`;
  return `${m} dk`;
};
const fmtUptime = (s: number): string => {
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d}g ${h}s`;
  const mn = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}s ${mn}dk` : `${mn}dk`;
};
const fmtAgo = (iso: string | null): string => {
  if (!iso) return '—';
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'az önce';
  return `${fmtMin(diffMin)} önce`;
};

// ── küçük UI parçaları ──
function StatusDot({ level }: { level: Level }) {
  const cls = level === 'crit' ? 'bg-rose-500' : level === 'warn' ? 'bg-amber-500' : 'bg-emerald-500';
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${cls}`} />;
}

function SourceChip({ kind }: { kind: 'varuna' | 'zabbix' }) {
  return kind === 'varuna' ? (
    <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">Varuna</span>
  ) : (
    <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">Zabbix</span>
  );
}

function Card({ label, level, children, source, onDrill, drillHint }: {
  label: string; level?: Level; source?: 'varuna' | 'zabbix'; children: React.ReactNode;
  /** Tıklanınca drill-down (öz-açıklayıcı: alt köşede "kayıtları gör →" ipucu çıkar). */
  onDrill?: () => void; drillHint?: string;
}) {
  const base = 'relative rounded-xl border border-slate-200 bg-white p-3.5 dark:border-ndark-border dark:bg-ndark-card';
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 dark:text-ndark-muted">
        {label} {source && <SourceChip kind={source} />}
      </div>
      {level && <span className="absolute right-3 top-3"><StatusDot level={level} /></span>}
      {children}
      {onDrill && (
        <div className="mt-2 text-[10.5px] font-medium text-brand-600 opacity-80 group-hover:opacity-100 dark:text-ndark-link">
          {drillHint ?? 'kayıtları gör'} →
        </div>
      )}
    </>
  );
  if (!onDrill) return <div className={base}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onDrill}
      className={`${base} group block w-full cursor-pointer text-left transition hover:border-brand-300 hover:shadow-sm`}
      title={drillHint ?? 'Kayıtları gör'}
    >
      {inner}
    </button>
  );
}

function Val({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <>
      <div className="mt-1 text-[22px] font-bold tabular-nums tracking-tight text-slate-900 dark:text-ndark-text">{children}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-ndark-muted">{sub}</div>}
    </>
  );
}

function Threshold({ text }: { text: string }) {
  return <div className="mt-1.5 text-[10px] text-slate-400 dark:text-ndark-muted">eşik: {text}</div>;
}

function SectionTitle({ n, title, hint, icon }: { n: number; title: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-baseline gap-2">
      <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-ndark-text">
        {icon}{n} · {title}
      </h2>
      {hint && <span className="text-[11px] text-slate-400 dark:text-ndark-muted">{hint}</span>}
    </div>
  );
}

function SectionError({ error }: { error: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      Bu bölümün verisi alınamadı: <span className="font-mono">{error}</span> — kalan bölümler sağlıklı raporlanıyor.
    </div>
  );
}

// ── eşik değerlendirme ──
function diskLevel(pct: number | null): Level {
  if (pct == null) return 'warn';
  if (pct < TH.diskCritPct) return 'crit';
  if (pct < TH.diskWarnPct) return 'warn';
  return 'ok';
}

function cronLevel(c: HealthCronRun): Level {
  if (c.ok === false) return 'warn';
  return 'ok';
}

function buildAlerts(h: SystemHealth): Alert[] {
  const out: Alert[] = [];
  const push = (level: Alert['level'], text: string, hint: string) => out.push({ level, text, hint });

  if (!h.mail?.error && h.mail.casesCreatedLast5m > TH.loopCritPer5m) {
    push('crit', `OLASI MAİL DÖNGÜSÜ — son 5 dk'da ${h.mail.casesCreatedLast5m} vaka`, 'Mail → döngü dedektörü');
  }
  if (!h.env?.error) {
    if (!h.env.storageRootWritable) push('crit', 'STORAGE_ROOT yazılamıyor — ekler kaydedilemez', 'Yapılandırma');
    if (!h.env.appPublicBaseUrlSet) push('crit', 'APP_PUBLIC_BASE_URL tanımsız — mail logoları/linkleri kırık gider', 'Yapılandırma');
    if (!h.env.imapPollingEnabled) push('warn', 'IMAP polling kapalı — gelen mail çekilmiyor (lokalde normal)', 'Yapılandırma');
  }
  if (!h.storage?.error && h.storage.diskFreePct != null) {
    if (h.storage.diskFreePct < TH.diskCritPct) push('crit', `Ek diski KRİTİK — %${h.storage.diskFreePct} boş`, 'Depolama');
    else if (h.storage.diskFreePct < TH.diskWarnPct) push('warn', `Ek diski azalıyor — %${h.storage.diskFreePct} boş`, 'Depolama');
  }
  if (!h.dispatch?.error) {
    if (h.dispatch.pendingCount > TH.pendingWarn) {
      push('warn', `${h.dispatch.pendingCount} bekleyen bildirim — en eskisi ${fmtMin(h.dispatch.oldestPendingAgeMin)}`, 'Dispatch');
    }
    if (h.dispatch.failed24h > 0) push('warn', `Son 24 saatte ${h.dispatch.failed24h} bildirim gönderilemedi`, 'Dispatch');
  }
  if (!h.mail?.error && h.mail.lastInboundAgeMin > TH.inboundStaleWarnMin) {
    push('warn', `Uzun süredir gelen mail yok (${fmtMin(h.mail.lastInboundAgeMin)}) — mesai dışıysa normal`, 'Mail');
  }
  for (const c of h.crons ?? []) {
    if (c.ok === false) push('warn', `Cron "${c.name}" son koşuda hata verdi`, 'Cron → tablo');
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'crit' ? -1 : 1));
}

export function SystemHealthPage({ onOpenDispatches }: {
  /**
   * Dispatch kuyruğu drill-down'ı — kart tıklanınca mevcut "Bildirim
   * Kayıtları" admin sayfası ilgili state filtresiyle açılır (App bağlar).
   */
  onOpenDispatches?: (state: 'Pending' | 'Failed' | '') => void;
} = {}) {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const h = await getSystemHealth();
    if (h) {
      setHealth(h);
      setError(null);
      setLastFetchedAt(new Date());
    } else {
      setError('Sağlık verisi alınamadı — sunucu erişilebilir mi?');
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = window.setInterval(() => { void load(); }, 60_000);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [load]);

  if (!health) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-ndark-muted">
        {error ?? 'Sistem sağlığı yükleniyor…'}
      </div>
    );
  }

  const alerts = buildAlerts(health);
  const critCount = alerts.filter((a) => a.level === 'crit').length;
  const warnCount = alerts.filter((a) => a.level === 'warn').length;
  const pollable = health.mail?.pollableInboxCount ?? health.mail?.activeInboxCount ?? 0;
  const diskUsedPct = health.storage?.diskFreePct != null ? Math.round((100 - health.storage.diskFreePct) * 10) / 10 : null;

  return (
    <div className="mx-auto max-w-[1080px] p-4 pb-12">
      {/* ═ Başlık ═ */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-ndark-text">
          <Activity size={18} className="text-brand-600" /> Sistem Sağlığı
          <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">SystemAdmin</span>
        </h1>
        <div className="flex items-center gap-2 text-[11.5px] text-slate-500 dark:text-ndark-muted">
          <span>
            {critCount > 0 && <b className="text-rose-600">{critCount} kritik</b>}
            {critCount > 0 && warnCount > 0 && ' · '}
            {warnCount > 0 && <b className="text-amber-600">{warnCount} uyarı</b>}
            {critCount === 0 && warnCount === 0 && <b className="text-emerald-600">her şey yeşil</b>}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
            title="Şimdi yenile (60 sn'de bir otomatik)"
          >
            <RefreshCw size={11} /> {lastFetchedAt ? lastFetchedAt.toLocaleTimeString('tr-TR') : '—'}
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error} (son başarılı veri gösteriliyor)</div>
      )}

      {/* ═ Dikkat gerektirenler — exception-first ═ */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
        <div className="mb-2 flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wide text-slate-400 dark:text-ndark-muted">
          <span>Dikkat gerektirenler</span><span className="font-medium normal-case tracking-normal">önce en kötüsü</span>
        </div>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
            <StatusDot level="ok" /> Şu an dikkat gerektiren bir durum yok — tüm göstergeler eşik altında.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {alerts.map((a, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                  a.level === 'crit'
                    ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
                    : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                }`}
              >
                <StatusDot level={a.level} />
                <span className="min-w-0 flex-1 font-medium">{a.text}</span>
                <span className="shrink-0 text-[10px] opacity-70">{a.hint}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═ 1 · Depolama ═ */}
      <SectionTitle n={1} title="Depolama & Kapasite" hint="ekler yerel diskte · DB ayrı yedeklenir" icon={<HardDrive size={13} />} />
      {health.storage?.error ? <SectionError error={health.storage.error} /> : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Ek Diski (STORAGE_ROOT)" level={diskLevel(health.storage.diskFreePct)} source="varuna">
            <Val sub={`${fmtBytes(health.storage.diskFreeBytes)} boş / ${fmtBytes(health.storage.diskTotalBytes)}`}>
              {health.storage.diskFreePct != null ? `%${health.storage.diskFreePct}` : '—'}<small className="ml-1 text-xs font-semibold text-slate-500">boş</small>
            </Val>
            {diskUsedPct != null && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-ndark-bg">
                <i className={`block h-full rounded-full ${diskLevel(health.storage.diskFreePct) === 'ok' ? 'bg-emerald-500' : diskLevel(health.storage.diskFreePct) === 'warn' ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${diskUsedPct}%` }} />
              </div>
            )}
            <Threshold text={`🟡 <%${TH.diskWarnPct} · 🔴 <%${TH.diskCritPct} boş`} />
          </Card>
          <Card label="Mail Ekleri" level="ok" source="varuna">
            <Val sub={`${health.storage.emailAttachmentCount.toLocaleString('tr-TR')} dosya`}>{fmtBytes(health.storage.emailAttachmentBytes)}</Val>
          </Card>
          <Card label="Vaka Dosyaları" level="ok" source="varuna">
            <Val sub={`${health.storage.caseAttachmentCount.toLocaleString('tr-TR')} dosya`}>{fmtBytes(health.storage.caseAttachmentBytes)}</Val>
          </Card>
          <Card label="Veritabanı (MSSQL)" level="ok" source="varuna">
            <Val sub={`log: ${health.db?.logFileMb ?? '—'} MB · ${health.db?.caseCount?.toLocaleString('tr-TR') ?? '—'} vaka · ${health.db?.caseEmailCount?.toLocaleString('tr-TR') ?? '—'} mail`}>
              {health.db?.dataFileMb ?? '—'}<small className="ml-1 text-xs font-semibold text-slate-500">MB data</small>
            </Val>
          </Card>
        </div>
      )}

      {/* ═ 2 · Mail ═ */}
      <SectionTitle n={2} title="Mail Altyapısı" hint={`${pollable} kutu poll ediliyor`} icon={<Mail size={13} />} />
      {health.mail?.error ? <SectionError error={health.mail.error} /> : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Döngü Dedektörü" level={health.mail.casesCreatedLast5m > TH.loopCritPer5m ? 'crit' : 'ok'} source="varuna">
            <Val sub="son 5 dk'da açılan vaka">{health.mail.casesCreatedLast5m}</Val>
            <Threshold text={`🔴 >${TH.loopCritPer5m}/5dk — 6 Tem olayı önlemi; alarm Zabbix'te`} />
          </Card>
          <Card label="Son Gelen Mail" level={health.mail.lastInboundAgeMin > TH.inboundStaleWarnMin ? 'warn' : 'ok'} source="varuna">
            <Val sub="mesai dışında doğal büyür">{fmtMin(health.mail.lastInboundAgeMin)} önce</Val>
            <Threshold text={`🟡 >${fmtMin(TH.inboundStaleWarnMin)}`} />
          </Card>
          <Card label="Trafik (24s)" level="ok" source="varuna">
            <Val sub={`giden: ${health.mail.outbound24h}`}>{health.mail.inbound24h}<small className="ml-1 text-xs font-semibold text-slate-500">gelen</small></Val>
          </Card>
          <Card label="Polling" level={health.mail.imapPollIntervalSec > 0 ? 'ok' : 'warn'} source="varuna">
            <Val sub={health.mail.imapPollIntervalSec > 0 ? `her ${health.mail.imapPollIntervalSec} sn` : 'kapalı (lokalde normal)'}>
              {pollable}<small className="ml-1 text-xs font-semibold text-slate-500">kutu</small>
            </Val>
            <div className="mt-1.5 text-[10px] text-slate-400 dark:text-ndark-muted">kutu-bazı son-poll izi: Faz 2.1</div>
          </Card>
        </div>
      )}

      {/* ═ 3 · Dispatch ═ */}
      <SectionTitle n={3} title="Bildirim / Dispatch Kuyruğu" icon={<Inbox size={13} />} />
      {health.dispatch?.error ? <SectionError error={health.dispatch.error} /> : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Card
            label="Pending Birikimi"
            level={health.dispatch.pendingCount > TH.pendingWarn ? 'warn' : 'ok'}
            source="varuna"
            onDrill={onOpenDispatches ? () => onOpenDispatches('Pending') : undefined}
            drillHint="Pending kayıtları gör"
          >
            <Val sub="sağlıklı sistemde ≈ 0 olmalı">{health.dispatch.pendingCount}</Val>
            <Threshold text={`🟡 >${TH.pendingWarn}`} />
          </Card>
          <Card
            label="En Eski Pending"
            level={health.dispatch.oldestPendingAgeMin > TH.oldestPendingWarnMin ? 'warn' : 'ok'}
            source="varuna"
            onDrill={onOpenDispatches ? () => onOpenDispatches('Pending') : undefined}
            drillHint="Pending kayıtları gör"
          >
            <Val sub="kuyruk ilerliyor mu?">{fmtMin(health.dispatch.oldestPendingAgeMin)}</Val>
            <Threshold text={`🟡 >${fmtMin(TH.oldestPendingWarnMin)}`} />
          </Card>
          <Card
            label="Failed (24s)"
            level={health.dispatch.failed24h > 0 ? 'warn' : 'ok'}
            source="varuna"
            onDrill={onOpenDispatches ? () => onOpenDispatches('Failed') : undefined}
            drillHint="Failed kayıtları gör"
          >
            <Val sub="gönderilemeyen bildirim">{health.dispatch.failed24h}</Val>
            <Threshold text="🟡 >0" />
          </Card>
        </div>
      )}

      {/* ═ 4 · Sunucu Kaynakları (Zabbix) ═ */}
      <SectionTitle n={4} title="Sunucu Kaynakları" hint="CPU / RAM / disk — Zabbix'ten okunur" icon={<Timer size={13} />} />
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-ndark-border dark:bg-ndark-card">
        {health.env?.zabbixConfigured ? (
          <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-ndark-muted">
            <StatusDot level="ok" />
            <div>
              <b className="text-slate-800 dark:text-ndark-text">Zabbix bağlantısı yapılandırılmış.</b> Makine kartları (CPU/RAM/disk gecikme, host bazında)
              Faz 2.1'de bu alana bağlanacak — IT'den host ID'leri bekleniyor.
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-ndark-muted">
            <StatusDot level="warn" />
            <div>
              <b className="text-slate-800 dark:text-ndark-text">Zabbix henüz yapılandırılmadı.</b> Kurulum ~15 dk: IT,
              <span className="mx-1 rounded bg-slate-100 px-1 py-px font-mono text-[10.5px] dark:bg-ndark-bg">docs/integrations/zabbix/README.md</span>
              adımlarını uygular (read-only kullanıcı + env). Yapılandırılınca makine kartları burada otomatik belirir;
              <b> uygulama alarmları</b> (döngü/kuyruk/disk) için de aynı README'deki template import edilir.
            </div>
          </div>
        )}
      </div>

      {/* ═ 5 · Uygulama & Cron ═ */}
      <SectionTitle n={5} title="Uygulama & Cron Sağlığı" icon={<ListChecks size={13} />} />
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Card label="Process Uptime" level="ok" source="varuna">
          <Val sub={`Node ${health.process?.nodeVersion ?? '—'}`}>{fmtUptime(health.process?.uptimeSec ?? 0)}</Val>
        </Card>
        <Card label="Bellek (RSS)" level="ok" source="varuna">
          <Val sub="Node süreci">{health.process?.memoryRssMb ?? '—'}<small className="ml-1 text-xs font-semibold text-slate-500">MB</small></Val>
        </Card>
        <Card label="Sunucu Saati (UTC)" level="ok" source="varuna">
          <Val sub="health örnekleme zamanı">{health.process?.serverTimeUtc ? new Date(health.process.serverTimeUtc).toLocaleTimeString('tr-TR') : '—'}</Val>
        </Card>
      </div>
      <div className="mt-2.5 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
        <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 dark:text-ndark-muted">Cron Görevleri — Son Çalışma <span className="ml-1 normal-case tracking-normal">(süreç restart'ında sıfırlanır)</span></div>
        {(health.crons ?? []).length === 0 ? (
          <div className="text-xs text-slate-500 dark:text-ndark-muted">
            Kayıt yok — cron scheduler bu süreçte kapalı olabilir (lokalde <span className="font-mono">CRON_SCHEDULER_ENABLED=false</span> normaldir).
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:border-ndark-border">
                <th className="px-2 py-1">Görev</th><th className="px-2 py-1">Zamanlama</th><th className="px-2 py-1">Son başlangıç</th><th className="px-2 py-1">Sonuç</th><th className="px-2 py-1">Durum</th>
              </tr>
            </thead>
            <tbody>
              {health.crons.map((c) => (
                <tr key={c.name} className="border-b border-slate-100 last:border-0 dark:border-ndark-border/50">
                  <td className="px-2 py-1.5 font-mono text-[11px] text-slate-700 dark:text-ndark-text">{c.name}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-slate-500">{c.expr}</td>
                  <td className="px-2 py-1.5 tabular-nums text-slate-600 dark:text-ndark-muted">{fmtAgo(c.lastStartAt)}</td>
                  <td className="max-w-[260px] truncate px-2 py-1.5 text-slate-500 dark:text-ndark-muted" title={c.note}>{c.note}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      cronLevel(c) === 'ok'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                    }`}>{c.ok === false ? 'HATA' : c.lastStartAt ? 'ÇALIŞIYOR' : 'BEKLEMEDE'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ═ 6 · Güvenlik & Yapılandırma ═ */}
      <SectionTitle n={6} title="Güvenlik & Yapılandırma" icon={<ShieldCheck size={13} />} />
      {health.env?.error ? <SectionError error={health.env.error} /> : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="APP_PUBLIC_BASE_URL" level={health.env.appPublicBaseUrlSet ? 'ok' : 'crit'} source="varuna">
            <Val sub="mail logo + vaka linki için zorunlu">{health.env.appPublicBaseUrlSet ? 'tanımlı ✓' : 'EKSİK'}</Val>
          </Card>
          <Card label="IMAP Polling" level={health.env.imapPollingEnabled ? 'ok' : 'warn'} source="varuna">
            <Val sub="gelen mail intake'i">{health.env.imapPollingEnabled ? 'açık ✓' : 'kapalı'}</Val>
          </Card>
          <Card label="STORAGE_ROOT" level={health.env.storageRootWritable ? 'ok' : 'crit'} source="varuna">
            <Val sub="ek yazma yeteneği">{health.env.storageRootWritable ? 'yazılabilir ✓' : 'YAZILAMAZ'}</Val>
          </Card>
          <Card label="Zabbix Entegrasyonu" level={health.env.zabbixConfigured ? 'ok' : 'warn'} source="zabbix">
            <Val sub="Yön B: makine metrikleri">{health.env.zabbixConfigured ? 'yapılandırılmış ✓' : 'kurulum bekliyor'}</Val>
          </Card>
        </div>
      )}

      {/* ═ altbilgi ═ */}
      <div className="mt-8 border-t border-slate-200 pt-3 text-center text-[10.5px] leading-relaxed text-slate-400 dark:border-ndark-border dark:text-ndark-muted">
        Bu sayfa yalnız <b>SystemAdmin</b> rolüne görünür · veriler salt-okur toplanır (20 sn sunucu cache + 60 sn yenileme)<br />
        Kaynaklar: <SourceChip kind="varuna" /> uygulama semantiği (health) · <SourceChip kind="zabbix" /> makine/OS metrikleri — <b>alarmlar Zabbix'te</b>, bu pano teşhis içindir<br />
        İş metrikleri (SLA, atanmamış vaka, yanıt bekleyenler) → Operasyon Panosu'nda
      </div>
    </div>
  );
}
