import { useEffect, useMemo, useState } from 'react';
import { Filter, Plus, RotateCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select, TextInput } from '@/components/ui/Field';
import { CaseTypeBadge, PriorityBadge, StatusPill } from '@/components/ui/StatusPill';
import { Badge } from '@/components/ui/Badge';
import { caseService } from '@/services/caseService';
import {
  CASE_PRIORITIES,
  CASE_STATUSES,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  type Case,
  type CaseFilters,
} from './types';
import { formatDateTime, formatRelative } from '@/lib/format';
import { CaseDetailDrawer } from './CaseDetailDrawer';
import { NewCaseForm } from './NewCaseForm';

export function CasesListPage() {
  const [items, setItems] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<CaseFilters>({ status: 'Tümü', caseType: 'Tümü', priority: 'Tümü' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const { items } = await caseService.list(filters);
    setItems(items);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.caseType, filters.priority, filters.search]);

  const stats = useMemo(() => {
    const total = items.length;
    const open = items.filter((c) => c.status !== 'Çözüldü' && c.status !== 'İptalEdildi').length;
    const slaBreach = items.filter((c) => c.slaViolation).length;
    const critical = items.filter((c) => c.priority === 'Critical').length;
    return { total, open, slaBreach, critical };
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Vakalar</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Müşteri talep, şikayet ve olaylarını tek listeden yönetin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" leftIcon={<RotateCw size={14} />} onClick={() => void load()}>
            Yenile
          </Button>
          <Button leftIcon={<Plus size={14} />} onClick={() => setNewOpen(true)}>
            Yeni Vaka
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Toplam Vaka" value={stats.total} tint="bg-slate-50 ring-slate-200 text-slate-700" />
        <KpiTile label="Açık Vaka"   value={stats.open}  tint="bg-sky-50 ring-sky-200 text-sky-700" />
        <KpiTile label="SLA İhlali"  value={stats.slaBreach} tint="bg-rose-50 ring-rose-200 text-rose-700" />
        <KpiTile label="Critical"    value={stats.critical}  tint="bg-amber-50 ring-amber-200 text-amber-800" />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <TextInput
              placeholder="Vaka no, başlık veya müşteri ara..."
              value={filters.search ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="pl-8"
            />
          </div>
          <FilterSelect
            label="Statü"
            value={filters.status ?? 'Tümü'}
            onChange={(v) => setFilters((f) => ({ ...f, status: v as CaseFilters['status'] }))}
            options={['Tümü', ...CASE_STATUSES]}
          />
          <FilterSelect
            label="Tip"
            value={filters.caseType ?? 'Tümü'}
            onChange={(v) => setFilters((f) => ({ ...f, caseType: v as CaseFilters['caseType'] }))}
            options={['Tümü', ...CASE_TYPES]}
            renderOption={(o) => (o === 'Tümü' ? 'Tümü' : CASE_TYPE_LABELS[o as keyof typeof CASE_TYPE_LABELS])}
          />
          <FilterSelect
            label="Öncelik"
            value={filters.priority ?? 'Tümü'}
            onChange={(v) => setFilters((f) => ({ ...f, priority: v as CaseFilters['priority'] }))}
            options={['Tümü', ...CASE_PRIORITIES]}
          />
          <Badge tint="slate" icon={<Filter size={12} />}>
            {items.length} sonuç
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <Th>Vaka No</Th>
                <Th>Başlık</Th>
                <Th>Müşteri</Th>
                <Th>Tip</Th>
                <Th>Statü</Th>
                <Th>Öncelik</Th>
                <Th>Atama</Th>
                <Th>SLA</Th>
                <Th>Açılış</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-sm text-slate-500">
                    Yükleniyor…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-sm text-slate-500">
                    Sonuç bulunamadı.
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className="cursor-pointer text-sm hover:bg-slate-50"
                  >
                    <Td className="font-mono text-xs text-slate-600">{c.caseNumber}</Td>
                    <Td className="max-w-[360px] truncate font-medium text-slate-800">{c.title}</Td>
                    <Td className="text-slate-700">{c.accountName}</Td>
                    <Td>
                      <CaseTypeBadge type={c.caseType} />
                    </Td>
                    <Td>
                      <StatusPill status={c.status} />
                    </Td>
                    <Td>
                      <PriorityBadge priority={c.priority} />
                    </Td>
                    <Td className="text-slate-700">
                      {c.assignedPersonName ?? c.assignedTeamName ?? <span className="text-slate-400">—</span>}
                    </Td>
                    <Td>
                      {c.slaViolation ? (
                        <Badge tint="rose">İhlal</Badge>
                      ) : c.slaPaused ? (
                        <Badge tint="amber">Duraklatıldı</Badge>
                      ) : c.slaResolutionDueAt ? (
                        <span className="text-xs text-slate-600">{formatRelative(c.slaResolutionDueAt)}</span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-500">{formatDateTime(c.createdAt)}</Td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      <CaseDetailDrawer
        caseId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => void load()}
      />
      <NewCaseForm
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(c) => {
          setNewOpen(false);
          setSelectedId(c.id);
          void load();
        }}
      />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-2.5">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-4 py-3 ${className ?? ''}`}>{children}</td>;
}

function KpiTile({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: string;
}) {
  return (
    <div className={`rounded-xl p-4 ring-1 ring-inset ${tint}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  renderOption,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  renderOption?: (o: string) => string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-slate-500">{label}:</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 py-1">
        {options.map((o) => (
          <option key={o} value={o}>
            {renderOption ? renderOption(o) : o}
          </option>
        ))}
      </Select>
    </div>
  );
}
