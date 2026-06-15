import { useEffect, useMemo, useState } from 'react';
import { Pencil, Power, PowerOff, ShieldCheck } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import {
  approvalService,
  type ApproverType,
  type PolicyCreateInput,
  type RejectionBehavior,
  type ResolutionApprovalPolicy,
} from '@/services/approvalService';
import { adminService } from '@/services/adminService';
import { lookupService } from '@/services/caseService';
import type { CasePerson } from '@/features/cases/types';
import { AdminListLayout } from './AdminListLayout';
import { RESOLUTION_APPROVAL_POLICIES_HELP } from './helpContents';

/**
 * WR-D4 Phase 1 — Çözüm Onayı Politikaları yönetim ekranı.
 *
 * Admin/SystemAdmin per-tenant politika tanımlar. matchScope JSON şeması Phase 1
 * için 5 anahtarla sınırlıdır (category/subCategory/priority/supportLevel/teamId);
 * BE whitelist enforce eder.
 *
 * Phase 1 deliberate constraints:
 *  - Politika silme yok (audit invariant); aktif/pasif toggle yeterli
 *  - SpecificPerson dropdown'u tüm Person'ları gösterir; BE create'te
 *    kişinin team.companyId == policy.companyId olduğunu doğrular
 *  - Önizleme / "kaç vakaya eşleşir" simülasyonu deferred (Phase 2)
 */

const APPROVER_TYPES: { value: ApproverType; label: string }[] = [
  { value: 'TeamLead', label: 'Takım Lideri (atanan takımın)' },
  { value: 'AssignedTeamLead', label: 'Atanan Takımın Lideri' },
  { value: 'Supervisor', label: 'Süpervizör' },
  { value: 'Admin', label: 'Admin' },
  { value: 'SystemAdmin', label: 'Sistem Admin' },
  { value: 'SpecificPerson', label: 'Belirli Bir Kişi' },
];

const REJECTION_BEHAVIORS: { value: RejectionBehavior; label: string }[] = [
  { value: 'ReturnToAssignee', label: 'Atayana iade et' },
  { value: 'ReturnToTeam', label: 'Takıma iade et (atayan kişiyi kaldır)' },
  { value: 'Escalate', label: 'Eskalasyona al (Seviye 1)' },
];

interface EditorState {
  mode: 'create' | 'edit';
  policy?: ResolutionApprovalPolicy;
}

export function ResolutionApprovalPoliciesPage() {
  const { user } = useAuth();
  const isSystemAdmin = user?.role === 'SystemAdmin';
  const [items, setItems] = useState<ResolutionApprovalPolicy[]>([]);
  const [persons, setPersons] = useState<CasePerson[]>([]);
  const [search, setSearch] = useState('');
  const [filterCompanyId, setFilterCompanyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    setError(null);
    const r = await approvalService.listPolicies();
    if (r) {
      setItems(r.value);
    } else {
      setError('Politikalar yüklenemedi.');
    }
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // Persons yan veri olarak yüklenir — SpecificPerson dropdown'ı için.
    void adminService.persons.list().then(setPersons).catch(() => setPersons([]));
  }, []);

  const companies = useMemo(() => lookupService.companies(), []);
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? id;

  const filtered = useMemo(() => {
    let arr = items;
    if (filterCompanyId) arr = arr.filter((p) => p.companyId === filterCompanyId);
    const q = search.trim().toLowerCase();
    if (!q) return arr;
    return arr.filter((p) =>
      [p.name, p.description ?? '', companyName(p.companyId), p.approverType]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [items, search, filterCompanyId, companies]);

  async function handleToggleActive(p: ResolutionApprovalPolicy) {
    const r = await approvalService.updatePolicy(p.id, { isActive: !p.isActive });
    if (r) {
      await refresh();
      toast({
        type: 'success',
        message: r.isActive ? 'Politika aktif edildi.' : 'Politika pasif edildi.',
        duration: 2000,
      });
    }
  }

  if (!isSystemAdmin && user?.role !== 'Admin') {
    return (
      <EmptyState
        icon={<ShieldCheck size={28} />}
        title="Yetki yok"
        description="Bu alan yalnızca Admin / SystemAdmin için."
      />
    );
  }

  return (
    <>
      <AdminListLayout
        title="Çözüm Onayı Politikaları"
        description="Hangi vakaların kapanmadan önce onaylanması gerektiğini ve kimin onaylayacağını tanımlar."
        count={filtered.length}
        searchPlaceholder="Politika adı, açıklama, şirket veya onaylayıcı tipine göre ara…"
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setEditor({ mode: 'create' })}
        addLabel="Yeni Politika"
        helpTitle={RESOLUTION_APPROVAL_POLICIES_HELP.title}
        helpSections={RESOLUTION_APPROVAL_POLICIES_HELP.sections}
        loading={loading}
        error={error}
        onRetry={() => void refresh()}
        filters={
          <div className="w-56">
            <CompanySelector
              value={filterCompanyId}
              onChange={setFilterCompanyId}
              allowAll
              label="Şirket filtresi"
            />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<ShieldCheck size={28} />}
              title="Henüz politika yok"
              description='"Yeni Politika" ile başla. Politika yoksa hiçbir vaka için onay zorunlu değildir.'
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-dim">
                <tr>
                  <th className="px-3 py-2">Ad</th>
                  <th className="px-3 py-2">Şirket</th>
                  <th className="px-3 py-2">Onaylayıcı</th>
                  <th className="px-3 py-2">Kapsam</th>
                  <th className="px-3 py-2">Red Davranışı</th>
                  <th className="px-3 py-2 text-center">Aktif</th>
                  <th className="px-3 py-2 text-right">Eylem</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const scope = p.matchScope || {};
                  const scopeChips = Object.entries(scope)
                    .filter(([, v]) => !!v)
                    .map(([k, v]) => `${k}=${v}`);
                  return (
                    <tr key={p.id} className="border-b border-slate-100 dark:border-ndark-border/60">
                      <td className="px-3 py-2 font-medium text-slate-800 dark:text-ndark-text">
                        <div>{p.name}</div>
                        {p.description && (
                          <div className="text-xs text-slate-500 dark:text-ndark-muted">{p.description}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-ndark-muted">
                        {companyName(p.companyId)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-slate-700 dark:text-ndark-text">{labelForApprover(p)}</div>
                        {p.allowSelfApprove && (
                          <Badge tint="amber">Kendi çözümünü onaylayabilir</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {scopeChips.length === 0 ? (
                          <span className="text-xs text-slate-400">Tümü</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {scopeChips.map((c) => (
                              <Badge key={c} tint="slate">
                                {c}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-ndark-muted">
                        {REJECTION_BEHAVIORS.find((b) => b.value === p.rejectionBehavior)?.label ??
                          p.rejectionBehavior}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => void handleToggleActive(p)}
                          className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-ndark-bg"
                          title={p.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                        >
                          {p.isActive ? (
                            <Power size={14} className="text-emerald-600" />
                          ) : (
                            <PowerOff size={14} className="text-slate-400" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          leftIcon={<Pencil size={12} />}
                          onClick={() => setEditor({ mode: 'edit', policy: p })}
                        >
                          Düzenle
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminListLayout>

      {editor && (
        <PolicyEditor
          mode={editor.mode}
          initial={editor.policy}
          persons={persons}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
          }}
        />
      )}
    </>
  );

  function labelForApprover(p: ResolutionApprovalPolicy) {
    if (p.approverType === 'SpecificPerson') {
      const person = persons.find((x) => x.id === p.approverPersonId);
      return `${APPROVER_TYPES.find((t) => t.value === p.approverType)?.label} — ${person?.name ?? '?'}`;
    }
    return APPROVER_TYPES.find((t) => t.value === p.approverType)?.label ?? p.approverType;
  }
}

function PolicyEditor({
  mode,
  initial,
  persons,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: ResolutionApprovalPolicy;
  persons: CasePerson[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [companyId, setCompanyId] = useState<string | null>(initial?.companyId ?? null);
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 100));
  const [approverType, setApproverType] = useState<ApproverType>(
    initial?.approverType ?? 'AssignedTeamLead',
  );
  const [approverPersonId, setApproverPersonId] = useState<string>(initial?.approverPersonId ?? '');
  const [allowSelfApprove, setAllowSelfApprove] = useState(initial?.allowSelfApprove ?? false);
  const [rejectionBehavior, setRejectionBehavior] = useState<RejectionBehavior>(
    initial?.rejectionBehavior ?? 'ReturnToAssignee',
  );
  const [category, setCategory] = useState(initial?.matchScope?.category ?? '');
  const [subCategory, setSubCategory] = useState(initial?.matchScope?.subCategory ?? '');
  const [priority, setPriority] = useState(initial?.matchScope?.priority ?? '');
  const [supportLevel, setSupportLevel] = useState(initial?.matchScope?.supportLevel ?? '');
  const [teamId, setTeamId] = useState(initial?.matchScope?.teamId ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!companyId) return;
    if (!name.trim()) return;
    setSaving(true);
    const matchScope: PolicyCreateInput['matchScope'] = {};
    if (category.trim()) matchScope.category = category.trim();
    if (subCategory.trim()) matchScope.subCategory = subCategory.trim();
    if (priority.trim()) matchScope.priority = priority.trim();
    if (supportLevel.trim()) matchScope.supportLevel = supportLevel.trim();
    if (teamId.trim()) matchScope.teamId = teamId.trim();

    const payload: PolicyCreateInput = {
      companyId,
      name: name.trim(),
      description: description.trim() || null,
      isActive,
      sortOrder: Number(sortOrder) || 100,
      matchScope,
      approverType,
      approverPersonId: approverType === 'SpecificPerson' ? approverPersonId || null : null,
      allowSelfApprove,
      rejectionBehavior,
    };

    const r =
      mode === 'create'
        ? await approvalService.createPolicy(payload)
        : await approvalService.updatePolicy(initial!.id, payload);
    setSaving(false);
    if (r) await onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Yeni Çözüm Onayı Politikası' : 'Politikayı Düzenle'}
      size="xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={saving || !companyId || !name.trim()}
          >
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CompanySelector
          value={companyId}
          onChange={setCompanyId}
          required
          disabled={mode === 'edit'}
          hint={mode === 'edit' ? 'Şirket değiştirilemez.' : undefined}
        />
        <Field label="Politika adı" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. Yüksek öncelik onayı" />
        </Field>
        <Field label="Açıklama" hint="Operatöre niye onay gerektiğini hatırlatır.">
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </Field>
        <Field label="Sıra" hint="Düşük değer = daha önce eşleşir.">
          <TextInput
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </Field>
        <Field label="Onaylayıcı tipi" required>
          <Select
            value={approverType}
            onChange={(e) => setApproverType(e.target.value as ApproverType)}
          >
            {APPROVER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        {approverType === 'SpecificPerson' && (
          <Field label="Belirli kişi" required>
            <Select
              value={approverPersonId}
              onChange={(e) => setApproverPersonId(e.target.value)}
            >
              <option value="">Kişi seç…</option>
              {persons
                .filter((p) => p.isActive)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label="Red davranışı" required>
          <Select
            value={rejectionBehavior}
            onChange={(e) => setRejectionBehavior(e.target.value as RejectionBehavior)}
          >
            {REJECTION_BEHAVIORS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Self-approval" hint="Açıkken atayan kendi çözümünü onaylayabilir.">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowSelfApprove}
              onChange={(e) => setAllowSelfApprove(e.target.checked)}
            />
            <span>Kendi çözümünü onaylayabilir</span>
          </label>
        </Field>
        <Field label="Durum">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>Aktif</span>
          </label>
        </Field>
      </div>

      <div className="mt-6 border-t border-slate-200 pt-4 dark:border-ndark-border">
        <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-ndark-text">
          Eşleşme Kapsamı
        </h3>
        <p className="mb-3 text-xs text-slate-500 dark:text-ndark-muted">
          Boş bırakılan alanlar "tümü" sayılır. Aynı şirkette birden fazla politika
          varsa daha spesifik olan kazanır; eşitlikte sıra ve oluşturma tarihi belirler.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Kategori (ID)">
            <TextInput value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label="Alt Kategori (ID)">
            <TextInput value={subCategory} onChange={(e) => setSubCategory(e.target.value)} />
          </Field>
          <Field label="Öncelik">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">Tümü</option>
              <option value="Critical">Kritik</option>
              <option value="High">Yüksek</option>
              <option value="Medium">Orta</option>
              <option value="Low">Düşük</option>
            </Select>
          </Field>
          <Field label="Destek seviyesi">
            <Select value={supportLevel} onChange={(e) => setSupportLevel(e.target.value)}>
              <option value="">Tümü</option>
              <option value="Seviye1">Seviye1</option>
              <option value="Seviye2">Seviye2</option>
              <option value="Seviye3">Seviye3</option>
            </Select>
          </Field>
          <Field label="Takım (ID)">
            <TextInput value={teamId} onChange={(e) => setTeamId(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
