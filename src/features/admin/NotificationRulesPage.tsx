import { useEffect, useMemo, useState } from 'react';
import { Bell, Pencil, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import {
  notificationService,
  type AudienceRow,
  type AudienceType,
  type DispatchChannel,
  type NotificationEvent,
  type NotificationRule,
  type NotificationTemplate,
  type RuleCreateInput,
} from '@/services/notificationService';
import { lookupService } from '@/services/caseService';
import { AdminListLayout } from './AdminListLayout';
import { NOTIFICATION_RULES_HELP } from './helpContents';

const EVENT_OPTIONS: { value: NotificationEvent; label: string }[] = [
  { value: 'resolution_submitted', label: 'Çözüm onaya gönderildi' },
  { value: 'resolution_approved', label: 'Çözüm onaylandı' },
  { value: 'resolution_rejected', label: 'Çözüm reddedildi' },
  { value: 'case_closed', label: 'Vaka kapatıldı' },
  { value: 'case_reopened', label: 'Vaka yeniden açıldı' },
];

const AUDIENCE_TYPES: { value: AudienceType; label: string; needsTarget?: boolean }[] = [
  { value: 'assignee', label: 'Atanan kişi' },
  { value: 'team_lead', label: 'Takım Lideri' },
  { value: 'supervisor', label: 'Süpervizör' },
  { value: 'admin', label: 'Admin' },
  { value: 'customer_primary_contact', label: 'Müşteri (birincil kontak)' },
  { value: 'static_email', label: 'Sabit e-posta', needsTarget: true },
];

const CHANNEL_OPTIONS: { value: DispatchChannel; label: string }[] = [
  { value: 'InApp', label: 'In-App (uygulama içi)' },
  { value: 'Email', label: 'E-posta (Phase 2: log-only)' },
  { value: 'ManualTask', label: 'Manuel Görev (operatör halleder)' },
];

const MODE_OPTIONS = [
  { value: 'LogOnly' as const, label: 'LogOnly — sadece audit' },
  { value: 'Manual' as const, label: 'Manual — operatör onaylar' },
];

interface EditorState {
  mode: 'create' | 'edit';
  rule?: NotificationRule;
}

export function NotificationRulesPage() {
  const [items, setItems] = useState<NotificationRule[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [filterCompanyId, setFilterCompanyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    setError(null);
    const [rules, tpls] = await Promise.all([
      notificationService.listRules(),
      notificationService.listTemplates(),
    ]);
    if (rules) setItems(rules.value);
    else setError('Kurallar yüklenemedi.');
    if (tpls) setTemplates(tpls.value);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const companies = useMemo(() => lookupService.companies(), []);
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? id;

  const filtered = useMemo(() => {
    let arr = items;
    if (filterCompanyId) arr = arr.filter((p) => p.companyId === filterCompanyId);
    const q = search.trim().toLowerCase();
    if (!q) return arr;
    return arr.filter((p) =>
      [p.name, p.event, p.description ?? '', companyName(p.companyId), p.template?.name ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [items, search, filterCompanyId, companies]);

  async function handleToggleActive(r: NotificationRule) {
    const out = await notificationService.updateRule(r.id, { isActive: !r.isActive });
    if (out) {
      await refresh();
      toast({
        type: 'success',
        message: out.isActive ? 'Kural aktif edildi.' : 'Kural pasif edildi.',
        duration: 1800,
      });
    }
  }

  return (
    <>
      <AdminListLayout
        title="Bildirim Kuralları"
        description="Olay + Filtre + Hedef Kitle + Şablon + Kanal. Şu an yalnız LogOnly veya Manual mode; otomatik gönderim yok."
        count={filtered.length}
        searchPlaceholder="Ad, event veya şablona göre ara…"
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setEditor({ mode: 'create' })}
        addLabel="Yeni Kural"
        helpTitle={NOTIFICATION_RULES_HELP.title}
        helpSections={NOTIFICATION_RULES_HELP.sections}
        loading={loading}
        error={error}
        onRetry={() => void refresh()}
        filters={
          <div className="w-56">
            <CompanySelector value={filterCompanyId} onChange={setFilterCompanyId} allowAll label="Şirket filtresi" />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Bell size={28} />}
              title="Henüz kural yok"
              description="Önce şablon oluşturun, sonra kural ekleyin. Kural yoksa hiçbir event dispatch üretmez."
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-dim">
                <tr>
                  <th className="px-3 py-2">Ad</th>
                  <th className="px-3 py-2">Şirket</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Audience</th>
                  <th className="px-3 py-2">Şablon</th>
                  <th className="px-3 py-2">Kanal / Mode</th>
                  <th className="px-3 py-2 text-center">Aktif</th>
                  <th className="px-3 py-2 text-right">Eylem</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-ndark-border/60">
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-ndark-text">
                      <div>{r.name}</div>
                      {r.isMatchAll && Object.keys(r.conditions ?? {}).length === 0 && (
                        <Badge tint="amber">Her vakaya uygula</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-ndark-muted">{companyName(r.companyId)}</td>
                    <td className="px-3 py-2 text-xs">
                      <Badge tint="slate">{r.event}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.audience.map((a, i) => (
                          <Badge key={i} tint="slate">
                            {a.type}
                            {a.targetValue ? `=${a.targetValue}` : ''}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-ndark-muted">
                      {r.template?.name ?? '—'}
                      {r.template?.isCustomerFacing && <Badge tint="amber">Müşteriye gider</Badge>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tint="slate">{r.channel}</Badge>
                      <Badge tint={r.mode === 'Manual' ? 'amber' : 'slate'}>{r.mode}</Badge>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(r)}
                        className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-ndark-bg"
                      >
                        {r.isActive ? <Power size={14} className="text-emerald-600" /> : <PowerOff size={14} className="text-slate-400" />}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" leftIcon={<Pencil size={12} />} onClick={() => setEditor({ mode: 'edit', rule: r })}>
                        Düzenle
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminListLayout>

      {editor && (
        <RuleEditor
          mode={editor.mode}
          initial={editor.rule}
          templates={templates}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function RuleEditor({
  mode,
  initial,
  templates,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: NotificationRule;
  templates: NotificationTemplate[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [companyId, setCompanyId] = useState<string | null>(initial?.companyId ?? null);
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [event, setEvent] = useState<NotificationEvent>(initial?.event ?? 'resolution_approved');
  const [conditions, setConditions] = useState(initial?.conditions ?? {});
  const [isMatchAll, setIsMatchAll] = useState(initial?.isMatchAll ?? false);
  const [audience, setAudience] = useState<AudienceRow[]>(
    initial?.audience ?? [{ type: 'assignee' }],
  );
  const [templateId, setTemplateId] = useState(initial?.templateId ?? '');
  const [channel, setChannel] = useState<DispatchChannel>(initial?.channel ?? 'InApp');
  const [ruleMode, setRuleMode] = useState<'LogOnly' | 'Manual'>(
    (initial?.mode === 'Manual' ? 'Manual' : 'LogOnly') as 'LogOnly' | 'Manual',
  );
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 100));
  const [suppressMin, setSuppressMin] = useState(initial?.suppressDuplicateWithinMinutes?.toString() ?? '');
  const [rateLimit, setRateLimit] = useState(initial?.rateLimitPerHour?.toString() ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tenantTemplates = useMemo(
    () => (companyId ? templates.filter((t) => t.companyId === companyId) : []),
    [templates, companyId],
  );

  const conditionsEmpty = useMemo(
    () => Object.values(conditions).every((v) => !v),
    [conditions],
  );

  function setCondition(key: string, value: string) {
    setConditions((c) => {
      const next = { ...c };
      if (value) (next as Record<string, string>)[key] = value;
      else delete (next as Record<string, string>)[key];
      return next;
    });
  }

  function addAudience() {
    setAudience((a) => [...a, { type: 'assignee' }]);
  }
  function updateAudience(i: number, patch: Partial<AudienceRow>) {
    setAudience((a) => a.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function removeAudience(i: number) {
    setAudience((a) => a.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    setError(null);
    if (!companyId || !name.trim() || !templateId || audience.length === 0) {
      setError('Şirket, ad, audience ve şablon zorunlu.');
      return;
    }
    if (conditionsEmpty && !isMatchAll) {
      setError('Filtre vermediysen "Her vakaya uygula" onayını işaretle.');
      return;
    }
    setSaving(true);
    const payload: RuleCreateInput = {
      companyId,
      name: name.trim(),
      description: description.trim() || null,
      event,
      conditions,
      isMatchAll,
      audience,
      templateId,
      channel,
      mode: ruleMode,
      sortOrder: Number(sortOrder) || 100,
      suppressDuplicateWithinMinutes: suppressMin ? Number(suppressMin) : null,
      rateLimitPerHour: rateLimit ? Number(rateLimit) : null,
      isActive,
    };
    const r =
      mode === 'create'
        ? await notificationService.createRule(payload)
        : await notificationService.updateRule(initial!.id, payload);
    setSaving(false);
    if (r) await onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Yeni Bildirim Kuralı' : 'Kuralı Düzenle'}
      size="2xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      {error && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CompanySelector value={companyId} onChange={setCompanyId} required disabled={mode === 'edit'} />
        <Field label="Ad" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Açıklama">
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
        <Field label="Sıra">
          <TextInput type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
        <Field label="Event" required>
          <Select value={event} onChange={(e) => setEvent(e.target.value as NotificationEvent)}>
            {EVENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Şablon" required>
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={!companyId}>
            <option value="">{companyId ? 'Şablon seç…' : 'Önce şirket seç'}</option>
            {tenantTemplates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.key})</option>
            ))}
          </Select>
        </Field>
        <Field label="Kanal" required>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as DispatchChannel)}>
            {CHANNEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Mode" required>
          <Select value={ruleMode} onChange={(e) => setRuleMode(e.target.value as 'LogOnly' | 'Manual')}>
            {MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-6 border-t border-slate-200 pt-4 dark:border-ndark-border">
        <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-ndark-text">Eşleşme Filtresi</h3>
        <p className="mb-3 text-xs text-slate-500">Boş alanlar "tümü" sayılır. Hiç filtre vermezsen aşağıdaki onay zorunlu.</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Kategori (ID)">
            <TextInput value={conditions.category ?? ''} onChange={(e) => setCondition('category', e.target.value)} />
          </Field>
          <Field label="Alt Kategori (ID)">
            <TextInput value={conditions.subCategory ?? ''} onChange={(e) => setCondition('subCategory', e.target.value)} />
          </Field>
          <Field label="Öncelik">
            <Select value={conditions.priority ?? ''} onChange={(e) => setCondition('priority', e.target.value)}>
              <option value="">Tümü</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </Select>
          </Field>
          <Field label="Destek seviyesi">
            <Select value={conditions.supportLevel ?? ''} onChange={(e) => setCondition('supportLevel', e.target.value)}>
              <option value="">Tümü</option>
              <option value="Seviye1">Seviye1</option>
              <option value="Seviye2">Seviye2</option>
              <option value="Seviye3">Seviye3</option>
            </Select>
          </Field>
          <Field label="Takım (ID)">
            <TextInput value={conditions.teamId ?? ''} onChange={(e) => setCondition('teamId', e.target.value)} />
          </Field>
        </div>
        {conditionsEmpty && (
          <label className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${isMatchAll ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
            <input
              type="checkbox"
              className="mt-0.5"
              checked={isMatchAll}
              onChange={(e) => setIsMatchAll(e.target.checked)}
            />
            <span>
              <strong>Her vakaya uygula.</strong> Filtre belirtmediğin için bu kural <em>tüm</em> vakalarda
              eşleşecek — yanlışlıkla broadcast olmasın diye onay zorunlu.
            </span>
          </label>
        )}
      </div>

      <div className="mt-6 border-t border-slate-200 pt-4 dark:border-ndark-border">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">Hedef Kitle (Audience)</h3>
          <Button size="sm" variant="outline" leftIcon={<Plus size={12} />} onClick={addAudience}>
            Satır ekle
          </Button>
        </div>
        <div className="space-y-2">
          {audience.map((row, i) => {
            const type = AUDIENCE_TYPES.find((t) => t.value === row.type);
            return (
              <div key={i} className="flex items-end gap-2 rounded-md border border-slate-200 bg-slate-50/40 p-2 dark:border-ndark-border dark:bg-ndark-bg/40">
                <div className="flex-1">
                  <Select value={row.type} onChange={(e) => updateAudience(i, { type: e.target.value as AudienceType, targetValue: undefined })}>
                    {AUDIENCE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </Select>
                </div>
                {type?.needsTarget && (
                  <div className="flex-1">
                    <TextInput
                      placeholder="ornek@firma.com"
                      value={row.targetValue ?? ''}
                      onChange={(e) => updateAudience(i, { targetValue: e.target.value })}
                    />
                  </div>
                )}
                <Button size="sm" variant="ghost" leftIcon={<Trash2 size={12} />} onClick={() => removeAudience(i)} disabled={audience.length === 1}>
                  Sil
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 dark:border-ndark-border">
        <Field label="Tekrar bastırma (dakika)" hint="Aynı audience'a aynı şablonla bu pencerede 2. kayıt suppressed olur.">
          <TextInput type="number" value={suppressMin} onChange={(e) => setSuppressMin(e.target.value)} />
        </Field>
        <Field label="Saatlik üst sınır" hint="Bu kural saatte en fazla X kez tetiklenir.">
          <TextInput type="number" value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} />
        </Field>
        <Field label="Durum">
          <label className="flex items-center gap-2 pt-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span>Aktif</span>
          </label>
        </Field>
      </div>
    </Modal>
  );
}
