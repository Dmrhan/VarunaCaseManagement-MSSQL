import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  ClipboardCheck,
  Cog,
  FileText,
  Heart,
  Layers,
  Lightbulb,
  ListChecks,
  Loader2,
  MonitorSmartphone,
  Search,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { lookupService } from '@/services/caseService';
import {
  externalKbService,
  type ExternalKbEndpoint,
  type ExternalKbSettingsStatus,
  type ExternalKbStrictness,
  type ExternalKbWrappedResponse,
} from '@/services/externalKbService';

/**
 * WR-KB4 — Agent Resolution Workspace.
 *
 * Bilgi Bankası sayfası bir API console'undan çıkıp, agent'ın canlı çağrı
 * sırasında kullanabileceği bir çözüm masasına dönüştü. İki kolonlu layout:
 *   Sol  — Soru / Sınıflandırma / Olay Akışı / Bağlantı
 *   Sağ  — AI Kök Neden Hipotezleri / Önerilen Adımlar /
 *           Müşteri Yanıt Taslağı / Mühendis Aktarımı /
 *           Benzer Kayıtlar / Panorama Ekranları / Kaynaklar /
 *           Ham Yanıt (collapsed)
 *
 * Hiçbir external sonuç Varuna case alanlarına uygulanmaz. "Vakaya uygula" /
 * "Kategoriye yaz" / "Not oluştur" / "Runa AI'ya gönder" gibi butonlar YOKTUR.
 * Kopyala işlemi clipboard'a yazar; Varuna verisini mutate etmez.
 *
 * Tek sayfa, tek sidebar entry. CaseDetailPage / NewCaseForm / TransferModal
 * dokunulmaz.
 */

type Mode = 'analyze' | 'ask' | 'search';

const MODES: { key: Mode; label: string; hint: string; icon: React.ReactNode; endpoint: ExternalKbEndpoint }[] = [
  { key: 'analyze', label: 'Analiz', hint: 'Kök neden + adım önerisi + benzer kayıtlar', icon: <Brain size={13} />, endpoint: 'analyze' },
  { key: 'ask',     label: 'Cevap',  hint: 'Sorunuza doğrudan AI yanıtı',                icon: <Sparkles size={13} />, endpoint: 'ask' },
  { key: 'search',  label: 'Kaynak', hint: 'Belge / Panorama / Ticket çözüm araması',    icon: <Search size={13} />, endpoint: 'search' },
];

const STRICTNESS_OPTIONS: { value: ExternalKbStrictness; label: string }[] = [
  { value: 'lenient', label: 'Esnek' },
  { value: 'normal',  label: 'Normal' },
  { value: 'strict',  label: 'Katı' },
];

const SOURCE_TYPE_OPTIONS = [
  { value: 'pdf',                label: 'PDF' },
  { value: 'panorama_screen',    label: 'Panorama Ekranları' },
  { value: 'ticket_resolution',  label: 'Geçmiş Ticket Çözümleri' },
];

interface TimelineEntry {
  at: string;
  label: string;
}

export function KnowledgeBasePage() {
  const companies = useMemo(() => lookupService.companies(), []);
  const { toast } = useToast();

  const [companyId, setCompanyId] = useState<string>(
    companies.length === 1 ? companies[0].id : (companies[0]?.id ?? ''),
  );
  const [mode, setMode] = useState<Mode>('analyze');
  const [status, setStatus] = useState<ExternalKbSettingsStatus | null>(null);

  // Input state — paylaşımlı (mode değiştiğinde tutulur).
  const [problemText, setProblemText] = useState('');
  const [projectName, setProjectName] = useState('');
  const [bildirimNo, setBildirimNo] = useState('');

  // Advanced options (collapsed)
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [topK, setTopK] = useState<number>(8);
  const [strictness, setStrictness] = useState<ExternalKbStrictness>('lenient');
  const [rerank, setRerank] = useState(true);
  const [verify, setVerify] = useState(true);
  const [sources, setSources] = useState<string[]>([]);

  // Connection ops
  const [healthLoading, setHealthLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [healthResp, setHealthResp] = useState<ExternalKbWrappedResponse | null>(null);
  const [statsResp, setStatsResp] = useState<ExternalKbWrappedResponse | null>(null);

  // Result state
  const [resultLoading, setResultLoading] = useState(false);
  const [resp, setResp] = useState<ExternalKbWrappedResponse | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);

  // Companies değişimi → settings status reload + reset response panels
  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    void externalKbService.settingsStatus(companyId).then((s) => {
      if (!alive) return;
      setStatus(s ?? null);
      if (s?.configured) {
        if (typeof s.defaultTopK === 'number') setTopK(s.defaultTopK);
        if (s.defaultStrictness) setStrictness(s.defaultStrictness);
        if (typeof s.defaultRerank === 'boolean') setRerank(s.defaultRerank);
        if (typeof s.defaultVerify === 'boolean') setVerify(s.defaultVerify);
      }
    });
    setResp(null);
    setHealthResp(null);
    setStatsResp(null);
    setTimeline([]);
  }, [companyId]);

  const minLen = mode === 'analyze' ? 3 : mode === 'ask' ? 3 : 3;
  const labelForMain = mode === 'analyze' ? 'AI ile Analiz Et' : mode === 'ask' ? 'AI ile Cevap Al' : 'Kaynaklarda Ara';
  const canRun =
    !!companyId &&
    !!status?.configured &&
    !!status?.enabled &&
    problemText.trim().length >= minLen &&
    !resultLoading;

  function pushTimeline(label: string) {
    const at = new Date().toISOString();
    setTimeline((prev) => [...prev, { at, label }]);
  }

  async function handleRun() {
    if (!canRun) return;
    setResultLoading(true);
    setResp(null);
    pushTimeline('Sorgu oluşturuldu');
    let r: ExternalKbWrappedResponse | null = null;
    if (mode === 'analyze') {
      r = await externalKbService.analyze({
        companyId,
        freeText: problemText.trim(),
        context:
          projectName.trim() || bildirimNo.trim()
            ? {
                project: projectName.trim() || undefined,
                bildirim_no: bildirimNo.trim() || undefined,
              }
            : undefined,
      });
    } else if (mode === 'ask') {
      r = await externalKbService.ask({
        companyId,
        query: problemText.trim(),
        topK,
        strictness,
        rerank,
        verify,
        sourceTypes: sources.length > 0 ? sources : undefined,
      });
    } else {
      r = await externalKbService.search({
        companyId,
        query: problemText.trim(),
        topK,
        sourceTypes: sources.length > 0 ? sources : undefined,
      });
    }
    setResultLoading(false);
    setResp(r);
    pushTimeline(r?.ok ? 'AI yanıtı alındı' : 'AI yanıtı alınamadı');
  }

  async function handleCategorizeOnly() {
    if (!companyId || problemText.trim().length < 5) return;
    setResultLoading(true);
    setResp(null);
    pushTimeline('Sorgu oluşturuldu (yalnız sınıflandırma)');
    const r = await externalKbService.categorize({
      companyId,
      description: problemText.trim(),
    });
    setResultLoading(false);
    setResp(r);
    pushTimeline(r?.ok ? 'Sınıflandırma alındı' : 'Sınıflandırma alınamadı');
  }

  async function handleHealth() {
    if (!companyId) return;
    setHealthLoading(true);
    setHealthResp(null);
    const r = await externalKbService.health(companyId);
    setHealthLoading(false);
    setHealthResp(r);
  }
  async function handleStats() {
    if (!companyId) return;
    setStatsLoading(true);
    setStatsResp(null);
    const r = await externalKbService.stats(companyId);
    setStatsLoading(false);
    setStatsResp(r);
  }

  async function copyToClipboard(text: string, label = 'Metin') {
    try {
      await navigator.clipboard.writeText(text);
      toast({ type: 'success', message: `${label} kopyalandı`, duration: 1500 });
    } catch {
      // ignore
    }
  }

  function toggleSource(v: string) {
    setSources((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  }

  const integrationMissing = !status?.configured;
  const integrationDisabled = status?.configured && !status?.enabled;
  const data = resp?.ok ? resp.data : null;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <BookOpen size={20} className="text-brand-600 dark:text-brand-400" />
          <h1 className="text-xl font-semibold text-slate-800 dark:text-ndark-text">
            Bilgi Bankası
          </h1>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-ndark-muted">
          AI destekli bilgi bankası yanıtları ve çözüm adımları. Sonuçlar bu
          aşamada vaka alanlarına uygulanmaz.
        </p>
      </div>

      {integrationMissing && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="font-medium">
            Bu şirket için Bilgi Bankası bağlantısı tanımlı değil.
          </div>
          <div className="mt-0.5 text-amber-800 dark:text-amber-300">
            Yönetim Paneli → Bilgi Bankası Entegrasyonu ekranından bağlantıyı tanımlayın.
          </div>
        </div>
      )}
      {!integrationMissing && integrationDisabled && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
          Dış Bilgi Bankası bu şirkette <strong>kapalı</strong>. Admin "Aktif" seçeneğini açtığında sorgu yapılabilir.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,38%)_minmax(0,1fr)]">
        {/* ──────────────── LEFT COLUMN ──────────────── */}
        <div className="space-y-4">
          {/* Şirket seçici (multi-company) */}
          {companies.length > 1 && (
            <Card>
              <CardBody>
                <Field label="Şirket">
                  <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
              </CardBody>
            </Card>
          )}

          {/* Soru kartı */}
          <Card>
            <CardBody>
              <SectionTitle>Soru</SectionTitle>

              {/* Mode segmented control */}
              <div className="mt-1 flex w-full rounded-md border border-slate-200 bg-slate-50 p-0.5 dark:border-ndark-border dark:bg-ndark-bg">
                {MODES.map((m) => {
                  const active = m.key === mode;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setMode(m.key)}
                      title={m.hint}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-xs transition ${
                        active
                          ? 'bg-white font-medium text-slate-900 shadow-sm dark:bg-ndark-card dark:text-ndark-text'
                          : 'text-slate-600 hover:bg-white/60 dark:text-ndark-muted dark:hover:bg-ndark-card/60'
                      }`}
                    >
                      {m.icon}
                      {m.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3">
                <TextArea
                  rows={5}
                  value={problemText}
                  onChange={(e) => setProblemText(e.target.value)}
                  placeholder="Müşterinin sorununu yazın..."
                  aria-label="Problem metni"
                />
              </div>

              {/* Optional context — yalnız analiz modu için anlamlı */}
              {mode === 'analyze' && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <TextInput
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Proje / Müşteri (opsiyonel)"
                  />
                  <TextInput
                    value={bildirimNo}
                    onChange={(e) => setBildirimNo(e.target.value)}
                    placeholder="Bildirim No (opsiyonel)"
                  />
                </div>
              )}

              {/* Primary + secondary actions */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] text-slate-500 dark:text-ndark-muted">
                  {integrationMissing
                    ? 'Önce entegrasyon ayarı tanımlanmalı.'
                    : integrationDisabled
                      ? 'Entegrasyon kapalı; admin aktif etmeli.'
                      : status?.providerName
                        ? `Sağlayıcı: ${status.providerName}`
                        : ' '}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {mode === 'analyze' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCategorizeOnly}
                      disabled={!canRun || problemText.trim().length < 5}
                      title="Sadece kategori + kök neden tahminini çek"
                    >
                      Yalnızca sınıflandır
                    </Button>
                  )}
                  <Button
                    onClick={handleRun}
                    disabled={!canRun}
                    leftIcon={resultLoading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
                    title={
                      integrationMissing
                        ? 'Önce entegrasyon ayarı tanımlanmalı.'
                        : integrationDisabled
                          ? 'Entegrasyon kapalı.'
                          : undefined
                    }
                  >
                    {resultLoading ? 'Çalışıyor…' : labelForMain}
                  </Button>
                </div>
              </div>

              {/* Advanced options (collapsed) */}
              <details
                open={advancedOpen}
                onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
                className="mt-3 rounded-md border border-slate-200 dark:border-ndark-border"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-slate-700 dark:text-ndark-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Cog size={12} />
                    Gelişmiş seçenekler
                  </span>
                  {advancedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </summary>
                <div className="space-y-3 border-t border-slate-200 px-3 pb-3 pt-3 dark:border-ndark-border">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Kaynak sayısı" hint="1-20 (topK)">
                      <TextInput
                        type="number"
                        min={1}
                        max={20}
                        value={String(topK)}
                        onChange={(e) => setTopK(Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Yanıt hassasiyeti">
                      <Select value={strictness} onChange={(e) => setStrictness(e.target.value as ExternalKbStrictness)}>
                        {STRICTNESS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-ndark-muted">
                      <input type="checkbox" checked={rerank} onChange={(e) => setRerank(e.target.checked)} />
                      Sonuçları yeniden sırala
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-ndark-muted">
                      <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
                      Kaynak doğrulaması
                    </label>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Kaynak türleri
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {SOURCE_TYPE_OPTIONS.map((o) => {
                        const active = sources.includes(o.value);
                        return (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => toggleSource(o.value)}
                            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                              active
                                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/40 dark:text-brand-200'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted'
                            }`}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400 dark:text-ndark-muted">
                      Boş bırakılırsa API tüm desteklenen türleri kullanır.
                    </p>
                  </div>
                </div>
              </details>
            </CardBody>
          </Card>

          {/* Sınıflandırma kartı (data varsa) */}
          <ClassificationCard data={data} />

          {/* Olay Akışı */}
          <Card>
            <CardBody>
              <SectionTitle>Olay Akışı</SectionTitle>
              {timeline.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-ndark-muted">Henüz işlem yok.</p>
              ) : (
                <ul className="space-y-1 text-xs text-slate-700 dark:text-ndark-muted">
                  {timeline.map((e, i) => (
                    <li key={i} className="flex items-baseline gap-2">
                      <span className="font-mono text-[10px] text-slate-400">
                        {new Date(e.at).toLocaleTimeString('tr-TR')}
                      </span>
                      <span>{e.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Bağlantı */}
          <Card>
            <CardBody>
              <SectionTitle>Bağlantı</SectionTitle>
              <ConnectionPanel status={status} />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleHealth}
                  disabled={!companyId || healthLoading || !status?.enabled}
                  leftIcon={healthLoading ? <Loader2 size={12} className="animate-spin" /> : <Heart size={12} />}
                >
                  Bağlantıyı Kontrol Et
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleStats}
                  disabled={!companyId || statsLoading || !status?.enabled}
                  leftIcon={statsLoading ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
                >
                  İstatistikler
                </Button>
              </div>
              {(healthResp || statsResp) && (
                <div className="mt-2 space-y-2">
                  {healthResp && <MiniWrappedView label="Sağlık" resp={healthResp} />}
                  {statsResp && <MiniWrappedView label="İstatistik" resp={statsResp} />}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ──────────────── RIGHT COLUMN ──────────────── */}
        <div className="space-y-4">
          {!resp && !resultLoading && (
            <Card>
              <CardBody>
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <Lightbulb size={28} className="text-slate-300" />
                  <p className="max-w-md text-sm text-slate-500 dark:text-ndark-muted">
                    Bir sorun yazıp <strong>AI ile Analiz Et</strong>'e bastığında kök neden hipotezleri,
                    önerilen adımlar ve kaynaklar burada görünecek.
                  </p>
                </div>
              </CardBody>
            </Card>
          )}

          {resultLoading && (
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-ndark-muted">
                  <Loader2 size={14} className="animate-spin" />
                  AI çağrısı yapılıyor…
                </div>
              </CardBody>
            </Card>
          )}

          {resp && !resp.ok && (
            <Card>
              <CardBody>
                <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">{resp.error.message}</div>
                    <div className="text-xs">
                      <code>{resp.error.code}</code>
                      {resp.error.status != null && <> · status: <code>{resp.error.status}</code></>}
                    </div>
                  </div>
                </div>
                {resp.data !== undefined && resp.data !== null && (
                  <div className="mt-3">
                    <RawJsonPanel data={resp.data} onCopy={(t) => copyToClipboard(t, 'Ham yanıt')} />
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {resp?.ok && (
            <>
              <RootCauseHypothesesCard data={data} />
              <SuggestedStepsCard data={data} />
              <CustomerReplyDraftCard data={data} onCopy={copyToClipboard} />
              <EngineeringHandoffCard data={data} onCopy={copyToClipboard} />
              <SimilarRecordsCard data={data} />
              <PanoramaScreensCard data={data} />
              <SourcesCard data={data} mode={mode} />
              <RawJsonWrap data={data} latencyMs={resp.meta?.latencyMs} onCopy={(t) => copyToClipboard(t, 'Ham yanıt')} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
      {children}
    </h2>
  );
}

function obj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
}

function asString(x: unknown): string | null {
  return typeof x === 'string' && x.trim().length > 0 ? x : null;
}

function asNumber(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function pct(x: number): string {
  // Confidence 0..1 OR 0..100 olabilir. >=2 ise zaten yüzde varsayalım.
  return x > 1 ? `%${Math.round(x)}` : `%${Math.round(x * 100)}`;
}

// ─────────────────────────────────────────────────────────────────
// Left: classification card
// ─────────────────────────────────────────────────────────────────

function ClassificationCard({ data }: { data: unknown }) {
  const d = obj(data);
  if (!d) return null;
  const cat = asString(d.category_id) ?? asString(d.category);
  const subCat = asString(d.category_sub) ?? asString(d.subcategory);
  const root = asString(d.root_cause_id) ?? asString(d.rootCause);
  const rootSub = asString(d.root_cause_sub) ?? asString(d.rootCauseSub);
  const conf = asNumber(d.confidence);
  const reason = asString(d.reason);
  if (!cat && !subCat && !root && !rootSub && conf == null && !reason) return null;
  return (
    <Card>
      <CardBody>
        <SectionTitle>Sınıflandırma</SectionTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          {cat && <Badge tint="indigo">Kategori: {cat}</Badge>}
          {subCat && (
            <span className="text-xs text-slate-600 dark:text-ndark-muted">
              {subCat}
            </span>
          )}
        </div>
        {(root || rootSub) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {root && <Badge tint="rose">Kök Neden: {root}</Badge>}
            {rootSub && (
              <span className="text-xs text-slate-600 dark:text-ndark-muted">{rootSub}</span>
            )}
          </div>
        )}
        {conf != null && (
          <div className="mt-1.5">
            <Badge tint="violet">Güven {pct(conf)}</Badge>
          </div>
        )}
        {reason && (
          <p className="mt-1.5 text-[11px] italic text-slate-500 dark:text-ndark-muted">
            {reason}
          </p>
        )}
        <p className="mt-2 text-[10px] text-slate-400 dark:text-ndark-muted">
          Öneri amaçlıdır; vaka alanlarına otomatik yazılmaz.
        </p>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Left: connection panel
// ─────────────────────────────────────────────────────────────────

function ConnectionPanel({ status }: { status: ExternalKbSettingsStatus | null }) {
  if (!status) {
    return <p className="text-xs text-slate-500 dark:text-ndark-muted">Durum yükleniyor…</p>;
  }
  if (!status.configured) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <XCircle size={11} /> Ayar eksik
        </span>
        <span className="text-slate-500 dark:text-ndark-muted">Yönetim Paneli'nden tanımla</span>
      </div>
    );
  }
  const enabled = !!status.enabled;
  const secretOk = status.authType === 'none' || status.secretConfigured;
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 ' +
            (enabled
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'bg-slate-100 text-slate-600 dark:bg-ndark-bg dark:text-ndark-muted')
          }
        >
          {enabled ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
          {enabled ? 'Aktif' : 'Pasif'}
        </span>
        {status.providerName && (
          <span className="text-slate-700 dark:text-ndark-muted">{status.providerName}</span>
        )}
      </div>
      <div className="text-slate-500 dark:text-ndark-muted">
        Kimlik: <strong>{status.authType ?? 'none'}</strong>
        {status.authType !== 'none' && (
          <>
            {' '}· Anahtar {secretOk ? <strong>tanımlı</strong> : <strong className="text-rose-700">eksik</strong>}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Right: root cause hypotheses
// ─────────────────────────────────────────────────────────────────

function RootCauseHypothesesCard({ data }: { data: unknown }) {
  const d = obj(data);
  const analysis = d ? obj(d.analysis) : null;
  const list = analysis && Array.isArray(analysis.rootCauseHypotheses)
    ? (analysis.rootCauseHypotheses as unknown[])
    : null;
  // Categorize endpoint fallback: root_cause + reason → 1 öğelik liste
  const rootFallback = d ? (asString(d.root_cause_id) ?? asString(d.root_cause_sub)) : null;
  if ((!list || list.length === 0) && !rootFallback) return null;

  const rows = (list ?? [])
    .map((h, idx) => {
      if (typeof h === 'string') return { text: h, confidence: null as number | null, rank: idx + 1 };
      const obj = h as Record<string, unknown>;
      return {
        text: asString(obj.text) ?? asString(obj.hypothesis) ?? JSON.stringify(obj),
        confidence: asNumber(obj.confidence) ?? asNumber(obj.score),
        rank: idx + 1,
      };
    })
    .sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));

  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center gap-1.5">
          <AlertTriangle size={14} className="text-rose-500" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">AI Kök Neden Hipotezleri</h3>
        </div>
        {rows.length > 0 ? (
          <ol className="space-y-1.5">
            {rows.map((r, i) => (
              <li key={i} className="flex items-start gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 dark:bg-ndark-bg">
                <span className="mt-0.5 inline-flex h-5 min-w-[44px] items-center justify-center rounded bg-violet-100 px-1.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-200">
                  {r.confidence != null ? pct(r.confidence) : `#${r.rank}`}
                </span>
                <span className="text-sm text-slate-800 dark:text-ndark-text">{r.text}</span>
              </li>
            ))}
          </ol>
        ) : rootFallback ? (
          <p className="text-sm text-slate-800 dark:text-ndark-text">{rootFallback}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Right: suggested steps
// ─────────────────────────────────────────────────────────────────

function SuggestedStepsCard({ data }: { data: unknown }) {
  const d = obj(data);
  const analysis = d ? obj(d.analysis) : null;
  const steps = analysis && Array.isArray(analysis.suggestedSteps)
    ? (analysis.suggestedSteps as unknown[])
    : null;
  // ask endpoint fallback: data.answer paragraph
  const answer = d ? asString(d.answer) : null;
  if ((!steps || steps.length === 0) && !answer) return null;

  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center gap-1.5">
          <ListChecks size={14} className="text-emerald-600" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">AI Önerilen Adımlar</h3>
        </div>
        {steps && steps.length > 0 ? (
          <ol className="space-y-2">
            {steps.map((s, i) => {
              if (typeof s === 'string') {
                return (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700 dark:bg-brand-950/40 dark:text-brand-200">
                      {i + 1}
                    </span>
                    <span className="whitespace-pre-wrap text-sm text-slate-800 dark:text-ndark-text">{s}</span>
                  </li>
                );
              }
              const obj = s as Record<string, unknown>;
              const main = asString(obj.text) ?? asString(obj.instruction) ?? asString(obj.title);
              const rationale = asString(obj.rationale) ?? asString(obj.note);
              return (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700 dark:bg-brand-950/40 dark:text-brand-200">
                    {i + 1}
                  </span>
                  <div className="text-sm">
                    <div className="font-medium text-slate-800 dark:text-ndark-text">{main ?? JSON.stringify(obj)}</div>
                    {rationale && (
                      <div className="text-xs text-slate-500 dark:text-ndark-muted">{rationale}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : answer ? (
          <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-ndark-text">{answer}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Right: customer reply draft
// ─────────────────────────────────────────────────────────────────

function CustomerReplyDraftCard({
  data,
  onCopy,
}: {
  data: unknown;
  onCopy: (text: string, label?: string) => void;
}) {
  const d = obj(data);
  const analysis = d ? obj(d.analysis) : null;
  const reply = analysis ? asString(analysis.customerReplyDraft) : null;
  if (!reply) return null;
  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles size={14} className="text-violet-600" />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">Müşteriye Yanıt Taslağı</h3>
          </div>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Clipboard size={12} />}
            onClick={() => onCopy(reply, 'Müşteri yanıt taslağı')}
          >
            Kopyala
          </Button>
        </div>
        <p className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:bg-ndark-bg dark:text-ndark-text">
          {reply}
        </p>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Right: engineering handoff
// ─────────────────────────────────────────────────────────────────

function EngineeringHandoffCard({
  data,
  onCopy,
}: {
  data: unknown;
  onCopy: (text: string, label?: string) => void;
}) {
  const d = obj(data);
  const analysis = d ? obj(d.analysis) : null;
  if (!analysis) return null;
  const eng = analysis.engineeringHandoff;
  if (eng === undefined || eng === null) return null;
  const text = typeof eng === 'string' ? eng : JSON.stringify(eng, null, 2);
  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Wrench size={14} className="text-slate-700 dark:text-slate-300" />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">Mühendis Aktarımı</h3>
          </div>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Clipboard size={12} />}
            onClick={() => onCopy(text, 'Mühendis aktarımı')}
          >
            Kopyala
          </Button>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-700 dark:bg-ndark-bg dark:text-ndark-muted">
          {text}
        </pre>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Right: similar records
// ─────────────────────────────────────────────────────────────────

function SimilarRecordsCard({ data }: { data: unknown }) {
  const d = obj(data);
  const list = d && Array.isArray(d.similar) ? (d.similar as unknown[]) : null;
  if (!list || list.length === 0) return null;
  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center gap-1.5">
          <Layers size={14} className="text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
            Benzer Kayıtlar ({list.length})
          </h3>
        </div>
        <ul className="space-y-1.5">
          {list.map((it, i) => {
            if (typeof it === 'string') {
              return <li key={i} className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-ndark-bg">{it}</li>;
            }
            const o = it as Record<string, unknown>;
            const no = asString(o.bildirim_no) ?? asString(o.ticket_no) ?? asString(o.id);
            const score = asNumber(o.score);
            const cat = asString(o.kategori_uzun) ?? asString(o.category);
            const rc = asString(o.kok_neden) ?? asString(o.root_cause);
            const aciklama = asString(o.aciklama) ?? asString(o.description);
            const cozum = asString(o.cozum) ?? asString(o.resolution);
            return (
              <li key={i} className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-ndark-bg">
                <div className="flex flex-wrap items-baseline gap-2">
                  {no && <span className="font-mono text-slate-700 dark:text-ndark-muted">{no}</span>}
                  {score != null && <Badge tint="slate">score {score.toFixed?.(2) ?? score}</Badge>}
                  {cat && <Badge tint="indigo">{cat}</Badge>}
                </div>
                {rc && <div className="mt-0.5 text-slate-600 dark:text-ndark-muted">Kök: {rc}</div>}
                {aciklama && <div className="mt-0.5 text-slate-600 dark:text-ndark-muted">{aciklama}</div>}
                {cozum && <div className="mt-0.5 text-emerald-700 dark:text-emerald-300">Çözüm: {cozum}</div>}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Right: panorama screens
// ─────────────────────────────────────────────────────────────────

function PanoramaScreensCard({ data }: { data: unknown }) {
  const d = obj(data);
  const list = d && Array.isArray(d.panoramaScreens) ? (d.panoramaScreens as unknown[]) : null;
  if (!list || list.length === 0) return null;
  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center gap-1.5">
          <MonitorSmartphone size={14} className="text-slate-700 dark:text-slate-300" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
            Panorama Ekranları ({list.length})
          </h3>
        </div>
        <ul className="space-y-1.5">
          {list.map((it, i) => {
            if (typeof it === 'string') {
              return <li key={i} className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-ndark-bg">{it}</li>;
            }
            const o = it as Record<string, unknown>;
            const title = asString(o.title) ?? asString(o.name);
            const menuStep = asString(o.menuStep) ?? asString(o.menu_path) ?? asString(o.path);
            const fields = Array.isArray(o.fields) ? (o.fields as unknown[]) : null;
            const buttons = Array.isArray(o.buttons) ? (o.buttons as unknown[]) : null;
            return (
              <li key={i} className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-ndark-bg">
                {title && <div className="font-medium text-slate-800 dark:text-ndark-text">{title}</div>}
                {menuStep && <div className="text-slate-500 dark:text-ndark-muted">Menü: {menuStep}</div>}
                {fields && fields.length > 0 && (
                  <div className="mt-0.5 text-slate-600 dark:text-ndark-muted">
                    Alanlar: {fields.map((f) => (typeof f === 'string' ? f : JSON.stringify(f))).join(', ')}
                  </div>
                )}
                {buttons && buttons.length > 0 && (
                  <div className="mt-0.5 text-slate-600 dark:text-ndark-muted">
                    Butonlar: {buttons.map((b) => (typeof b === 'string' ? b : JSON.stringify(b))).join(', ')}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Right: sources card — citations + kbChunks + hits
// ─────────────────────────────────────────────────────────────────

function SourcesCard({ data, mode }: { data: unknown; mode: Mode }) {
  const d = obj(data);
  if (!d) return null;
  const citations = Array.isArray(d.citations) ? (d.citations as unknown[]) : [];
  const kbChunks = Array.isArray(d.kbChunks) ? (d.kbChunks as unknown[]) : [];
  const hits = Array.isArray(d.hits) ? (d.hits as unknown[]) : [];

  // Birleşik kaynak listesi — order: hits (search) > citations (ask) > kbChunks (analyze)
  const all: { src: string; obj: unknown }[] = [];
  for (const h of hits) all.push({ src: 'hit', obj: h });
  for (const c of citations) all.push({ src: 'citation', obj: c });
  for (const k of kbChunks) all.push({ src: 'kb', obj: k });
  if (all.length === 0) return null;

  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center gap-1.5">
          <FileText size={14} className="text-slate-700 dark:text-slate-300" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
            Kaynaklar ({all.length})
          </h3>
        </div>
        <ul className="space-y-1.5">
          {all.map((entry, i) => {
            const o = obj(entry.obj);
            if (!o) return null;
            const title = asString(o.title) ?? asString(o.heading) ?? asString(o.name);
            const sourceType = asString(o.source_type) ?? asString(o.sourceType);
            const headingPath = asString(o.heading_path) ?? asString(o.path);
            const excerpt = asString(o.excerpt) ?? asString(o.snippet) ?? asString(o.content);
            const url = asString(o.url);
            const score = asNumber(o.score);
            return (
              <li key={i} className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-ndark-bg">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[10px] text-slate-400">#{i + 1}</span>
                  {title && <span className="font-medium text-slate-800 dark:text-ndark-text">{title}</span>}
                  {sourceType && <Badge tint="slate">{sourceTypeLabel(sourceType)}</Badge>}
                  {score != null && <span className="text-[10px] text-slate-500">score {score.toFixed?.(3) ?? score}</span>}
                </div>
                {headingPath && (
                  <div className="text-slate-500 dark:text-ndark-muted">{headingPath}</div>
                )}
                {excerpt && (
                  <p className="mt-0.5 text-slate-700 dark:text-ndark-muted">{excerpt}</p>
                )}
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline dark:text-brand-300">
                    {url}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[10px] text-slate-400 dark:text-ndark-muted">
          Mod: {mode === 'analyze' ? 'Analiz' : mode === 'ask' ? 'Cevap' : 'Kaynak'}
        </p>
      </CardBody>
    </Card>
  );
}

function sourceTypeLabel(value: string): string {
  if (value === 'pdf') return 'PDF';
  if (value === 'panorama_screen') return 'Panorama';
  if (value === 'ticket_resolution') return 'Geçmiş Ticket';
  return value;
}

// ─────────────────────────────────────────────────────────────────
// Right: raw JSON (collapsed by default — audit/debug)
// ─────────────────────────────────────────────────────────────────

function RawJsonWrap({
  data,
  latencyMs,
  onCopy,
}: {
  data: unknown;
  latencyMs?: number;
  onCopy: (text: string) => void;
}) {
  return (
    <Card>
      <CardBody>
        <RawJsonPanel data={data} latencyMs={latencyMs} onCopy={onCopy} />
      </CardBody>
    </Card>
  );
}

function RawJsonPanel({
  data,
  latencyMs,
  onCopy,
}: {
  data: unknown;
  latencyMs?: number;
  onCopy: (text: string) => void;
}) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }, [data]);
  return (
    <details className="rounded-md border border-slate-200 bg-slate-50 dark:border-ndark-border dark:bg-ndark-bg">
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-slate-700 dark:text-ndark-muted">
        <span className="inline-flex items-center gap-1.5">
          <ChevronRight size={11} className="transition group-open:rotate-90" />
          Ham Yanıtı Göster (audit / debug)
        </span>
        <span className="flex items-center gap-2 text-[10px] text-slate-500">
          {latencyMs != null && <span>{latencyMs} ms</span>}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onCopy(text);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted"
          >
            <ClipboardCheck size={10} /> Kopyala
          </button>
        </span>
      </summary>
      <pre className="overflow-x-auto px-3 pb-3 text-[11px] leading-relaxed text-slate-700 dark:text-ndark-muted">
        {text}
      </pre>
    </details>
  );
}

// ─────────────────────────────────────────────────────────────────
// Mini wrapped view for health/stats results
// ─────────────────────────────────────────────────────────────────

function MiniWrappedView({ label, resp }: { label: string; resp: ExternalKbWrappedResponse }) {
  if (!resp.ok) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
        <span className="font-medium">{label}:</span> {resp.error.message}
        <span className="ml-1 text-[10px]"><code>{resp.error.code}</code></span>
      </div>
    );
  }
  return (
    <details className="rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30">
      <summary className="cursor-pointer px-2.5 py-1.5 text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
        {label}: OK {resp.meta?.latencyMs != null && <span className="text-[10px] text-emerald-700">· {resp.meta.latencyMs} ms</span>}
      </summary>
      <pre className="overflow-x-auto px-2.5 pb-2 text-[10px] text-emerald-900 dark:text-emerald-200">
        {(() => {
          try { return JSON.stringify(resp.data, null, 2); } catch { return String(resp.data); }
        })()}
      </pre>
    </details>
  );
}
