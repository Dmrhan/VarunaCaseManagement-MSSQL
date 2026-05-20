import { useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, Loader2, Search } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field';
import { lookupService } from '@/services/caseService';
import {
  askExternalKbMock,
  type ExternalKbAnswer,
  type ExternalKbAskResponse,
} from '@/services/externalKbService';

/**
 * WR-KB2 — Bilgi Bankası standalone test ekranı.
 *
 * Bağımsız sayfa: CaseDetailPage / NewCaseForm / transfer / product/package
 * akışlarına DOKUNULMAZ. Tüm rollere açık (Agent, Backoffice, Supervisor,
 * CSM, Admin, SystemAdmin). Şu an MOCK yanıt; gerçek API hazır olunca
 * `externalKbService.askExternalKbMock` yerine gerçek fetch koyulacak.
 *
 * Hiçbir backend endpoint çağrılmaz. DB / şema / migration / case mutation
 * etkilenmez.
 */
export function KnowledgeBasePage() {
  const companies = useMemo(() => lookupService.companies(), []);

  const [query, setQuery] = useState('');
  const [companyId, setCompanyId] = useState<string>(
    companies.length === 1 ? companies[0].id : '',
  );
  const [caseNumber, setCaseNumber] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ExternalKbAskResponse | null>(null);

  const canAsk = !loading && query.trim().length > 0;

  async function handleAsk() {
    if (!canAsk) return;
    setLoading(true);
    setError(null);
    try {
      const res = await askExternalKbMock({
        query: query.trim(),
        companyId: companyId || null,
        caseNumber: caseNumber.trim() || null,
      });
      setResponse(res);
    } catch (e) {
      setError((e as Error)?.message ?? 'Bilinmeyen hata.');
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setQuery('');
    setCaseNumber('');
    setResponse(null);
    setError(null);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BookOpen size={20} className="text-brand-600 dark:text-brand-400" />
        <h1 className="text-xl font-semibold text-slate-800 dark:text-ndark-text">
          Bilgi Bankası
        </h1>
      </div>

      {/* Future-API notice */}
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        Bu ekran dış Bilgi Bankası API'sine bağlanacak. API kontratı netleşene
        kadar yanıtlar yerel <strong>mock</strong>'tur; gerçek arama yapılmaz.
      </div>

      {/* Input card */}
      <Card>
        <CardBody>
          <div className="space-y-4">
            <Field label="Soru" required>
              <TextArea
                rows={4}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Sorunuzu yazın..."
                aria-label="Bilgi Bankası sorgusu"
              />
            </Field>

            {companies.length > 1 && (
              <Field label="Şirket" hint="Erişim yetkin olan şirketler">
                <Select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                >
                  <option value="">— Tümü / filtresiz —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field
              label="Vaka No"
              hint="Opsiyonel — şu an arama yapılmaz, sonraki fazda bağlam olarak gönderilecek"
            >
              <TextInput
                value={caseNumber}
                onChange={(e) => setCaseNumber(e.target.value)}
                placeholder="ör. VK-MPBTGQUJ"
              />
            </Field>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-ndark-border">
              {(query || caseNumber || response || error) && (
                <Button variant="outline" onClick={handleReset} disabled={loading}>
                  Temizle
                </Button>
              )}
              <Button
                onClick={handleAsk}
                disabled={!canAsk}
                leftIcon={loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              >
                {loading ? 'Sorgulanıyor…' : 'Sorgula'}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Result area */}
      <ResultArea loading={loading} error={error} response={response} />
    </div>
  );
}

function ResultArea({
  loading,
  error,
  response,
}: {
  loading: boolean;
  error: string | null;
  response: ExternalKbAskResponse | null;
}) {
  if (loading) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-ndark-muted">
            <Loader2 size={14} className="animate-spin" />
            Sorgu hazırlanıyor…
          </div>
        </CardBody>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Sorgu başarısız.</div>
              <div className="text-xs">{error}</div>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (!response) {
    return (
      <Card>
        <CardBody>
          <div className="text-sm text-slate-500 dark:text-ndark-muted">
            Soru girip <strong>Sorgula</strong>'ya tıkla; yanıtlar burada listelenecek.
          </div>
        </CardBody>
      </Card>
    );
  }

  if (response.answers.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="text-sm text-slate-500 dark:text-ndark-muted">
            Yanıt bulunamadı.
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {response.answers.map((a, i) => (
        <AnswerCard key={i} answer={a} />
      ))}
    </div>
  );
}

function AnswerCard({ answer }: { answer: ExternalKbAnswer }) {
  return (
    <Card>
      <CardBody>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-ndark-text">
              {answer.title ?? 'Yanıt'}
            </h3>
            {typeof answer.confidence === 'number' && (
              <Badge tint="violet">%{Math.round(answer.confidence * 100)} güven</Badge>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-ndark-muted">
            {answer.answer}
          </p>
          {answer.citations && answer.citations.length > 0 && (
            <div className="border-t border-slate-200 pt-2 dark:border-ndark-border">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Kaynaklar
              </div>
              <ul className="space-y-1 text-xs">
                {answer.citations.map((c, idx) => (
                  <li key={idx} className="text-slate-700 dark:text-ndark-muted">
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-700 underline hover:no-underline dark:text-brand-300"
                      >
                        {c.title ?? c.url}
                      </a>
                    ) : (
                      <span className="font-medium">{c.title ?? '—'}</span>
                    )}
                    {c.excerpt && (
                      <span className="ml-1 text-slate-500 dark:text-ndark-muted">
                        — {c.excerpt}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
