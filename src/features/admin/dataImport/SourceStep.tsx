import { useRef, useState } from 'react';
import { FileSpreadsheet, Globe2, Upload, Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { importService, parseCsvText } from '@/services/importService';
import type { ParsedSource } from './types';

interface Props {
  companyId: string;
  onParsed: (source: ParsedSource) => void;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_ROWS = 5000;

export function SourceStep({ companyId, onParsed }: Props) {
  const [mode, setMode] = useState<'file' | 'api'>('file');

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-ndark-text">
                Kaynak Seç
              </h3>
              <p className="text-xs text-slate-500 dark:text-ndark-muted">
                Veriyi Excel/CSV dosyasından veya harici bir API'den alıp Varuna müşteri alanlarına eşleştirin.
              </p>
            </div>
            <a
              href={importService.templateUrl()}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
              download
            >
              <Download size={12} />
              Şablon İndir
            </a>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('file')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                mode === 'file'
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-ndark-card dark:text-ndark-text dark:border-ndark-accent'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted'
              }`}
            >
              <FileSpreadsheet size={14} />
              Dosya Yükle
            </button>
            <button
              type="button"
              onClick={() => setMode('api')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                mode === 'api'
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-ndark-card dark:text-ndark-text dark:border-ndark-accent'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted'
              }`}
            >
              <Globe2 size={14} />
              API'den Al
            </button>
          </div>
        </CardBody>
      </Card>

      {mode === 'file' ? (
        <FileSourcePanel companyId={companyId} onParsed={onParsed} />
      ) : (
        <ApiSourcePanel companyId={companyId} onParsed={onParsed} />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────
// File source
// ───────────────────────────────────────────────────────

function FileSourcePanel({ companyId, onParsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setPicked({ name: file.name, size: file.size });
    if (file.size > MAX_BYTES) {
      setError('Dosya 5MB sınırını aştı.');
      return;
    }
    setBusy(true);
    try {
      const lower = file.name.toLowerCase();
      let columns: string[] = [];
      let rows: Array<Record<string, unknown>> = [];
      if (lower.endsWith('.csv') || file.type.includes('csv') || file.type === 'text/plain') {
        const text = await file.text();
        const parsed = parseCsvText(text);
        columns = parsed.columns;
        rows = parsed.rows;
      } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        // Dynamic import — xlsx kütüphanesi yalnızca bu adımda yüklenir
        const { read, utils } = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = read(buf, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) throw new Error('Çalışma sayfası bulunamadı.');
        const ws = wb.Sheets[sheetName];
        const json = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
        if (json.length === 0) {
          columns = [];
          rows = [];
        } else {
          const colSet = new Set<string>();
          for (const r of json) Object.keys(r).forEach((k) => colSet.add(k));
          columns = [...colSet];
          rows = json;
        }
      } else {
        setError('Desteklenmeyen dosya türü. CSV veya XLSX yükleyin.');
        setBusy(false);
        return;
      }

      if (rows.length > MAX_ROWS) {
        setError(`Satır sayısı ${MAX_ROWS} sınırını aştı.`);
        setBusy(false);
        return;
      }
      if (columns.length === 0) {
        setError('Sütun başlığı bulunamadı.');
        setBusy(false);
        return;
      }

      // Duplicate header uyarısı
      const dupSet = new Set<string>();
      const seen = new Set<string>();
      for (const c of columns) {
        if (seen.has(c)) dupSet.add(c);
        seen.add(c);
      }
      if (dupSet.size > 0) {
        setError(`Tekrarlanan sütun başlıkları: ${[...dupSet].join(', ')}`);
        setBusy(false);
        return;
      }

      const r = await importService.parseFile({ companyId, columns, rows, fileName: file.name });
      if (!r) {
        setBusy(false);
        return;
      }

      onParsed({
        sourceType: 'file',
        fileName: file.name,
        sourceName: null,
        sourceUrlMasked: null,
        dataPath: null,
        columns: r.columns,
        rows,
        sample: r.sample,
        totalRows: r.totalRows,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Dosya okunamadı.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void handleFile(file);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40 dark:border-ndark-border dark:bg-ndark-surface dark:hover:border-ndark-accent"
        >
          <Upload size={28} className="text-slate-400" />
          <div className="text-sm font-medium text-slate-700 dark:text-ndark-text">
            CSV veya XLSX dosyası bırakın
          </div>
          <div className="text-xs text-slate-500 dark:text-ndark-muted">
            ya da tıklayarak seçin · maks. 5MB · maks. 5000 satır
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
        </div>

        {picked && (
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-muted">
            {picked.name} · {(picked.size / 1024).toFixed(1)} KB
          </div>
        )}
        {busy && (
          <div className="text-xs text-slate-500 dark:text-ndark-muted">Dosya işleniyor…</div>
        )}
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-200">
            {error}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ───────────────────────────────────────────────────────
// API source
// ───────────────────────────────────────────────────────

function ApiSourcePanel({ companyId, onParsed }: Props) {
  const [sourceName, setSourceName] = useState('');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState<'none' | 'bearerToken' | 'apiKeyHeader'>('none');
  const [secretName, setSecretName] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [dataPath, setDataPath] = useState('');
  const [sampleLimit, setSampleLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchSample() {
    setError(null);
    if (!url.trim()) {
      setError('URL gerekli.');
      return;
    }
    let headersJson: Record<string, string> | null = null;
    if (headersText.trim()) {
      try {
        headersJson = JSON.parse(headersText);
        if (typeof headersJson !== 'object' || Array.isArray(headersJson)) {
          throw new Error('headers JSON bir nesne olmalı');
        }
      } catch (e) {
        setError('Headers JSON çözümlenemedi.');
        return;
      }
    }
    let bodyJson: unknown = undefined;
    if (method === 'POST' && bodyText.trim()) {
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        setError('Body JSON çözümlenemedi.');
        return;
      }
    }
    setBusy(true);
    const r = await importService.sampleApi({
      companyId,
      sourceName: sourceName.trim() || undefined,
      url: url.trim(),
      method,
      authType,
      secretName: secretName.trim() || undefined,
      headersJson,
      bodyJson,
      dataPath: dataPath.trim() || null,
      sampleLimit,
    });
    setBusy(false);
    if (!r) return;
    if (!r.ok) {
      setError(r.message ?? 'API çağrısı başarısız.');
      return;
    }
    // WR-A8 review fix (Issue 1) — Önceden rows: r.sample atanıyordu; dry-run/
    // commit yalnız preview örneğini işliyordu. Şimdi r.rows (tüm satırlar)
    // import için tutulur; r.sample yalnız preview UX'inde kullanılır.
    const allRows = r.rows ?? r.sample ?? [];
    const previewSample = (r.sample ?? allRows).slice(0, 5);
    onParsed({
      sourceType: 'api',
      fileName: null,
      sourceName: r.sourceName ?? sourceName.trim() ?? null,
      sourceUrlMasked: r.sourceUrlMasked ?? null,
      dataPath: dataPath.trim() || null,
      columns: r.columns ?? [],
      rows: allRows,
      sample: previewSample,
      totalRows: r.totalRows ?? allRows.length,
    });
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Kaynak Adı">
            <TextInput
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="örn. CRM accounts pull"
            />
          </Field>
          <Field label="Metot">
            <Select value={method} onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </Select>
          </Field>
          <Field label="URL" className="md:col-span-2" required>
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/accounts"
            />
          </Field>
          <Field label="Yetkilendirme">
            <Select
              value={authType}
              onChange={(e) => setAuthType(e.target.value as typeof authType)}
            >
              <option value="none">Yok</option>
              <option value="bearerToken">Bearer Token</option>
              <option value="apiKeyHeader">X-API-Key Header</option>
            </Select>
          </Field>
          <Field label="Secret Env Adı" hint="Anahtar burada saklanmaz. Sunucu ortam değişkeni adı.">
            <TextInput
              value={secretName}
              onChange={(e) => setSecretName(e.target.value)}
              placeholder="örn. CRM_API_KEY"
              disabled={authType === 'none'}
            />
          </Field>
          <Field label="Ekstra Headers (JSON)" hint='örn. {"X-Tenant":"varuna"}' className="md:col-span-2">
            <TextArea
              rows={2}
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder='{}'
            />
          </Field>
          {method === 'POST' && (
            <Field label="Body (JSON)" className="md:col-span-2">
              <TextArea
                rows={3}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder='{ "filter": "all" }'
              />
            </Field>
          )}
          <Field label="dataPath" hint='Yanıtta dizi yolu (örn. "data" veya "items.records"). Boş = kök yanıt.'>
            <TextInput
              value={dataPath}
              onChange={(e) => setDataPath(e.target.value)}
              placeholder="data"
            />
          </Field>
          <Field label="Örnek Limiti">
            <TextInput
              type="number"
              min={1}
              max={500}
              value={sampleLimit}
              onChange={(e) => setSampleLimit(Math.max(1, Math.min(500, Number(e.target.value) || 50)))}
            />
          </Field>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button onClick={fetchSample} disabled={busy || !url.trim()}>
            {busy ? 'Çekiliyor…' : 'Örnek Veri Getir'}
          </Button>
          {error && (
            <span className="text-xs font-medium text-rose-600 dark:text-red-400">{error}</span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
