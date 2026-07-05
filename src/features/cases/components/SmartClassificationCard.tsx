/**
 * L2-Smart-Flow FAZ 1 (2026-07-05) — Akıllı Tanımlar kartı.
 *
 * Case Detail → Detay sekmesi, Devir Notu'nun altında yaşar. Akıllı Ticket
 * (L1) akışındaki 5'li açılış sınıflandırmasını MEVCUT vaka üzerinde
 * görünür + düzenlenebilir + KB ile analiz edilebilir yapar. Motorlar
 * REUSE: suggest-classification endpoint'i + /api/lookups/taxonomies +
 * resolveSmartTicketMapping (L1 create paritesi).
 *
 * ÜÇ DURUM (kalabalık ekran disiplini — kapalıyken TEK satır):
 *   1. Boş     → tek satır boş-durum + "Bilgi Bankası ile Analiz Et"
 *                (akış ipucu: önce Açıklama düzeltilir — öz-açıklayıcı ekran)
 *   2. Dolu    → tek satır chip özeti + Düzenle
 *   3. Düzenle → 5 dropdown + KB rozetleri + Kaydet/Vazgeç + Yeniden Analiz
 *
 * TENANT KAPISI (kullanıcı kararı, PARAM hazırlığı):
 *   - kbEnabled=false + veri yok  → kart HİÇ render edilmez
 *   - kbEnabled=false + veri var  → salt-okunur chip (Analiz/Düzenle YOK)
 *   - kbEnabled=null (yükleniyor) → veri varsa salt-okunur, yoksa gizli
 *
 * EZME KURALI (kullanıcı kararı): Analiz sonucu ÖNERİSİ OLAN alanları ezer;
 * önerisi olmayan alan mevcut değerini korur. Kayıt insan onayından geçer
 * (analiz → düzenleme formu → Kaydet).
 *
 * Rozet dili: alan değeri KB önerisiyle aynıysa "KB önerisi · %NN",
 * farklıysa/elle girildiyse "elle seçildi" — persist edilen
 * classificationSuggestion.perField sayesinde sayfa yenilense de korunur.
 */
import { useCallback, useState } from 'react';
import { Box, Flame, Layers, Pencil, Settings2, Sparkles, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  caseService,
  lookupService,
  type SmartTicketTaxonomyResponse,
  type SuggestClassificationField,
  type SuggestClassificationResponse,
} from '@/services/caseService';
import { resolveSmartTicketMapping } from '@/features/smart-ticket/mapping';
import type { Case } from '../types';

const FIELDS: Array<{
  key: SuggestClassificationField;
  label: string;
  Icon: typeof Layers;
}> = [
  { key: 'platform', label: 'Platform', Icon: Layers },
  { key: 'businessProcess', label: 'İş Süreci', Icon: Workflow },
  { key: 'operationType', label: 'İşlem Tipi', Icon: Settings2 },
  { key: 'affectedObject', label: 'Etkilenen Nesne', Icon: Box },
  { key: 'impact', label: 'Etki', Icon: Flame },
];

type FieldValues = Record<SuggestClassificationField, string>;

interface PersistedSuggestionMeta {
  perField?: Partial<
    Record<SuggestClassificationField, { suggestedCode?: string; confidence?: number }>
  >;
}

function readSmartTicket(item: Case): Record<string, unknown> | null {
  const cf = item.customFields;
  if (!cf || typeof cf !== 'object') return null;
  const st = (cf as Record<string, unknown>).smartTicket;
  return st && typeof st === 'object' ? (st as Record<string, unknown>) : null;
}

function readStoredValues(item: Case): FieldValues {
  const st = readSmartTicket(item);
  const out = {} as FieldValues;
  for (const f of FIELDS) {
    const v = st?.[f.key];
    out[f.key] = typeof v === 'string' ? v : '';
  }
  return out;
}

function readStoredLabel(item: Case, key: SuggestClassificationField): string | null {
  const st = readSmartTicket(item);
  const label = st?.[`${key}Label`];
  if (typeof label === 'string' && label.trim()) return label.trim();
  const code = st?.[key];
  return typeof code === 'string' && code.trim() ? code.trim() : null;
}

function readPersistedSuggestion(item: Case): PersistedSuggestionMeta | null {
  const st = readSmartTicket(item);
  const cs = st?.classificationSuggestion;
  return cs && typeof cs === 'object' ? (cs as PersistedSuggestionMeta) : null;
}

interface SmartClassificationCardProps {
  item: Case;
  /** null = settings-status henüz yüklenmedi. */
  kbEnabled: boolean | null;
  canEdit: boolean;
  onUpdated: (updated: Case) => void;
}

export function SmartClassificationCard({
  item,
  kbEnabled,
  canEdit,
  onUpdated,
}: SmartClassificationCardProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FieldValues>(() => readStoredValues(item));
  const [taxonomies, setTaxonomies] = useState<
    SmartTicketTaxonomyResponse['taxonomies'] | null
  >(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestClassificationResponse | null>(null);

  const stored = readStoredValues(item);
  const hasData = FIELDS.some((f) => stored[f.key]);
  const persistedSug = readPersistedSuggestion(item);

  const ensureTaxonomies = useCallback(async () => {
    if (taxonomies) return taxonomies;
    const res = await lookupService.smartTicketTaxonomies(item.companyId);
    setTaxonomies(res.taxonomies);
    return res.taxonomies;
  }, [taxonomies, item.companyId]);

  const openEditor = useCallback(async () => {
    setValues(readStoredValues(item));
    setEditing(true);
    try {
      await ensureTaxonomies();
    } catch {
      toast({ type: 'warn', message: 'Kategori listeleri yüklenemedi.' });
    }
  }, [item, ensureTaxonomies, toast]);

  const handleAnalyze = useCallback(async () => {
    const description = (item.description ?? '').trim();
    if (description.length < 5) {
      toast({
        type: 'warn',
        message: 'Önce Açıklama alanını sorunu anlatacak şekilde doldurun.',
      });
      return;
    }
    setAnalyzing(true);
    try {
      await ensureTaxonomies();
      const res = await lookupService.suggestSmartTicketClassification({
        companyId: item.companyId,
        description,
      });
      if (!res) {
        // Sebep toast'ı apiFetch katmanından gelir (sınıflandırılmış:
        // kota/erişim/zaman aşımı). Burada yalnız EYLEM yolunu göster.
        toast({
          type: 'warn',
          message: 'KB analizi kullanılamıyor — Düzenle ile elle sınıflandırabilirsin.',
        });
        return;
      }
      setSuggestion(res);
      // Ezme kuralı: önerisi OLAN alanlar ezilir; olmayan alan korunur.
      setValues((prev) => {
        const next = { ...prev };
        for (const f of FIELDS) {
          const s = res.suggestions[f.key];
          if (s?.code) next[f.key] = s.code;
        }
        return next;
      });
      setEditing(true);
      const matched = Object.keys(res.suggestions).length;
      toast({ type: 'success', message: `KB: ${matched} alan eşleşti.` });
    } catch {
      toast({ type: 'error', message: 'KB analizi başarısız oldu.' });
    } finally {
      setAnalyzing(false);
    }
  }, [item.description, item.companyId, ensureTaxonomies, toast]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const tax = await ensureTaxonomies();
      const fields: NonNullable<
        Parameters<typeof caseService.updateSmartClassification>[1]['fields']
      > = {};
      for (const f of FIELDS) {
        const code = values[f.key] || null;
        const label = code
          ? tax?.[f.key]?.find((t) => t.code === code)?.label ?? null
          : null;
        fields[f.key] = { code, label };
      }

      // Öneri telemetrisi — L1 create formatı paritesi. appliedFields:
      // final değeri KB önerisiyle AYNI kalan alanlar.
      const src = suggestion;
      const payload: Parameters<typeof caseService.updateSmartClassification>[1] = {
        fields,
      };
      if (src) {
        const perField: NonNullable<
          NonNullable<typeof payload.classificationSuggestion>['perField']
        > = {};
        const appliedFields: string[] = [];
        for (const f of FIELDS) {
          const s = src.suggestions[f.key];
          if (!s) continue;
          perField[f.key] = {
            matchedBy: s.matchedBy,
            confidence: s.confidence,
            suggestedCode: s.code,
          };
          if (values[f.key] === s.code) appliedFields.push(f.key);
        }
        payload.classificationSuggestion = {
          appliedAt: new Date().toISOString(),
          appliedFields,
          perField,
          unmatched: src.unmatched.map((u) => ({
            taxonomyType: u.taxonomyType,
            rawValue: u.rawValue,
          })),
        };
      }

      // Kategori türetimi — L1 create paritesi (raporlama tek dil).
      const mapping = resolveSmartTicketMapping(tax, {
        platform: values.platform || undefined,
        businessProcess: values.businessProcess || undefined,
        operationType: values.operationType || undefined,
        affectedObject: values.affectedObject || undefined,
        impact: values.impact || undefined,
      });
      payload.appliedMapping = {
        source: mapping.source,
        category: mapping.category,
        subCategory: mapping.subCategory,
        requestType: mapping.requestType,
        trace: mapping.trace as unknown as string[],
      };

      const updated = await caseService.updateSmartClassification(item.id, payload);
      if (updated) {
        onUpdated(updated);
        setEditing(false);
        setSuggestion(null);
        toast({ type: 'success', message: 'Akıllı Tanımlar kaydedildi.' });
      }
    } catch {
      toast({ type: 'error', message: 'Kaydedilemedi.' });
    } finally {
      setSaving(false);
    }
  }, [values, suggestion, item.id, ensureTaxonomies, onUpdated, toast]);

  // Rozet: taze öneri > persist edilmiş öneri. Değer öneriyle aynı →
  // "KB önerisi · %NN"; dolu ama farklı → "elle seçildi".
  const badgeFor = (key: SuggestClassificationField): string | null => {
    const value = values[key];
    if (!value) return null;
    const fresh = suggestion?.suggestions[key];
    if (fresh) {
      return value === fresh.code
        ? `KB önerisi · %${Math.round(fresh.confidence * 100)}`
        : 'elle seçildi';
    }
    const persisted = persistedSug?.perField?.[key];
    if (persisted?.suggestedCode) {
      return value === persisted.suggestedCode
        ? `KB önerisi · %${Math.round((persisted.confidence ?? 0) * 100)}`
        : 'elle seçildi';
    }
    return 'elle seçildi';
  };

  // ── Tenant kapısı ────────────────────────────────────────────────
  if (!kbEnabled && !hasData) return null;

  const chips = FIELDS.map((f) => ({ ...f, value: readStoredLabel(item, f.key) })).filter(
    (f) => f.value,
  );

  const headerIcon = (
    <Sparkles size={13} className="shrink-0 text-violet-500" aria-hidden />
  );

  // Salt-okunur (KB kapalı ama veri var) ya da dolu-kapalı görünüm chip satırı
  if (!editing) {
    return (
      <section
        data-testid="smart-classification-card"
        className="rounded-lg bg-violet-50/30 p-3 ring-1 ring-inset ring-violet-200 dark:bg-violet-950/10 dark:ring-violet-900/40"
      >
        <div className="flex flex-wrap items-center gap-2">
          {headerIcon}
          <span className="text-xs font-medium text-slate-600 dark:text-ndark-muted">
            Akıllı Tanımlar
          </span>
          {chips.length > 0 ? (
            <>
              {chips.map((f) => {
                const Icon = f.Icon;
                return (
                  <span
                    key={f.key}
                    className="inline-flex items-baseline gap-1 rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[11px] text-slate-700 dark:border-violet-900/40 dark:bg-ndark-card dark:text-ndark-muted"
                  >
                    <Icon size={11} className="self-center text-violet-500" />
                    <span className="text-slate-400">{f.label}:</span>
                    <span className="font-medium">{f.value}</span>
                  </span>
                );
              })}
            </>
          ) : (
            <span className="text-xs text-slate-500 dark:text-ndark-muted">
              Henüz sınıflandırılmadı — önce Açıklama'yı sorunu anlatacak şekilde
              düzenle, sonra analiz et.
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {kbEnabled && canEdit && (
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Pencil size={12} />}
                onClick={() => void openEditor()}
                title={chips.length > 0 ? 'Kategorileri düzenle' : 'KB kullanmadan elle sınıflandır'}
              >
                {chips.length > 0 ? 'Düzenle' : 'Elle seç'}
              </Button>
            )}
            {kbEnabled && canEdit && (
              <Button
                size="sm"
                variant={chips.length > 0 ? 'outline' : 'primary'}
                leftIcon={<Sparkles size={12} />}
                onClick={() => void handleAnalyze()}
                disabled={analyzing}
                title="Açıklama metnini Bilgi Bankası ile analiz edip 5 kategoriyi önerir"
              >
                {analyzing ? 'KB analiz ediyor…' : 'Bilgi Bankası ile Analiz Et'}
              </Button>
            )}
          </span>
        </div>
      </section>
    );
  }

  // ── Düzenleme durumu ─────────────────────────────────────────────
  return (
    <section
      data-testid="smart-classification-card"
      className="rounded-lg bg-violet-50/30 p-3 ring-1 ring-inset ring-violet-200 dark:bg-violet-950/10 dark:ring-violet-900/40"
    >
      <div className="mb-3 flex items-center gap-2">
        {headerIcon}
        <span className="text-xs font-medium text-slate-600 dark:text-ndark-muted">
          Akıllı Tanımlar
        </span>
        {suggestion && (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            KB: {Object.keys(suggestion.suggestions).length} eşleşti
          </span>
        )}
        <span className="ml-auto">
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Sparkles size={12} />}
            onClick={() => void handleAnalyze()}
            disabled={analyzing}
          >
            {analyzing ? 'KB analiz ediyor…' : 'Yeniden Analiz Et'}
          </Button>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => {
          const list = taxonomies?.[f.key] ?? [];
          const badge = badgeFor(f.key);
          return (
            <div key={f.key}>
              <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-ndark-muted">
                {f.label}
              </label>
              <Select
                value={values[f.key]}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                }
                disabled={saving}
              >
                <option value="">— Seçim yok —</option>
                {list.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </Select>
              {badge && (
                <div
                  className={`mt-0.5 text-[10px] ${
                    badge === 'elle seçildi'
                      ? 'text-slate-400 dark:text-ndark-muted'
                      : 'text-violet-600 dark:text-violet-400'
                  }`}
                >
                  {badge}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditing(false);
            setSuggestion(null);
            setValues(readStoredValues(item));
          }}
          disabled={saving}
        >
          Vazgeç
        </Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
      </div>
    </section>
  );
}
