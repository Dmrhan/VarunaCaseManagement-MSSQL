import { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, Phone, Users, BellRing } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { apiFetch } from '@/services/caseService';
import { myService } from '@/services/myService';
import { SNOOZE_REASON_LABELS, type Case, type SnoozeReason } from '../types';

interface SnoozeModalProps {
  open: boolean;
  caseId: string;
  caseTitle: string;
  onClose: () => void;
  onSnoozed: (updated: Case) => void;
}

type Preset = '1h' | 'tomorrow9' | 'monday9' | 'custom';

const REASON_OPTIONS: Array<{ value: SnoozeReason; icon: React.ReactNode; hint: string }> = [
  { value: 'CustomerWillCall',  icon: <Phone size={14} />,    hint: 'Müşteri kendisi geri arayacağını söyledi.' },
  { value: 'WaitingThirdParty', icon: <Users size={14} />,    hint: 'Dış paydaştan/birimden cevap bekleniyor.' },
  { value: 'Reminder',          icon: <BellRing size={14} />, hint: 'Belirlenen zamanda yeniden bakılması için.' },
];

// Hızlı seçenek için tarih hesapla — yerel saatle datetime-local input formatı (YYYY-MM-DDTHH:mm).
function computePreset(p: Preset): string {
  const now = new Date();
  if (p === '1h') {
    const t = new Date(now.getTime() + 60 * 60 * 1000);
    return toLocalInput(t);
  }
  if (p === 'tomorrow9') {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    t.setHours(9, 0, 0, 0);
    return toLocalInput(t);
  }
  if (p === 'monday9') {
    const t = new Date(now);
    const day = t.getDay(); // 0=Sun, 1=Mon
    const diff = day === 1 ? 7 : (8 - day) % 7 || 7;
    t.setDate(t.getDate() + diff);
    t.setHours(9, 0, 0, 0);
    return toLocalInput(t);
  }
  return '';
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SnoozeModal({ open, caseId, caseTitle, onClose, onSnoozed }: SnoozeModalProps) {
  const [preset, setPreset] = useState<Preset>('tomorrow9');
  const [customAt, setCustomAt] = useState<string>('');
  const [reason, setReason] = useState<SnoozeReason>('CustomerWillCall');
  const [submitting, setSubmitting] = useState(false);
  // Snooze ile beraber kişisel takvime düşsün mü? Default ON — çoğu kullanıcı
  // ertelediği vakayı sonra hatırlamak istiyor; bu sayede ayrı "Bana Hatırlat"
  // akışı gerekmedi. Snooze "Vaka olayları" filter'ında zaten görünür ama
  // bu seçenek default "Hatırlatıcılarım" filter'ında violet kart oluşturur.
  const [addToCalendar, setAddToCalendar] = useState<boolean>(true);
  const { toast } = useToast();

  // Modal her açılışta temiz state — son seçim saklamıyoruz
  useEffect(() => {
    if (open) {
      setPreset('tomorrow9');
      setCustomAt('');
      setReason('CustomerWillCall');
      setAddToCalendar(true);
      setSubmitting(false);
    }
  }, [open]);

  const targetIso = useMemo(() => {
    const local = preset === 'custom' ? customAt : computePreset(preset);
    if (!local) return null;
    const d = new Date(local);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return null;
    return d.toISOString();
  }, [preset, customAt]);

  const presetLabel = useMemo(() => {
    if (preset === '1h') return '1 saat sonra';
    if (preset === 'tomorrow9') return 'Yarın 09:00';
    if (preset === 'monday9') return 'Pazartesi 09:00';
    return 'Özel zaman';
  }, [preset]);

  async function handleSubmit() {
    if (!targetIso) {
      toast({ type: 'error', title: 'Geçersiz zaman', message: 'Erteleme zamanı gelecekte olmalı.' });
      return;
    }
    setSubmitting(true);
    const body = { snoozeUntil: targetIso, snoozeReason: reason };
    console.log('[snooze] POST body:', body);
    const updated = await apiFetch<Case>(
      `/api/cases/${caseId}/snooze`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Vaka ertelenemedi',
    );
    setSubmitting(false);
    if (!updated) return; // apiFetch hata toast'ı kendi gösteriyor
    toast({
      type: 'success',
      title: 'Vaka ertelendi',
      message: `${presetLabel} — ${SNOOZE_REASON_LABELS[reason]}`,
    });
    onSnoozed(updated);
    onClose();

    // İkincil: kişisel takvim girdisi. Hata olursa sessizce geç — snooze ana
    // aksiyon, takvim girdisi yardımcı (apiFetch zaten toast atar).
    if (addToCalendar) {
      void myService.createReminder({
        caseId,
        remindAt: targetIso,
        message: SNOOZE_REASON_LABELS[reason],
      }).then((created) => {
        if (created) {
          window.dispatchEvent(new Event('app:calendar-changed'));
        }
      });
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Vakayı Ertele"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !targetIso} leftIcon={<Clock size={14} />}>
            {submitting ? 'Erteleniyor…' : 'Ertele'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <p className="text-xs text-slate-500">
          <span className="font-medium text-slate-700">{caseTitle}</span> — bu vaka belirlediğin zamana
          kadar Inbox'tan kaldırılır, "Later" sekmesinde görünür.
        </p>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">Ne zaman?</label>
          <div className="flex flex-wrap gap-2">
            {(['1h', 'tomorrow9', 'monday9', 'custom'] as const).map((p) => {
              const active = preset === p;
              const label =
                p === '1h' ? '1 saat sonra'
                : p === 'tomorrow9' ? 'Yarın 09:00'
                : p === 'monday9' ? 'Pazartesi 09:00'
                : 'Özel';
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`rounded-md px-3 py-1.5 text-xs ring-1 ring-inset transition ${
                    active
                      ? 'bg-brand-600 text-white ring-brand-600'
                      : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {preset === 'custom' && (
            <div className="mt-2">
              <TextInput
                type="datetime-local"
                value={customAt}
                min={toLocalInput(new Date(Date.now() + 5 * 60_000))}
                onChange={(e) => setCustomAt(e.target.value)}
              />
            </div>
          )}
          {preset !== 'custom' && (
            <div className="mt-1.5 text-xs text-slate-500">
              {targetIso
                ? `→ ${new Date(targetIso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
                : 'Geçersiz zaman'}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">Sebep</label>
          <div className="space-y-1.5">
            {REASON_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition ${
                  reason === opt.value
                    ? 'border-brand-400 bg-brand-50/60'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="snooze-reason"
                  value={opt.value}
                  checked={reason === opt.value}
                  onChange={() => setReason(opt.value)}
                  className="mt-0.5 accent-brand-600"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                    {opt.icon}
                    {SNOOZE_REASON_LABELS[opt.value]}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{opt.hint}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Takvime ekle — default ON. Kapatırsa snooze tek başına çalışır. */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 hover:bg-slate-100 dark:border-ndark-border dark:bg-ndark-card dark:hover:bg-ndark-bg">
          <input
            type="checkbox"
            checked={addToCalendar}
            onChange={(e) => setAddToCalendar(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-600"
          />
          <div className="flex-1">
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-ndark-text">
              <Calendar size={14} />
              Takvime ekle
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-ndark-muted">
              Kişisel takvimine bu zaman için bir hatırlatıcı düşer (yalnız sen görürsün).
            </div>
          </div>
        </label>
      </div>
    </Modal>
  );
}
