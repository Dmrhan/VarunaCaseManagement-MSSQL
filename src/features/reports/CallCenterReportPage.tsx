import { useCallback, useEffect, useMemo, useState } from 'react';
import { Phone, Download, RefreshCw, Loader2, ExternalLink, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { fetchCallReport, type CallReportRow, type CallReportSummary } from '@/services/softphoneService';

/**
 * Çağrı Merkezi Raporu — Supervisor / Admin / SystemAdmin.
 * Kaynak: CallLog (AloTech gelen çağrı webhook'u). Müşteri × ticket × agent × süre.
 * Gelen çağrıda IVR şifresinden çözülen müşteri + açılan ticket + AloTech süresi (CDR/
 * call-end) birleşir. Salt-okunur; /api/integrations/alotech/call-report'u tüketir.
 */
interface Props {
  onSelectCase: (id: string) => void;
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nextDay(iso: string): string {
  // Timezone-güvenli: yerel saatte new Date(...).toISOString() UTC'ye kayıp
  // (TR/UTC+3'te) günü BİR GÜN geri atıyordu → rapor son günü hariç tutuyordu.
  // Date.UTC ile saf tarih aritmetiği.
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
function fmtDur(sec?: number | null): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}dk ${s}sn` : `${s}sn`;
}
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function CallCenterReportPage({ onSelectCase }: Props) {
  const { toast } = useToast();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [agent, setAgent] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [rows, setRows] = useState<CallReportRow[]>([]);
  const [summary, setSummary] = useState<CallReportSummary[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchCallReport({ from, to: nextDay(to), agentEmail: agent.trim() || undefined });
      if (!r || !('rows' in r)) {
        setUnavailable(true);
        setRows([]);
        setSummary([]);
      } else {
        setUnavailable(false);
        setRows(r.rows);
        setSummary(r.summary);
      }
      setLoaded(true);
    } catch {
      toast({ type: 'error', message: 'Çağrı raporu alınamadı.' });
    } finally {
      setLoading(false);
    }
  }, [from, to, agent, toast]);

  useEffect(() => {
    void load();
    // yalnız ilk yüklemede; sonrası "Yenile" ile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kpi = useMemo(() => {
    const totalSec = rows.reduce((s, r) => s + (r.durationSec || 0), 0);
    const customers = new Set(rows.map((r) => r.matchedAccountId).filter(Boolean)).size;
    const tickets = new Set(rows.map((r) => r.caseId).filter(Boolean)).size;
    const agents = new Set(rows.map((r) => r.agentEmail).filter(Boolean)).size;
    return { calls: rows.length, totalMin: Math.round(totalSec / 60), customers, tickets, agents };
  }, [rows]);

  const exportExcel = () => {
    if (!rows.length) return;
    const wb = XLSX.utils.book_new();
    const sum = [
      ['Müşteri', 'Çağrı Sayısı', 'Toplam Dakika', 'Ticket Sayısı'],
      ...summary.map((s) => [s.accountName || '(eşleşmedi)', s.calls, s.totalMin, s.ticketCount]),
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(sum);
    ws1['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Özet');
    const det = [
      ['Tarih', 'Müşteri', 'Ticket', 'Proje', 'Agent', 'Yön', 'Süre (sn)', 'Durum', 'Arayan', 'CallID'],
      ...rows.map((r) => [
        fmtDateTime(r.startedAt), r.accountName || '', r.caseNumber || '', r.projectName || '',
        r.agentEmail || '', r.direction === 'outbound' ? 'Giden' : 'Gelen', r.durationSec || 0,
        r.status || '', r.callerId || '', r.callId,
      ]),
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(det);
    ws2['!cols'] = [{ wch: 15 }, { wch: 34 }, { wch: 14 }, { wch: 18 }, { wch: 22 }, { wch: 7 }, { wch: 9 }, { wch: 10 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Detay');
    XLSX.writeFile(wb, `Cagri_Merkezi_Raporu_${from}_${to}.xlsx`);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-ndark-card dark:text-ndark-link">
          <Phone size={20} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-800 dark:text-ndark-text">Çağrı Merkezi Raporu</h1>
          <p className="text-sm text-slate-500 dark:text-ndark-muted">Hangi müşteri × hangi ticket × hangi agent × kaç dakika (AloTech gelen çağrı kayıtları).</p>
        </div>
      </div>

      {/* Filtreler */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Başlangıç" className="w-40">
          <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Bitiş" className="w-40">
          <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Agent (e-posta)" className="w-56">
          <TextInput placeholder="opsiyonel" value={agent} onChange={(e) => setAgent(e.target.value)} />
        </Field>
        <Button size="sm" variant="primary" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          <span className="ml-1.5">Yenile</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={exportExcel} disabled={!rows.length}>
          <Download size={15} />
          <span className="ml-1.5">Excel</span>
        </Button>
      </div>

      {/* KPI */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Çağrı', value: kpi.calls },
          { label: 'Toplam dk', value: kpi.totalMin },
          { label: 'Müşteri', value: kpi.customers },
          { label: 'Ticket', value: kpi.tickets },
          { label: 'Agent', value: kpi.agents },
        ].map((k) => (
          <Card key={k.label}>
            <CardBody className="py-3">
              <div className="text-2xl font-semibold text-slate-800 dark:text-ndark-text">{k.value}</div>
              <div className="text-xs text-slate-500 dark:text-ndark-muted">{k.label}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      {unavailable ? (
        <Card><CardBody className="py-10 text-center text-sm text-slate-500 dark:text-ndark-muted">
          Çağrı raporu şu an kullanılamıyor (AloTech entegrasyonu yapılandırılmamış olabilir) ya da bu aralıkta kayıt yok.
        </CardBody></Card>
      ) : !loaded ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="animate-spin" /></div>
      ) : (
        <>
          {/* Özet — müşteri bazında */}
          <h2 className="mb-2 mt-2 text-sm font-semibold text-slate-700 dark:text-ndark-text">Müşteri Bazında Özet</h2>
          <Card className="mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-ndark-border dark:text-ndark-muted">
                  <tr><th className="px-4 py-2">Müşteri</th><th className="px-4 py-2 text-right">Çağrı</th><th className="px-4 py-2 text-right">Toplam dk</th><th className="px-4 py-2 text-right">Ticket</th></tr>
                </thead>
                <tbody>
                  {summary.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">Kayıt yok.</td></tr>
                  ) : summary.map((s) => (
                    <tr key={s.accountId ?? '(none)'} className="border-b border-slate-100 dark:border-ndark-border/60">
                      <td className="px-4 py-2 text-slate-700 dark:text-ndark-text">{s.accountName || <span className="text-slate-400">(eşleşmedi)</span>}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.calls}</td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums">{s.totalMin}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.ticketCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Detay — çağrı × ticket */}
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-ndark-text">Çağrı Detayı <span className="font-normal text-slate-400">({rows.length})</span></h2>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-ndark-border dark:text-ndark-muted">
                  <tr>
                    <th className="px-3 py-2">Tarih</th><th className="px-3 py-2">Müşteri</th><th className="px-3 py-2">Ticket</th>
                    <th className="px-3 py-2">Proje</th><th className="px-3 py-2">Agent</th><th className="px-3 py-2">Yön</th>
                    <th className="px-3 py-2 text-right">Süre</th><th className="px-3 py-2">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Bu aralıkta çağrı kaydı yok.</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 dark:border-ndark-border/60 dark:hover:bg-ndark-card/40">
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500 dark:text-ndark-muted">{fmtDateTime(r.startedAt)}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-ndark-text">{r.accountName || <span className="text-slate-400">{r.callerId || '—'}</span>}</td>
                      <td className="px-3 py-2">
                        {r.caseId && r.caseNumber ? (
                          <button type="button" onClick={() => onSelectCase(r.caseId as string)} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-ndark-link">
                            {r.caseNumber}<ExternalLink size={12} />
                          </button>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-500 dark:text-ndark-muted">{r.projectName || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500 dark:text-ndark-muted">{r.agentEmail || '—'}</td>
                      <td className="px-3 py-2">
                        {r.direction === 'outbound'
                          ? <Badge tint="slate" icon={<PhoneOutgoing size={11} />}>Giden</Badge>
                          : <Badge tint="blue" icon={<PhoneIncoming size={11} />}>Gelen</Badge>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtDur(r.durationSec)}</td>
                      <td className="px-3 py-2 text-slate-500 dark:text-ndark-muted">{r.status || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
