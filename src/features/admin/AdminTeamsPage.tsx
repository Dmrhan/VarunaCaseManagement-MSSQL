import { useEffect, useMemo, useState } from 'react';
import {
  Pencil,
  Power,
  PowerOff,
  Trash2,
  Users2,
  UserPlus,
  UserMinus,
  ArrowRightLeft,
} from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { CompanySelector } from '@/components/ui/CompanySelector';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import {
  adminService,
  type PersonInput,
  type TeamInput,
} from '@/services/adminService';
import { lookupService } from '@/services/caseService';
import type { CasePerson, CaseTeam } from '@/features/cases/types';
import { AdminListLayout } from './AdminListLayout';
import { TEAMS_HELP } from './helpContents';

export function AdminTeamsPage() {
  const [teams, setTeams] = useState<CaseTeam[]>([]);
  const [search, setSearch] = useState('');
  // Sayfa filtresi — null = tüm erişilebilir şirketler. Phase 5C.
  const [filterCompanyId, setFilterCompanyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [membersOf, setMembersOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // companyId → name map'i list kolonunda kullanılır.
  const companies = useMemo(() => lookupService.companies(), []);
  const companyNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies) m.set(c.id, c.name);
    return m;
  }, [companies]);
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = await adminService.teams.list();
      setTeams(list);
    } catch (e) {
      setError((e as Error).message ?? 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = teams;
    if (filterCompanyId) arr = arr.filter((t) => t.companyId === filterCompanyId);
    if (!q) return arr;
    return arr.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q),
    );
  }, [teams, search, filterCompanyId]);

  async function handleToggleActive(team: CaseTeam) {
    if (team.isActive) {
      const open = adminService.teams.usage(team.id).openCount;
      if (open > 0) {
        const ok = window.confirm(
          `"${team.name}" takımında ${open} açık vaka var. Pasifleştirilirse yeni vaka geçişlerinde dropdown'da görünmez (mevcut vakalardaki ad korunur). Devam edilsin mi?`,
        );
        if (!ok) return;
      }
    }
    const r = await adminService.teams.setActive(team.id, !team.isActive);
    if (r.ok) {
      await refresh();
      toast({
        type: 'success',
        message: r.item.isActive ? `"${r.item.name}" aktif edildi.` : `"${r.item.name}" pasif edildi.`,
        duration: 2000,
      });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  async function handleDelete(team: CaseTeam) {
    const u = adminService.teams.usage(team.id);
    if (u.memberCount > 0) {
      window.alert(
        `"${team.name}" takımında ${u.memberCount} üye var. Önce üyeleri başka takıma taşıyın veya pasifleştirin.`,
      );
      return;
    }
    if (u.openCount > 0) {
      window.alert(
        `"${team.name}" takımına atanmış ${u.openCount} açık vaka var. Önce vakaları başka takıma transfer edin.`,
      );
      return;
    }
    const msg =
      u.count > 0
        ? `"${team.name}" toplam ${u.count} (kapalı) vakada referans veriliyor. Silinince vakalardaki ad korunur. Devam edilsin mi?`
        : `"${team.name}" silinsin mi?`;
    if (!window.confirm(msg)) return;

    const r = await adminService.teams.remove(team.id);
    if (r.ok) {
      await refresh();
      toast({ type: 'warn', message: `"${team.name}" silindi.`, duration: 2500 });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  return (
    <>
      <AdminListLayout
        title="Takım Tanımları"
        description="Vaka atamasında kullanılan takım listesi ve takım üyeleri (kullanıcı yönetimi). Pasif takımlar yeni atamalarda görünmez."
        count={filtered.length}
        searchPlaceholder="Takım adı veya açıklamaya göre ara…"
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={() => setEditor({ mode: 'create' })}
        addLabel="Yeni Takım"
        helpTitle={TEAMS_HELP.title}
        helpSections={TEAMS_HELP.sections}
        loading={loading}
        error={error}
        onRetry={() => void refresh()}
        filters={
          <div className="w-56">
            <CompanySelector
              label="Şirket Filtresi"
              value={filterCompanyId}
              onChange={setFilterCompanyId}
              allowAll
            />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Users2 size={22} />}
              title={search ? 'Aramaya uyan takım yok' : 'Henüz takım yok'}
              description={
                search
                  ? 'Farklı bir terim deneyin.'
                  : 'İlk takımı oluşturarak başlayın.'
              }
              action={
                !search ? (
                  <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
                    Yeni Takım
                  </Button>
                ) : undefined
              }
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <Th>Takım</Th>
                  <Th>Şirket</Th>
                  <Th>Açıklama</Th>
                  <Th align="right">Üye</Th>
                  <Th align="right">Açık Vaka</Th>
                  <Th>Durum</Th>
                  <Th align="right">Aksiyon</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((t) => {
                  const u = adminService.teams.usage(t.id);
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <Td>
                        <div className="font-medium text-slate-800">{t.name}</div>
                        <div className="font-mono text-[10px] text-slate-400">{t.id}</div>
                      </Td>
                      <Td className="text-slate-600">
                        {companyNameById.get(t.companyId) ?? (
                          <span className="font-mono text-xs text-slate-400">{t.companyId}</span>
                        )}
                      </Td>
                      <Td className="text-slate-600">
                        {t.description ?? <span className="text-slate-400">—</span>}
                      </Td>
                      <Td align="right">
                        {u.memberCount > 0 ? (
                          <Badge tint="blue">{u.memberCount}</Badge>
                        ) : (
                          <span className="text-xs text-slate-400">0</span>
                        )}
                      </Td>
                      <Td align="right">
                        {u.openCount > 0 ? (
                          <Badge tint="amber">{u.openCount}</Badge>
                        ) : (
                          <span className="text-xs text-slate-400">0</span>
                        )}
                      </Td>
                      <Td>
                        {t.isActive ? (
                          <Badge tint="emerald">Aktif</Badge>
                        ) : (
                          <Badge tint="slate">Pasif</Badge>
                        )}
                      </Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setMembersOf(t.id)}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            title="Üyeleri yönet"
                          >
                            <Users2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditor({ mode: 'edit', id: t.id })}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            title="Düzenle"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleActive(t)}
                            className={`rounded p-1.5 hover:bg-slate-100 ${
                              t.isActive
                                ? 'text-amber-600 hover:text-amber-700'
                                : 'text-emerald-600 hover:text-emerald-700'
                            }`}
                            title={t.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                          >
                            {t.isActive ? <PowerOff size={14} /> : <Power size={14} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(t)}
                            className="rounded p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                            title="Sil"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminListLayout>

      <TeamEditModal
        open={editor !== null}
        mode={editor?.mode ?? 'create'}
        editingId={editor?.mode === 'edit' ? editor.id : null}
        onClose={() => setEditor(null)}
        onSaved={() => {
          void refresh();
        }}
      />

      <TeamMembersModal
        teamId={membersOf}
        onClose={() => {
          setMembersOf(null);
          void refresh();
        }}
      />
    </>
  );
}

// ----------------------------------------------------------------
// Team Edit Modal
// ----------------------------------------------------------------

function TeamEditModal({
  open,
  mode,
  editingId,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  editingId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Phase 5C — companyId zorunlu. lookupService.companies() user'ın
  // erişebildiği şirketler (bootstrap allowedCompanyIds scope'lu).
  // Default: kullanıcının ilk şirketi seçili — single-company Admin için
  // dropdown tek seçenekli ama valid form.
  const companies = useMemo(() => lookupService.companies(), []);
  const defaultCompanyId = companies[0]?.id ?? '';
  const [form, setForm] = useState<TeamInput>({
    name: '',
    description: '',
    companyId: defaultCompanyId,
    isActive: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && editingId) {
      let cancelled = false;
      void (async () => {
        const item = await adminService.teams.get(editingId);
        if (cancelled) return;
        if (item) {
          setForm({
            name: item.name,
            description: item.description ?? '',
            companyId: item.companyId,
            isActive: item.isActive,
          });
        }
      })();
      return () => {
        cancelled = true;
      };
    } else {
      setForm({
        name: '',
        description: '',
        companyId: defaultCompanyId,
        isActive: true,
      });
    }
  }, [open, mode, editingId, defaultCompanyId]);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    const trimmed: TeamInput = {
      name: form.name.trim(),
      description: form.description?.trim() || undefined,
      companyId: form.companyId,
      isActive: form.isActive,
    };

    const r =
      mode === 'create'
        ? await adminService.teams.create(trimmed)
        : editingId
          ? await adminService.teams.update(editingId, trimmed)
          : null;

    setSubmitting(false);

    if (!r) {
      setError('Takım bulunamadı.');
      return;
    }
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
    onClose();
    toast({
      type: 'success',
      message: mode === 'create'
        ? `"${r.item.name}" oluşturuldu.`
        : `"${r.item.name}" güncellendi.`,
      duration: 2500,
    });
  }

  // companyId zorunlu — backend 400 atar (Phase 5C).
  const canSubmit = form.name.trim().length > 0 && !!form.companyId && !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={mode === 'create' ? 'Yeni Takım' : 'Takımı Düzenle'}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {submitting ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <CompanySelector
          value={form.companyId || null}
          onChange={(id) => setForm((f) => ({ ...f, companyId: id ?? '' }))}
          required
          disabled={mode === 'edit'}
          hint={
            mode === 'edit'
              ? 'Var olan takımın şirketi değiştirilemez.'
              : undefined
          }
        />

        <Field label="Takım Adı" required>
          <TextInput
            autoFocus
            placeholder="ör. Destek Takımı"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) {
                e.preventDefault();
                void handleSave();
              }
            }}
          />
        </Field>

        <Field label="Açıklama" hint="Opsiyonel — takımın sorumluluk alanı">
          <TextArea
            placeholder="Bu takımın hangi vakaları çözdüğünü özetleyin…"
            value={form.description ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={2}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Aktif — yeni vaka atamalarında dropdown'da görünür
        </label>

        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------
// Team Members Modal — üye yönetimi
// ----------------------------------------------------------------

function TeamMembersModal({ teamId, onClose }: { teamId: string | null; onClose: () => void }) {
  const [team, setTeam] = useState<CaseTeam | null>(null);
  const [members, setMembers] = useState<CasePerson[]>([]);
  const [allTeams, setAllTeams] = useState<CaseTeam[]>([]);
  const [outsiders, setOutsiders] = useState<CasePerson[]>([]);
  const [personEditor, setPersonEditor] = useState<
    { mode: 'create'; teamId: string } | { mode: 'edit'; id: string } | null
  >(null);
  const { toast } = useToast();

  const open = teamId !== null;

  async function refresh() {
    if (!teamId) return;
    const [t, m, o, ts] = await Promise.all([
      adminService.teams.get(teamId),
      adminService.teams.members(teamId),
      adminService.persons.listOutsideTeam(teamId),
      adminService.teams.list(),
    ]);
    setTeam(t ?? null);
    setMembers(m);
    setOutsiders(o);
    setAllTeams(ts);
  }

  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, teamId]);

  async function handleAddExisting(personId: string) {
    if (!teamId || !personId) return;
    const r = await adminService.persons.moveToTeam(personId, teamId);
    if (r.ok) {
      await refresh();
      toast({ type: 'success', message: `"${r.item.name}" takıma eklendi.`, duration: 2000 });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  async function handleMoveOut(person: CasePerson, targetTeamId: string) {
    if (!targetTeamId || targetTeamId === person.teamId) return;
    const r = await adminService.persons.moveToTeam(person.id, targetTeamId);
    if (r.ok) {
      await refresh();
      const target = allTeams.find((t) => t.id === targetTeamId);
      toast({
        type: 'success',
        message: `"${r.item.name}", "${target?.name ?? targetTeamId}" takımına taşındı.`,
        duration: 2200,
      });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  async function handleRemovePerson(person: CasePerson) {
    const u = adminService.persons.usage(person.id);
    if (u.openCount > 0) {
      window.alert(
        `"${person.name}" kullanıcısına atanmış ${u.openCount} açık vaka var. Önce vakaları başka kullanıcıya transfer edin.`,
      );
      return;
    }
    const msg =
      u.count > 0
        ? `"${person.name}" toplam ${u.count} (kapalı) vakada referans veriliyor. Silinince vakalardaki ad korunur. Devam edilsin mi?`
        : `"${person.name}" silinsin mi?`;
    if (!window.confirm(msg)) return;

    const r = await adminService.persons.remove(person.id);
    if (r.ok) {
      await refresh();
      toast({ type: 'warn', message: `"${person.name}" silindi.`, duration: 2500 });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  async function handleTogglePersonActive(person: CasePerson) {
    const r = await adminService.persons.setActive(person.id, !person.isActive);
    if (r.ok) {
      await refresh();
      toast({
        type: 'success',
        message: r.item.isActive ? `"${r.item.name}" aktif edildi.` : `"${r.item.name}" pasif edildi.`,
        duration: 2000,
      });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  if (!open || !team) {
    return (
      <PersonEditModal
        editor={personEditor}
        onClose={() => setPersonEditor(null)}
        onSaved={() => {
          void refresh();
        }}
      />
    );
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={`${team.name} — Üye Yönetimi`}
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              Toplam {members.length} üye • {members.filter((m) => m.isActive).length} aktif
            </span>
            <Button variant="outline" onClick={onClose}>
              Kapat
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Yeni üye ekleme paneli */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Üye Ekle
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => setPersonEditor({ mode: 'create', teamId: team.id })}
              >
                <UserPlus size={14} className="mr-1" />
                Yeni Kullanıcı Oluştur
              </Button>
              <span className="text-xs text-slate-400">veya</span>
              <Select
                className="max-w-[260px]"
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) {
                    void handleAddExisting(v);
                    e.target.value = '';
                  }
                }}
              >
                <option value="">Mevcut kullanıcıdan seç…</option>
                {outsiders.length === 0 ? (
                  <option disabled>(Başka takımda kullanıcı yok)</option>
                ) : (
                  outsiders.map((p) => {
                    const tName = allTeams.find((t) => t.id === p.teamId)?.name ?? p.teamId;
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} — {tName}
                      </option>
                    );
                  })
                )}
              </Select>
            </div>
          </div>

          {/* Üye listesi */}
          {members.length === 0 ? (
            <EmptyState
              icon={<Users2 size={22} />}
              title="Bu takımda üye yok"
              description="Yukarıdan yeni kullanıcı oluşturun veya başka takımdan transfer edin."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <Th>Kullanıcı</Th>
                    <Th>E-posta</Th>
                    <Th align="right">Açık Vaka</Th>
                    <Th>Durum</Th>
                    <Th align="right">Aksiyon</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.map((p) => {
                    const u = adminService.persons.usage(p.id);
                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <Td>
                          <div className="font-medium text-slate-800">{p.name}</div>
                          <div className="font-mono text-[10px] text-slate-400">{p.id}</div>
                        </Td>
                        <Td className="text-slate-600">
                          {p.email ?? <span className="text-slate-400">—</span>}
                        </Td>
                        <Td align="right">
                          {u.openCount > 0 ? (
                            <Badge tint="amber">{u.openCount}</Badge>
                          ) : (
                            <span className="text-xs text-slate-400">0</span>
                          )}
                        </Td>
                        <Td>
                          {p.isActive ? (
                            <Badge tint="emerald">Aktif</Badge>
                          ) : (
                            <Badge tint="slate">Pasif</Badge>
                          )}
                        </Td>
                        <Td align="right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setPersonEditor({ mode: 'edit', id: p.id })}
                              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                              title="Düzenle"
                            >
                              <Pencil size={14} />
                            </button>
                            <MoveToTeamButton
                              currentTeamId={team.id}
                              teams={allTeams}
                              onSelect={(targetId) => void handleMoveOut(p, targetId)}
                            />
                            <button
                              type="button"
                              onClick={() => void handleTogglePersonActive(p)}
                              className={`rounded p-1.5 hover:bg-slate-100 ${
                                p.isActive
                                  ? 'text-amber-600 hover:text-amber-700'
                                  : 'text-emerald-600 hover:text-emerald-700'
                              }`}
                              title={p.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                            >
                              {p.isActive ? <PowerOff size={14} /> : <Power size={14} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRemovePerson(p)}
                              className="rounded p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                              title="Sil"
                            >
                              <UserMinus size={14} />
                            </button>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <PersonEditModal
        editor={personEditor}
        onClose={() => setPersonEditor(null)}
        onSaved={() => {
          void refresh();
        }}
      />
    </>
  );
}

// ----------------------------------------------------------------
// Move-to-team inline dropdown (within member row)
// ----------------------------------------------------------------

function MoveToTeamButton({
  currentTeamId,
  teams,
  onSelect,
}: {
  currentTeamId: string;
  teams: CaseTeam[];
  onSelect: (targetTeamId: string) => void;
}) {
  const others = teams.filter((t) => t.id !== currentTeamId);
  return (
    <div className="relative inline-flex items-center">
      <Select
        className="h-7 max-w-[120px] py-0 pl-2 pr-7 text-xs"
        defaultValue=""
        title="Başka takıma taşı"
        onChange={(e) => {
          const v = e.target.value;
          if (v) {
            onSelect(v);
            e.target.value = '';
          }
        }}
      >
        <option value="">
          {/* göstermelik label */}
          ⇄ Taşı
        </option>
        {others.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      {/* visual hint icon overlay (decoration only) */}
      <ArrowRightLeft
        size={12}
        className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400"
      />
    </div>
  );
}

// ----------------------------------------------------------------
// Person Edit Modal — yeni kullanıcı veya mevcut kullanıcı düzenleme
// ----------------------------------------------------------------

function PersonEditModal({
  editor,
  onClose,
  onSaved,
}: {
  editor: { mode: 'create'; teamId: string } | { mode: 'edit'; id: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = editor !== null;
  const [form, setForm] = useState<PersonInput>({
    name: '',
    teamId: '',
    email: '',
    isActive: true,
  });
  const [teams, setTeams] = useState<CaseTeam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open || !editor) return;
    setError(null);
    let cancelled = false;
    void (async () => {
      const ts = await adminService.teams.list();
      if (cancelled) return;
      setTeams(ts);
      if (editor.mode === 'edit') {
        const p = await adminService.persons.get(editor.id);
        if (cancelled) return;
        if (p) {
          setForm({
            name: p.name,
            teamId: p.teamId,
            email: p.email ?? '',
            isActive: p.isActive,
          });
        }
      } else {
        setForm({ name: '', teamId: editor.teamId, email: '', isActive: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editor]);

  async function handleSave() {
    if (!editor) return;
    setSubmitting(true);
    setError(null);
    const trimmed: PersonInput = {
      name: form.name.trim(),
      teamId: form.teamId,
      email: form.email?.trim() || undefined,
      isActive: form.isActive,
    };

    const r =
      editor.mode === 'create'
        ? await adminService.persons.create(trimmed)
        : await adminService.persons.update(editor.id, trimmed);

    setSubmitting(false);

    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
    onClose();
    toast({
      type: 'success',
      message: editor.mode === 'create'
        ? `"${r.item.name}" oluşturuldu.`
        : `"${r.item.name}" güncellendi.`,
      duration: 2200,
    });
  }

  const canSubmit = form.name.trim().length > 0 && !!form.teamId && !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={editor?.mode === 'create' ? 'Yeni Kullanıcı' : 'Kullanıcıyı Düzenle'}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {submitting ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Ad Soyad" required>
          <TextInput
            autoFocus
            placeholder="ör. Ayşe Yılmaz"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>

        <Field label="Takım" required>
          <Select
            value={form.teamId}
            onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value }))}
          >
            <option value="">Takım seçin…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {!t.isActive ? ' (pasif)' : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="E-posta" hint="Opsiyonel — bildirim ve atama için">
          <TextInput
            type="email"
            placeholder="ad.soyad@param.com.tr"
            value={form.email ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Aktif — yeni vaka atamalarında dropdown'da görünür
        </label>

        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------
// Tablo helpers
// ----------------------------------------------------------------

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`whitespace-nowrap px-4 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      className={`whitespace-nowrap px-4 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'} ${className ?? ''}`}
    >
      {children}
    </td>
  );
}
