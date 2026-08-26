/**
 * Case Detail "Bağlantılı Destek (TeamViewer)" section.
 *
 * Davranış:
 *  - Mount: GET /api/cases/:id/remote-sessions → oturum listesi.
 *  - "Bağlantı Al" (Agent+): modal → müşteri TeamViewer ID → POST → işaret
 *    oluşur + TeamViewer deep-link ile açılmaya çalışılır.
 *  - Süre butonda ölçülmez; gece reconcile TeamViewer raporundan yazar.
 *    matchState: pending (bekliyor) / matched (süre yazıldı) / ambiguous / unmatched.
 *
 * Güvenlik: TeamViewer token/rapor frontend'e inmez — yalnız BFF çağrılır.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Monitor, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { remoteSupportService, type RemoteSession } from '@/services/remoteSupportService';
import type { CaseStatus } from '../types';

interface RemoteSupportSectionProps {
  caseId: string;
  canWrite: boolean;
  /** Kapalı (Çözüldü/İptal) vakaya bağlantılı destek başlatılamaz. */
  caseStatus: CaseStatus;
}

const fmtDur = (sec: number | null): string => {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} dk ${s} sn` : `${s} sn`;
};

const STATE_META: Record<RemoteSession['matchState'], { label: string; cls: string }> = {
  pending: { label: 'Süre bekleniyor', cls: 'bg-amber-100 text-amber-800' },
  matched: { label: 'Eşleşti', cls: 'bg-emerald-100 text-emerald-800' },
  ambiguous: { label: 'Belirsiz (en yakın)', cls: 'bg-orange-100 text-orange-800' },
  unmatched: { label: 'Eşleşmedi', cls: 'bg-slate-200 text-slate-600' },
};

const fmtDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

export function RemoteSupportSection({ caseId, canWrite, caseStatus }: RemoteSupportSectionProps) {
  const { toast } = useToast();
  const isClosed = caseStatus === 'Çözüldü' || caseStatus === 'İptalEdildi';
  const [sessions, setSessions] = useState<RemoteSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [tvId, setTvId] = useState('');
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await remoteSupportService.list(caseId);
    if (res) setSessions(res.items);
    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleStart() {
    const clean = tvId.replace(/\s+/g, '');
    if (!/^\d{5,15}$/.test(clean)) {
      toast({ type: 'warn', message: 'Geçerli bir müşteri TeamViewer ID girin (sadece rakam).', duration: 2500 });
      return;
    }
    setStarting(true);
    const res = await remoteSupportService.start(caseId, clean, 'deeplink');
    setStarting(false);
    if (!res) return; // toast apiFetch içinde
    toast({ type: 'success', message: 'Bağlantılı destek başlatıldı. Süre gece senkronunda hesaplanacak.', duration: 3000 });
    setModalOpen(false);
    setTvId('');
    // TeamViewer'ı açmayı dene (garantili açılış Windows launcher işi).
    try {
      window.location.href = res.launch.deepLink;
    } catch {
      /* deep link başarısız → sorun değil, işaret kaydedildi */
    }
    void load();
  }

  return (
    <div className="rounded-lg bg-white ring-1 ring-slate-100">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Monitor size={15} className="text-slate-400" />
          Bağlantılı Destek (TeamViewer)
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Yenile"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          {canWrite && !isClosed && (
            <Button size="sm" variant="outline" leftIcon={<Monitor size={13} />} onClick={() => setModalOpen(true)}>
              Bağlantı Al
            </Button>
          )}
          {canWrite && isClosed && (
            <span className="text-[11px] text-slate-400">Kapalı vakaya bağlantı eklenemez</span>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        {sessions.length === 0 ? (
          <p className="text-[13px] text-slate-500">Bu vakada bağlantılı destek oturumu yok.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => {
              const st = STATE_META[s.matchState];
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-[12.5px]">
                  <span className="font-medium text-slate-700">{fmtDate(s.startedAt)}</span>
                  <span className="text-slate-500">{s.agentName}</span>
                  <span className="text-slate-500">TV #{s.customerTvId}</span>
                  <span className="font-semibold text-slate-800">{fmtDur(s.durationSec)}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Bağlantılı Destek">
        <div className="space-y-3">
          <p className="text-[13px] text-slate-600">
            Müşteriden aldığın <strong>TeamViewer ID</strong>'sini gir. Bağlantı başlatılınca TeamViewer açılmayı
            deneyecek; oturum süresi gece TeamViewer raporundan otomatik hesaplanacak.
          </p>
          <TextInput
            value={tvId}
            onChange={(e) => setTvId(e.target.value)}
            placeholder="örn. 1 234 567 890"
            inputMode="numeric"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Vazgeç
            </Button>
            <Button
              onClick={() => void handleStart()}
              disabled={starting}
              leftIcon={starting ? <Loader2 size={14} className="animate-spin" /> : <Monitor size={14} />}
            >
              {starting ? 'Başlatılıyor…' : 'Bağlantı Al'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
