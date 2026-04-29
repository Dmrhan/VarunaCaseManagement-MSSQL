import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Search, Sparkles, X, Zap } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { CaseTypeBadge } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { caseService, lookupService, type NewCaseInput } from '@/services/caseService';
import {
  CASE_TYPES,
  CASE_TYPE_LABELS,
  type Case,
  type CaseType,
} from './types';

interface QuickCaseModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Case) => void;
  prefillAccountId?: string | null;
}

// Quick mode için sabit defaultlar — detaylar drawer'da düzenlenebilir
const QUICK_DEFAULTS = {
  description: '— Hızlı vaka açılışı, detaylar daha sonra eklenecek —',
  priority: 'Medium' as const,
  origin: 'Diğer' as const,
  originDescription: 'Hızlı vaka açılışı',
  companyId: 'COMP-PARAM',
  companyName: 'PARAM',
  category: 'Yazılım',
  subCategory: 'Raporlama',
  requestType: 'Talep' as const,
};

export function QuickCaseModal({ open, onClose, onCreated, prefillAccountId }: QuickCaseModalProps) {
  const accounts = useMemo(() => lookupService.accounts(), []);

  const [accountId, setAccountId] = useState('');
  const [caseType, setCaseType] = useState<CaseType>('GeneralSupport');
  const [title, setTitle] = useState('');
  const [accountQuery, setAccountQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setAccountId(prefillAccountId ?? '');
      setCaseType('GeneralSupport');
      setTitle('');
      setAccountQuery('');
      setErrors({});
      // Pre-fill varsa odak title'a, yoksa müşteri aramasına otomatik
      const t = window.setTimeout(() => {
        if (prefillAccountId) titleRef.current?.focus();
      }, 80);
      return () => window.clearTimeout(t);
    }
  }, [open, prefillAccountId]);

  const selectedAccount = accounts.find((a) => a.id === accountId);

  const filteredAccounts = useMemo(() => {
    const q = accountQuery.trim().toLowerCase();
    if (!q) return accounts.slice(0, 6);
    return accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')),
    );
  }, [accounts, accountQuery]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!accountId)        e.accountId = 'Müşteri seçilmeli';
    if (!title.trim())     e.title     = 'Vaka konusu zorunlu';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate() || !selectedAccount) return;
    setSubmitting(true);
    const input: NewCaseInput = {
      title: title.trim(),
      description: QUICK_DEFAULTS.description,
      caseType,
      priority: QUICK_DEFAULTS.priority,
      origin: QUICK_DEFAULTS.origin,
      originDescription: QUICK_DEFAULTS.originDescription,
      companyId: QUICK_DEFAULTS.companyId,
      companyName: QUICK_DEFAULTS.companyName,
      accountId: selectedAccount.id,
      accountName: selectedAccount.name,
      category: QUICK_DEFAULTS.category,
      subCategory: QUICK_DEFAULTS.subCategory,
      requestType: QUICK_DEFAULTS.requestType,
    };
    const created = await caseService.create(input);
    setSubmitting(false);
    onClose();
    toast({
      type: 'success',
      title: 'Hızlı vaka oluşturuldu',
      message: `${created.caseNumber} — ${created.title}`,
      duration: 6000,
      action: { label: 'Detayı Aç', onClick: () => onCreated(created) },
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-amber-500" />
          <span>Hızlı Vaka</span>
          <Badge tint="amber">3 alan</Badge>
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Sparkles size={12} />
            Detaylar sonra Vaka Detayında düzenlenebilir.
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Vazgeç
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Oluşturuluyor…' : 'Vakayı Aç'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Müşteri" required error={errors.accountId}>
          {selectedAccount ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-brand-300 bg-brand-50/40 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Building2 size={14} className="text-brand-600" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{selectedAccount.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {selectedAccount.phone}
                    {selectedAccount.contactPerson && ` · ${selectedAccount.contactPerson}`}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAccountId('');
                  setAccountQuery('');
                }}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Müşteriyi kaldır"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <TextInput
                  placeholder="İsim veya telefon ile ara…"
                  value={accountQuery}
                  onChange={(e) => setAccountQuery(e.target.value)}
                  className="pl-8"
                  autoFocus
                />
              </div>
              <ul className="max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white">
                {filteredAccounts.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-slate-500">Sonuç yok.</li>
                ) : (
                  filteredAccounts.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setAccountId(a.id);
                          setAccountQuery('');
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                      >
                        <Building2 size={12} className="text-slate-400" />
                        <span className="flex-1 truncate font-medium text-slate-800">{a.name}</span>
                        <span className="text-[11px] text-slate-500">{a.phone}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </Field>

        <Field label="Vaka Tipi" required>
          <div className="flex flex-wrap gap-1.5">
            {CASE_TYPES.map((t) => {
              const active = caseType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setCaseType(t)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                    active
                      ? 'bg-brand-600 text-white ring-brand-600'
                      : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {CASE_TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Vaka Konusu" required error={errors.title}>
          <TextInput
            ref={titleRef}
            placeholder="Kısa, özetleyici bir konu yaz…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
          />
        </Field>

        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          <div className="mb-1 font-medium text-slate-700">Otomatik atanan varsayılanlar</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <CaseTypeBadge type={caseType} />
            <Badge tint="slate">Öncelik: Orta</Badge>
            <Badge tint="slate">Şirket: PARAM</Badge>
            <Badge tint="slate">Origin: Diğer</Badge>
            <Badge tint="slate">Kategori: Yazılım / Raporlama</Badge>
            <Badge tint="slate">Talep Türü: Talep</Badge>
          </div>
        </div>
      </div>
    </Modal>
  );
}
