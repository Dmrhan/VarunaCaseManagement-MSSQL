import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle2,
  Copy,
  Heart,
  Layers,
  Loader2,
  Search,
  Sparkles,
  Tags,
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
 * WR-KB3 — Bilgi Bankası dış servis console'u.
 *
 * Bu sayfa dış KB / AI servisine BFF proxy üzerinden çağrı yapar ve dönen
 * HAM yanıtı agent UI'sına gösterir. Hiçbir yanıt Varuna case alanlarına
 * uygulanmaz; "Vakaya uygula" / "Kategoriye yaz" / "Runa AI'ya gönder"
 * gibi mutasyon butonları YOKTUR.
 *
 * Tüm rollere açık (Agent / Backoffice / Supervisor / CSM / Admin / SystemAdmin).
 * Setting `allow*Use` flag'leri BFF tarafında enforce edilir.
 */

const TABS: { key: ExternalKbEndpoint; label: string; icon: React.ReactNode }[] = [
  { key: 'ask',        label: 'Soru Sor',     icon: <Sparkles size={13} /> },
  { key: 'search',     label: 'Kaynak Ara',   icon: <Search size={13} /> },
  { key: 'categorize', label: 'Kategorize Et', icon: <Tags size={13} /> },
  { key: 'analyze',    label: 'Analiz Et',    icon: <Brain size={13} /> },
];

const STRICTNESS_OPTIONS: { value: ExternalKbStrictness; label: string }[] = [
  { value: 'lenient', label: 'Esnek (lenient)' },
  { value: 'normal',  label: 'Normal' },
  { value: 'strict',  label: 'Katı (strict)' },
];

const SOURCE_TYPE_OPTIONS = [
  { value: 'kb', label: 'KB' },
  { value: 'past_cases', label: 'Geçmiş Vakalar' },
  { value: 'docs', label: 'Dokümanlar' },
  { value: 'manual', label: 'Manuel' },
  { value: 'sla', label: 'SLA' },
  { value: 'checklists', label: 'Kontrol Listeleri' },
  { value: 'panorama', label: 'Panorama' },
];

export function KnowledgeBasePage() {
  const companies = useMemo(() => lookupService.companies(), []);
  const { toast } = useToast();

  const [companyId, setCompanyId] = useState<string>(
    companies.length === 1 ? companies[0].id : (companies[0]?.id ?? ''),
  );

  const [activeTab, setActiveTab] = useState<ExternalKbEndpoint>('ask');
  const [status, setStatus] = useState<ExternalKbSettingsStatus | null>(null);

  // health / stats
  const [healthLoading, setHealthLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [healthResp, setHealthResp] = useState<ExternalKbWrappedResponse | null>(null);
  const [statsResp, setStatsResp] = useState<ExternalKbWrappedResponse | null>(null);

  // per-tab response + loading
  const [tabLoading, setTabLoading] = useState(false);
  const [tabResp, setTabResp] = useState<ExternalKbWrappedResponse | null>(null);

  // Form state — kept simple; each tab owns the fields it uses.
  const [askQuery, setAskQuery] = useState('');
  const [askTopK, setAskTopK] = useState<number>(8);
  const [askStrictness, setAskStrictness] = useState<ExternalKbStrictness>('lenient');
  const [askRerank, setAskRerank] = useState(true);
  const [askVerify, setAskVerify] = useState(true);
  const [askSources, setAskSources] = useState<string[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchTopK, setSearchTopK] = useState<number>(8);
  const [searchSources, setSearchSources] = useState<string[]>([]);

  const [categorizeDescription, setCategorizeDescription] = useState('');
  const [analyzeFreeText, setAnalyzeFreeText] = useState('');

  // Companies değişimi → settings status reload + reset response panels
  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    void externalKbService.settingsStatus(companyId).then((s) => {
      if (!alive) return;
      setStatus(s ?? null);
      // Setting'den default'ları çek
      if (s?.configured) {
        if (typeof s.defaultTopK === 'number') {
          setAskTopK(s.defaultTopK);
          setSearchTopK(s.defaultTopK);
        }
        if (s.defaultStrictness) setAskStrictness(s.defaultStrictness);
        if (typeof s.defaultRerank === 'boolean') setAskRerank(s.defaultRerank);
        if (typeof s.defaultVerify === 'boolean') setAskVerify(s.defaultVerify);
      }
    });
    setHealthResp(null);
    setStatsResp(null);
    setTabResp(null);
    return () => { alive = false; };
  }, [companyId]);

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

  async function handleSubmitAsk() {
    if (!companyId || askQuery.trim().length < 3) return;
    setTabLoading(true);
    setTabResp(null);
    const r = await externalKbService.ask({
      companyId,
      query: askQuery.trim(),
      topK: askTopK,
      strictness: askStrictness,
      rerank: askRerank,
      verify: askVerify,
      sourceTypes: askSources.length > 0 ? askSources : undefined,
    });
    setTabLoading(false);
    setTabResp(r);
  }

  async function handleSubmitSearch() {
    if (!companyId || searchQuery.trim().length < 3) return;
    setTabLoading(true);
    setTabResp(null);
    const r = await externalKbService.search({
      companyId,
      query: searchQuery.trim(),
      topK: searchTopK,
      sourceTypes: searchSources.length > 0 ? searchSources : undefined,
    });
    setTabLoading(false);
    setTabResp(r);
  }

  async function handleSubmitCategorize() {
    if (!companyId || categorizeDescription.trim().length < 5) return;
    setTabLoading(true);
    setTabResp(null);
    const r = await externalKbService.categorize({
      companyId,
      description: categorizeDescription.trim(),
    });
    setTabLoading(false);
    setTabResp(r);
  }

  async function handleSubmitAnalyze() {
    if (!companyId || analyzeFreeText.trim().length < 3) return;
    setTabLoading(true);
    setTabResp(null);
    const r = await externalKbService.analyze({
      companyId,
      freeText: analyzeFreeText.trim(),
    });
    setTabLoading(false);
    setTabResp(r);
  }

  function changeTab(next: ExternalKbEndpoint) {
    if (next === activeTab) return;
    setActiveTab(next);
    setTabResp(null);
  }

  function toggleArrayItem(arr: string[], v: string): string[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  async function copyJson(obj: unknown) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
      toast({ type: 'success', message: 'JSON kopyalandı', duration: 1500 });
    } catch {
      // ignore — copy is a nicety, not critical
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <BookOpen size={20} className="text-brand-600 dark:text-brand-400" />
          <h1 className="text-xl font-semibold text-slate-800 dark:text-ndark-text">
            Bilgi Bankası
          </h1>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-ndark-muted">
          Dış bilgi bankası ve AI servisinden dönen yanıtlar bu ekranda
          görüntülenir. Bu sonuçlar şu aşamada vaka alanlarına uygulanmaz.
        </p>
      </div>

      {/* Company selector + settings status */}
      <Card>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {companies.length > 1 && (
              <Field label="Şirket">
                <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
            )}
            <StatusPanel status={status} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-ndark-border">
            <Button
              size="sm"
              variant="outline"
              onClick={handleHealth}
              disabled={!companyId || healthLoading || status?.enabled === false}
              leftIcon={healthLoading ? <Loader2 size={12} className="animate-spin" /> : <Heart size={12} />}
            >
              Health
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleStats}
              disabled={!companyId || statsLoading || status?.enabled === false}
              leftIcon={statsLoading ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
            >
              Stats
            </Button>
          </div>
          {healthResp && (
            <div className="mt-3">
              <SectionLabel icon={<Heart size={11} />}>Health</SectionLabel>
              <WrappedResponseViewer resp={healthResp} onCopy={copyJson} />
            </div>
          )}
          {statsResp && (
            <div className="mt-3">
              <SectionLabel icon={<Activity size={11} />}>Stats</SectionLabel>
              <WrappedResponseViewer resp={statsResp} onCopy={copyJson} />
            </div>
          )}
        </CardBody>
      </Card>

      {/* Tabs */}
      <Card>
        <CardBody className="!p-0">
          <div className="flex border-b border-slate-200 dark:border-ndark-border">
            {TABS.map((t) => {
              const active = t.key === activeTab;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => changeTab(t.key)}
                  className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-sm transition ${
                    active
                      ? 'border-b-2 border-brand-500 font-medium text-brand-700 dark:text-brand-300'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-ndark-muted dark:hover:bg-ndark-bg'
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="space-y-4 p-4">
            {activeTab === 'ask' && (
              <AskTab
                query={askQuery} setQuery={setAskQuery}
                topK={askTopK} setTopK={setAskTopK}
                strictness={askStrictness} setStrictness={setAskStrictness}
                rerank={askRerank} setRerank={setAskRerank}
                verify={askVerify} setVerify={setAskVerify}
                sources={askSources}
                onToggleSource={(v) => setAskSources((s) => toggleArrayItem(s, v))}
                loading={tabLoading}
                onSubmit={handleSubmitAsk}
                disabled={!companyId || status?.enabled === false || askQuery.trim().length < 3}
              />
            )}
            {activeTab === 'search' && (
              <SearchTab
                query={searchQuery} setQuery={setSearchQuery}
                topK={searchTopK} setTopK={setSearchTopK}
                sources={searchSources}
                onToggleSource={(v) => setSearchSources((s) => toggleArrayItem(s, v))}
                loading={tabLoading}
                onSubmit={handleSubmitSearch}
                disabled={!companyId || status?.enabled === false || searchQuery.trim().length < 3}
              />
            )}
            {activeTab === 'categorize' && (
              <CategorizeTab
                description={categorizeDescription} setDescription={setCategorizeDescription}
                loading={tabLoading}
                onSubmit={handleSubmitCategorize}
                disabled={!companyId || status?.enabled === false || categorizeDescription.trim().length < 5}
              />
            )}
            {activeTab === 'analyze' && (
              <AnalyzeTab
                freeText={analyzeFreeText} setFreeText={setAnalyzeFreeText}
                loading={tabLoading}
                onSubmit={handleSubmitAnalyze}
                disabled={!companyId || status?.enabled === false || analyzeFreeText.trim().length < 3}
              />
            )}
          </div>
        </CardBody>
      </Card>

      {/* Result viewer */}
      <Card>
        <CardBody>
          <SectionLabel icon={<Layers size={11} />}>Yanıt</SectionLabel>
          {!tabResp && !tabLoading && (
            <p className="text-sm text-slate-500 dark:text-ndark-muted">
              Sorgu çalıştırıldığında yanıt burada görüntülenecek.
            </p>
          )}
          {tabLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-ndark-muted">
              <Loader2 size={14} className="animate-spin" />
              Dış servis çağrısı yapılıyor…
            </div>
          )}
          {tabResp && <WrappedResponseViewer resp={tabResp} onCopy={copyJson} />}
        </CardBody>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────

function AskTab(props: {
  query: string; setQuery: (v: string) => void;
  topK: number; setTopK: (n: number) => void;
  strictness: ExternalKbStrictness; setStrictness: (s: ExternalKbStrictness) => void;
  rerank: boolean; setRerank: (b: boolean) => void;
  verify: boolean; setVerify: (b: boolean) => void;
  sources: string[]; onToggleSource: (v: string) => void;
  loading: boolean; onSubmit: () => void; disabled: boolean;
}) {
  return (
    <>
      <Field label="Soru" required hint="3-2000 karakter arası">
        <TextArea
          rows={3}
          value={props.query}
          onChange={(e) => props.setQuery(e.target.value)}
          placeholder="Sorunuzu yazın..."
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="topK">
          <TextInput
            type="number"
            min={1}
            max={20}
            value={String(props.topK)}
            onChange={(e) => props.setTopK(Number(e.target.value))}
          />
        </Field>
        <Field label="Strictness">
          <Select value={props.strictness} onChange={(e) => props.setStrictness(e.target.value as ExternalKbStrictness)}>
            {STRICTNESS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Rerank">
          <label className="flex items-center gap-2 px-1 py-2 text-sm">
            <input type="checkbox" checked={props.rerank} onChange={(e) => props.setRerank(e.target.checked)} />
            <span>{props.rerank ? 'Açık' : 'Kapalı'}</span>
          </label>
        </Field>
        <Field label="Verify">
          <label className="flex items-center gap-2 px-1 py-2 text-sm">
            <input type="checkbox" checked={props.verify} onChange={(e) => props.setVerify(e.target.checked)} />
            <span>{props.verify ? 'Açık' : 'Kapalı'}</span>
          </label>
        </Field>
      </div>
      <SourceTypePicker value={props.sources} onToggle={props.onToggleSource} />
      <SubmitRow loading={props.loading} disabled={props.disabled} onSubmit={props.onSubmit} label="Soru Sor" />
    </>
  );
}

function SearchTab(props: {
  query: string; setQuery: (v: string) => void;
  topK: number; setTopK: (n: number) => void;
  sources: string[]; onToggleSource: (v: string) => void;
  loading: boolean; onSubmit: () => void; disabled: boolean;
}) {
  return (
    <>
      <Field label="Sorgu" required hint="3-2000 karakter arası">
        <TextArea
          rows={3}
          value={props.query}
          onChange={(e) => props.setQuery(e.target.value)}
          placeholder="Arama sorgusu..."
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="topK">
          <TextInput
            type="number"
            min={1}
            max={20}
            value={String(props.topK)}
            onChange={(e) => props.setTopK(Number(e.target.value))}
          />
        </Field>
      </div>
      <SourceTypePicker value={props.sources} onToggle={props.onToggleSource} />
      <SubmitRow loading={props.loading} disabled={props.disabled} onSubmit={props.onSubmit} label="Kaynak Ara" />
    </>
  );
}

function CategorizeTab(props: {
  description: string; setDescription: (v: string) => void;
  loading: boolean; onSubmit: () => void; disabled: boolean;
}) {
  return (
    <>
      <Field label="Vaka açıklaması" required hint="5-8000 karakter arası">
        <TextArea
          rows={5}
          value={props.description}
          onChange={(e) => props.setDescription(e.target.value)}
          placeholder="Vaka açıklamasını yapıştırın..."
        />
      </Field>
      <SubmitRow loading={props.loading} disabled={props.disabled} onSubmit={props.onSubmit} label="Kategorize Et" />
    </>
  );
}

function AnalyzeTab(props: {
  freeText: string; setFreeText: (v: string) => void;
  loading: boolean; onSubmit: () => void; disabled: boolean;
}) {
  return (
    <>
      <Field label="Serbest metin" required hint="3-8000 karakter arası">
        <TextArea
          rows={5}
          value={props.freeText}
          onChange={(e) => props.setFreeText(e.target.value)}
          placeholder="Analiz edilecek metni yapıştırın..."
        />
      </Field>
      <SubmitRow loading={props.loading} disabled={props.disabled} onSubmit={props.onSubmit} label="Analiz Et" />
    </>
  );
}

function SourceTypePicker({ value, onToggle }: { value: string[]; onToggle: (v: string) => void }) {
  return (
    <Field label="Source Types" hint="Boş bırakılırsa tüm allowlist tipleri">
      <div className="flex flex-wrap gap-1.5">
        {SOURCE_TYPE_OPTIONS.map((o) => {
          const active = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onToggle(o.value)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
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
    </Field>
  );
}

function SubmitRow({ loading, disabled, onSubmit, label }: { loading: boolean; disabled: boolean; onSubmit: () => void; label: string }) {
  return (
    <div className="flex items-center justify-end border-t border-slate-200 pt-3 dark:border-ndark-border">
      <Button
        onClick={onSubmit}
        disabled={disabled || loading}
        leftIcon={loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
      >
        {loading ? 'Gönderiliyor…' : label}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Status panel
// ─────────────────────────────────────────────────────────────────

function StatusPanel({ status }: { status: ExternalKbSettingsStatus | null }) {
  if (!status) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-ndark-border dark:bg-ndark-card/40 dark:text-ndark-muted">
        Bağlantı durumu yükleniyor…
      </div>
    );
  }
  if (!status.configured) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        Bu şirket için dış Bilgi Bankası ayarı kaydedilmemiş. Yönetim Panelinde
        "Bilgi Bankası Entegrasyonu" altından tanımla.
      </div>
    );
  }
  if (!status.enabled) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
        Dış Bilgi Bankası bu şirkette <strong>kapalı</strong>. Admin "Aktif"
        seçeneğini açtığında çağrılar yapılabilir.
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
      <div className="flex items-center gap-1.5">
        <CheckCircle2 size={12} />
        <span className="font-medium">Aktif</span>
        {status.providerName && <span className="text-emerald-700 dark:text-emerald-300">— {status.providerName}</span>}
      </div>
      <div className="text-emerald-700 dark:text-emerald-300">
        Auth: <code>{status.authType}</code>
        {status.authType !== 'none' && (
          <> · Secret <strong>{status.secretConfigured ? 'tanımlı' : 'TANIMSIZ'}</strong></>
        )}
        {' '}· topK <strong>{status.defaultTopK}</strong> · strictness <strong>{status.defaultStrictness}</strong>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Wrapped response viewer — readable cards + raw JSON
// ─────────────────────────────────────────────────────────────────

function WrappedResponseViewer({
  resp,
  onCopy,
}: {
  resp: ExternalKbWrappedResponse;
  onCopy: (obj: unknown) => void;
}) {
  if (!resp.ok) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">{resp.error.message}</div>
            <div className="text-xs">
              code: <code>{resp.error.code}</code>
              {resp.error.status != null && <> · status: <code>{resp.error.status}</code></>}
            </div>
          </div>
        </div>
        {(resp.data !== undefined && resp.data !== null) && (
          <RawJsonPanel data={resp.data} onCopy={onCopy} />
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <SuccessReadable data={resp.data} endpoint={resp.endpoint} />
      <RawJsonPanel data={resp.data} onCopy={onCopy} meta={resp.meta} />
    </div>
  );
}

function SuccessReadable({ data, endpoint }: { data: unknown; endpoint: ExternalKbEndpoint }) {
  if (data === null || data === undefined) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-ndark-border dark:bg-ndark-card/40 dark:text-ndark-muted">
        Boş yanıt.
      </div>
    );
  }
  if (typeof data !== 'object') {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-800 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text">
        {String(data)}
      </div>
    );
  }
  const obj = data as Record<string, unknown>;

  const cards: React.ReactNode[] = [];

  // answer (ask)
  if (typeof obj.answer === 'string') {
    cards.push(
      <Section key="answer" title="Yanıt" icon={<Sparkles size={11} />}>
        <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-ndark-text">{obj.answer}</p>
        {typeof obj.confidence === 'number' && (
          <div className="mt-1">
            <Badge tint="violet">%{Math.round((obj.confidence as number) * 100)} güven</Badge>
          </div>
        )}
        {typeof obj.reason === 'string' && (
          <p className="mt-1 text-xs text-slate-500 dark:text-ndark-muted">{obj.reason}</p>
        )}
      </Section>,
    );
  }

  // citations
  if (Array.isArray(obj.citations) && obj.citations.length > 0) {
    cards.push(
      <Section key="citations" title="Kaynaklar (citations)" icon={<Layers size={11} />}>
        <ul className="space-y-1 text-xs">
          {obj.citations.map((c: any, i: number) => (
            <li key={i} className="rounded-md bg-slate-50 px-2 py-1.5 dark:bg-ndark-bg">
              <div className="font-medium text-slate-800 dark:text-ndark-text">{c?.title ?? '—'}</div>
              {c?.excerpt && <div className="text-slate-600 dark:text-ndark-muted">{c.excerpt}</div>}
              {c?.url && (
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline dark:text-brand-300">
                  {c.url}
                </a>
              )}
            </li>
          ))}
        </ul>
      </Section>,
    );
  }

  // hits / search
  if (Array.isArray(obj.hits) && obj.hits.length > 0) {
    cards.push(
      <Section key="hits" title={`Sonuçlar (${obj.hits.length})`} icon={<Search size={11} />}>
        <ul className="space-y-1 text-xs">
          {obj.hits.map((h: any, i: number) => (
            <li key={i} className="rounded-md bg-slate-50 px-2 py-1.5 dark:bg-ndark-bg">
              <div className="font-medium text-slate-800 dark:text-ndark-text">{h?.title ?? h?.id ?? `Hit #${i + 1}`}</div>
              {h?.snippet && <div className="text-slate-600 dark:text-ndark-muted">{h.snippet}</div>}
              {typeof h?.score === 'number' && (
                <div className="text-[10px] text-slate-500">score: {h.score.toFixed?.(3) ?? h.score}</div>
              )}
            </li>
          ))}
        </ul>
      </Section>,
    );
  }

  // category_id / category_sub (categorize)
  if (typeof obj.category_id === 'string' || typeof obj.category_sub === 'string') {
    cards.push(
      <Section key="cat" title="Kategori (raw)" icon={<Tags size={11} />}>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <KeyValue label="category_id" value={obj.category_id} />
          <KeyValue label="category_sub" value={obj.category_sub} />
          {typeof obj.confidence === 'number' && (
            <KeyValue label="confidence" value={`%${Math.round((obj.confidence as number) * 100)}`} />
          )}
        </div>
      </Section>,
    );
  }

  // root_cause_id / root_cause_sub
  if (typeof obj.root_cause_id === 'string' || typeof obj.root_cause_sub === 'string') {
    cards.push(
      <Section key="rc" title="Kök Neden (raw)" icon={<AlertTriangle size={11} />}>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <KeyValue label="root_cause_id" value={obj.root_cause_id} />
          <KeyValue label="root_cause_sub" value={obj.root_cause_sub} />
        </div>
      </Section>,
    );
  }

  // analysis.* (analyze endpoint)
  const analysis = (obj.analysis ?? null) as Record<string, unknown> | null;
  if (analysis && typeof analysis === 'object') {
    if (typeof analysis.inferred === 'string') {
      cards.push(
        <Section key="a-inferred" title="Çıkarım" icon={<Brain size={11} />}>
          <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-ndark-text">{analysis.inferred}</p>
        </Section>,
      );
    }
    if (Array.isArray(analysis.rootCauseHypotheses) && analysis.rootCauseHypotheses.length > 0) {
      cards.push(
        <Section key="a-rch" title="Kök Neden Hipotezleri" icon={<AlertTriangle size={11} />}>
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-800 dark:text-ndark-text">
            {(analysis.rootCauseHypotheses as unknown[]).map((h, i) => (
              <li key={i}>{typeof h === 'string' ? h : JSON.stringify(h)}</li>
            ))}
          </ul>
        </Section>,
      );
    }
    if (Array.isArray(analysis.suggestedSteps) && analysis.suggestedSteps.length > 0) {
      cards.push(
        <Section key="a-steps" title="Önerilen Adımlar" icon={<Layers size={11} />}>
          <ol className="list-inside list-decimal space-y-1 text-sm text-slate-800 dark:text-ndark-text">
            {(analysis.suggestedSteps as unknown[]).map((s, i) => (
              <li key={i}>{typeof s === 'string' ? s : JSON.stringify(s)}</li>
            ))}
          </ol>
        </Section>,
      );
    }
    if (typeof analysis.customerReplyDraft === 'string') {
      cards.push(
        <Section key="a-reply" title="Müşteri Yanıt Taslağı" icon={<Sparkles size={11} />}>
          <p className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:bg-ndark-bg dark:text-ndark-text">
            {analysis.customerReplyDraft as string}
          </p>
        </Section>,
      );
    }
    if (analysis.engineeringHandoff !== undefined && analysis.engineeringHandoff !== null) {
      cards.push(
        <Section key="a-eng" title="Mühendislik Devri" icon={<Layers size={11} />}>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-[11px] text-slate-700 dark:bg-ndark-bg dark:text-ndark-muted">
            {typeof analysis.engineeringHandoff === 'string'
              ? analysis.engineeringHandoff
              : JSON.stringify(analysis.engineeringHandoff, null, 2)}
          </pre>
        </Section>,
      );
    }
  }

  // similar / panoramaScreens / kbChunks
  if (Array.isArray((obj as any).similar) && (obj as any).similar.length > 0) {
    cards.push(
      <Section key="similar" title="Benzer Vakalar" icon={<Layers size={11} />}>
        <ul className="space-y-1 text-xs">
          {(obj as any).similar.map((s: any, i: number) => (
            <li key={i} className="rounded-md bg-slate-50 px-2 py-1 dark:bg-ndark-bg">{typeof s === 'string' ? s : JSON.stringify(s)}</li>
          ))}
        </ul>
      </Section>,
    );
  }
  if (Array.isArray((obj as any).panoramaScreens) && (obj as any).panoramaScreens.length > 0) {
    cards.push(
      <Section key="panorama" title="Panorama Ekranları" icon={<Layers size={11} />}>
        <ul className="space-y-1 text-xs">
          {(obj as any).panoramaScreens.map((s: any, i: number) => (
            <li key={i} className="rounded-md bg-slate-50 px-2 py-1 dark:bg-ndark-bg">{typeof s === 'string' ? s : JSON.stringify(s)}</li>
          ))}
        </ul>
      </Section>,
    );
  }
  if (Array.isArray((obj as any).kbChunks) && (obj as any).kbChunks.length > 0) {
    cards.push(
      <Section key="chunks" title="KB Chunks" icon={<Layers size={11} />}>
        <ul className="space-y-1 text-xs">
          {(obj as any).kbChunks.map((s: any, i: number) => (
            <li key={i} className="rounded-md bg-slate-50 px-2 py-1 dark:bg-ndark-bg">{typeof s === 'string' ? s : JSON.stringify(s)}</li>
          ))}
        </ul>
      </Section>,
    );
  }

  // Fallback: no known keys recognised → empty cards array; raw JSON below will still show.
  void endpoint;
  if (cards.length === 0) {
    return null;
  }
  return <div className="space-y-2">{cards}</div>;
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-3 dark:border-ndark-border dark:bg-ndark-card">
      <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
        {icon}
        {title}
      </h4>
      {children}
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md bg-slate-50 px-2 py-1 dark:bg-ndark-bg">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-mono text-slate-800 dark:text-ndark-text">{value === undefined || value === null ? '—' : String(value)}</div>
    </div>
  );
}

function RawJsonPanel({
  data,
  onCopy,
  meta,
}: {
  data: unknown;
  onCopy: (obj: unknown) => void;
  meta?: { proxiedAt: string; latencyMs: number };
}) {
  const [open, setOpen] = useState(true);
  const text = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }, [data]);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-md border border-slate-200 bg-slate-50 dark:border-ndark-border dark:bg-ndark-bg"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-slate-700 dark:text-ndark-muted">
        <span>Ham Yanıt (Raw JSON)</span>
        <span className="flex items-center gap-2 text-[10px] text-slate-500">
          {meta && <span>· {meta.latencyMs} ms</span>}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onCopy(data);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted"
          >
            <Copy size={10} /> Kopyala
          </button>
        </span>
      </summary>
      <pre className="overflow-x-auto px-3 pb-3 text-[11px] leading-relaxed text-slate-700 dark:text-ndark-muted">
        {text}
      </pre>
    </details>
  );
}

function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-ndark-muted">
      {icon}
      {children}
    </div>
  );
}
