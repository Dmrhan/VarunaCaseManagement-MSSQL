import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BookOpen,
  CheckSquare,
  Clock,
  FileText,
  Pencil,
  PenLine,
  Power,
  PowerOff,
} from 'lucide-react';
import { CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/services/AuthContext';
import {
  adminService,
  type KnowledgeSource,
  type KnowledgeSourceInput,
  type KnowledgeSourceType,
} from '@/services/adminService';
import { formatDateTime, formatRelative } from '@/lib/format';
import { AdminListLayout } from './AdminListLayout';

/**
 * Faz 1.5 Madde 6 — Bilgi Kaynakları Kayıt Defteri.
 *
 * "AI neye bakıyor?" şeffaflığı. Read-only liste + manuel kayıt ekleme.
 * Otomatik ingestion/embedding YOK; sadece kaynak kataloğu.
 *
 * Auto-populate: ilk açılışta backend 4 default kaynak yaratır
 * (Geçmiş Vakalar, Kategori Tanımları, SLA Kuralları, Kontrol Listeleri).
 *
 * Erişim: Admin / SystemAdmin (AdminLayout role guard'ı zaten yapıyor).
 * Backend: companyId scope + per-company assertCompanyAdmin guard.
 */

const TYPE_META: Record<
  KnowledgeSourceType,
  { label: string; icon: React.ReactNode; tint: string; tintDark: string }
> = {
  PastCases: {
    label: 'Geçmiş Vakalar',
    icon: <Archive size={16} />,
    tint: 'bg-blue-50 text-blue-700 ring-blue-200',
    tintDark: 'dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-900/50',
  },
  ProductDocs: {
    label: 'Ürün Dokümanları',
    icon: <FileText size={16} />,
    tint: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    tintDark: 'dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900/50',
  },
  SLARules: {
    label: 'SLA Kuralları',
    icon: <Clock size={16} />,
    tint: 'bg-amber-50 text-amber-700 ring-amber-200',
    tintDark: 'dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/50',
  },
  Checklists: {
    label: 'Kontrol Listeleri',
    icon: <CheckSquare size={16} />,
    tint: 'bg-violet-50 text-violet-700 ring-violet-200',
    tintDark: 'dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-900/50',
  },
  ManualEntry: {
    label: 'Manuel Giriş',
    icon: <PenLine size={16} />,
    tint: 'bg-slate-50 text-slate-700 ring-slate-200',
    tintDark: 'dark:bg-slate-900/40 dark:text-slate-200 dark:ring-slate-700/50',
  },
};

export function AdminKnowledgeSourcesPage() {
  const { user } = useAuth();
  const canCreate = !!user && (user.role === 'Admin' || user.role === 'SystemAdmin');

  const [items, setItems] = useState<KnowledgeSource[]>([]);
  const [search, setSearch] = useState('');
  const [editor, setEditor] =
    useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = await adminService.knowledgeSources.list();
      setItems(list);
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
    const q = search.trim().toLocaleLowerCase('tr');
    if (!q) return items;
    return items.filter(
      (k) =>
        k.name.toLocaleLowerCase('tr').includes(q) ||
        (k.description ?? '').toLocaleLowerCase('tr').includes(q) ||
        (TYPE_META[k.sourceType]?.label.toLocaleLowerCase('tr') ?? '').includes(q),
    );
  }, [items, search]);

  async function handleToggleActive(item: KnowledgeSource) {
    const r = await adminService.knowledgeSources.setActive(item.id, !item.isActive);
    if (r.ok) {
      await refresh();
      toast({
        type: 'success',
        message: r.item.isActive
          ? `"${r.item.name}" aktif edildi.`
          : `"${r.item.name}" pasif edildi.`,
        duration: 2000,
      });
    } else {
      toast({ type: 'error', message: r.error });
    }
  }

  return (
    <>
      <AdminListLayout
        title="Bilgi Kaynakları"
        description={`AI'ın hangi veriden beslendiğini şeffaf gösterir. Yeni kaynak eklendiğinde admin paneline kayıt düşer; otomatik ingestion yok — sadece envanter.`}
        count={filtered.length}
        searchEnabled
        searchPlaceholder="Ad, açıklama veya tür..."
        searchValue={search}
        onSearchChange={setSearch}
        onAdd={canCreate ? () => setEditor({ mode: 'create' }) : undefined}
        addLabel="Yeni Kaynak"
        loading={loading}
        error={error}
        onRetry={refresh}
      >
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<BookOpen size={22} />}
              title={search ? 'Eşleşen kaynak yok' : 'Henüz bilgi kaynağı tanımlanmamış'}
              description={
                search
                  ? 'Aramayı temizleyin.'
                  : 'İlk açılışta otomatik 4 default kaynak yaratılır. Görünmüyorsa sayfa yeniden yükleyin.'
              }
            />
          </CardBody>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
            {filtered.map((src) => (
              <SourceCard
                key={src.id}
                item={src}
                onEdit={() => setEditor({ mode: 'edit', id: src.id })}
                onToggleActive={() => void handleToggleActive(src)}
              />
            ))}
          </div>
        )}
      </AdminListLayout>

      {editor && (
        <SourceEditor
          mode={editor.mode}
          existing={editor.mode === 'edit' ? items.find((k) => k.id === editor.id) : null}
          onClose={() => setEditor(null)}
          onSaved={async (msg) => {
            setEditor(null);
            await refresh();
            toast({ type: 'success', message: msg });
          }}
        />
      )}
    </>
  );
}

function SourceCard({
  item,
  onEdit,
  onToggleActive,
}: {
  item: KnowledgeSource;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  const meta = TYPE_META[item.sourceType] ?? TYPE_META.ManualEntry;
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-4 ring-1 ring-slate-100 transition hover:border-slate-300 dark:border-ndark-border dark:bg-ndark-card dark:ring-ndark-border/50 dark:hover:border-ndark-muted ${
        !item.isActive ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${meta.tint} ${meta.tintDark}`}
        >
          {meta.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-base font-semibold text-slate-900 dark:text-ndark-text">
              {item.name}
            </h2>
            {item.isActive ? (
              <Badge tint="emerald">Aktif</Badge>
            ) : (
              <Badge tint="slate">Pasif</Badge>
            )}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-ndark-muted">{meta.label}</div>
          {item.description && (
            <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-ndark-muted">
              {item.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-ndark-muted">
            <span>
              <strong className="text-slate-700 dark:text-ndark-text">
                {item.contentCount.toLocaleString('tr-TR')}
              </strong>{' '}
              kayıt
            </span>
            <span>·</span>
            <span title={formatDateTime(item.lastUpdated)}>
              güncellendi {formatRelative(item.lastUpdated)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" leftIcon={<Pencil size={12} />} onClick={onEdit}>
              Düzenle
            </Button>
            <Button
              size="sm"
              variant="outline"
              leftIcon={item.isActive ? <PowerOff size={12} /> : <Power size={12} />}
              onClick={onToggleActive}
            >
              {item.isActive ? 'Pasif Yap' : 'Aktif Yap'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const TYPE_OPTIONS: { value: KnowledgeSourceType; label: string }[] = [
  { value: 'PastCases', label: 'Geçmiş Vakalar' },
  { value: 'ProductDocs', label: 'Ürün Dokümanları' },
  { value: 'SLARules', label: 'SLA Kuralları' },
  { value: 'Checklists', label: 'Kontrol Listeleri' },
  { value: 'ManualEntry', label: 'Manuel Giriş' },
];

function SourceEditor({
  mode,
  existing,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  existing?: KnowledgeSource | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [sourceType, setSourceType] = useState<KnowledgeSourceType>(
    existing?.sourceType ?? 'ManualEntry',
  );
  const [description, setDescription] = useState(existing?.description ?? '');
  const [contentCount, setContentCount] = useState<number>(existing?.contentCount ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast({ type: 'error', message: 'Ad boş olamaz.' });
      return;
    }
    const payload: KnowledgeSourceInput = {
      name: name.trim(),
      sourceType,
      description: description.trim() || undefined,
      contentCount: Math.max(0, Math.floor(Number(contentCount) || 0)),
    };
    setSubmitting(true);
    const r =
      mode === 'create'
        ? await adminService.knowledgeSources.create(payload)
        : await adminService.knowledgeSources.update(existing!.id, payload);
    setSubmitting(false);
    if (r.ok) {
      onSaved(mode === 'create' ? `"${r.item.name}" eklendi.` : `"${r.item.name}" güncellendi.`);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Yeni Bilgi Kaynağı' : 'Bilgi Kaynağını Düzenle'}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
        <Field label="Ad *" hint="Listede ve kart başlığında görünecek isim.">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Örn: Çağrı Merkezi Notları"
            autoFocus
            required
          />
        </Field>

        <Field label="Kaynak Türü" hint="AI'ın bu veriyi hangi kategoride değerlendireceği.">
          <Select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as KnowledgeSourceType)}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Açıklama" hint="Bu kaynağın kapsamını/önemini özetleyen kısa not.">
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Bu kaynak ne içeriyor?"
            rows={3}
          />
        </Field>

        <Field
          label="İçerik Sayısı"
          hint="Yaklaşık kayıt adedi. Otomatik ingestion yok — manuel beyan."
        >
          <TextInput
            type="number"
            min={0}
            step={1}
            value={String(contentCount)}
            onChange={(e) => setContentCount(Number(e.target.value) || 0)}
          />
        </Field>
      </form>
    </Modal>
  );
}
