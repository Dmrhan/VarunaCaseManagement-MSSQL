/**
 * Bağlantılı Destek "Bağlantı Al" başlat-butonu (yeniden kullanılabilir).
 *
 * Case Detail / Akıllı Ticket Stage 2'deki RemoteSupportSection kartından
 * bağımsız, tek başına kullanılabilir. Özellikle Akıllı Ticket AÇILIŞINDA
 * (Stage 1) kullanılır: orada vaka henüz yoktur; `getCaseId` çağrıldığında
 * vaka hızlıca oluşturulur (yavaş AI çözüm-adımı importu beklenmeden) ve
 * dönen caseId ile oturum başlatılır.
 *
 * getCaseId: caseId'yi çözer/oluşturur (null → iptal, hata → toast getCaseId'de).
 * onStarted: oturum kaydı sonrası (liste yenileme vb.) opsiyonel callback.
 */
import { useState } from 'react';
import { Loader2, Monitor } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { remoteSupportService } from '@/services/remoteSupportService';

interface RemoteSupportStartButtonProps {
  getCaseId: () => Promise<string | null>;
  disabled?: boolean;
  onStarted?: () => void;
  label?: string;
  size?: 'sm' | 'md';
  variant?: 'outline' | 'primary';
}

export function RemoteSupportStartButton({
  getCaseId,
  disabled = false,
  onStarted,
  label = 'Bağlantı Al',
  size = 'sm',
  variant = 'outline',
}: RemoteSupportStartButtonProps) {
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [tvId, setTvId] = useState('');
  const [starting, setStarting] = useState(false);

  async function handleStart() {
    const clean = tvId.replace(/\s+/g, '');
    if (!/^\d{5,15}$/.test(clean)) {
      toast({ type: 'warn', message: 'Geçerli bir müşteri TeamViewer ID girin (sadece rakam).', duration: 2500 });
      return;
    }
    setStarting(true);
    try {
      // Önce caseId'yi çöz/oluştur (Stage 1'de vaka burada hızlıca yaratılır).
      const caseId = await getCaseId();
      if (!caseId) return; // iptal / oluşturulamadı (toast getCaseId'de)
      const res = await remoteSupportService.start(caseId, clean, 'deeplink');
      if (!res) return; // apiFetch toast'ladı
      toast({ type: 'success', message: 'Bağlantılı destek başlatıldı. Süre gece senkronunda hesaplanacak.', duration: 3000 });
      setModalOpen(false);
      setTvId('');
      try {
        window.location.href = res.launch.deepLink;
      } catch {
        /* deep link başarısız → işaret yine kaydedildi */
      }
      onStarted?.();
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <Button
        size={size}
        variant={variant}
        leftIcon={<Monitor size={13} />}
        disabled={disabled}
        onClick={() => setModalOpen(true)}
      >
        {label}
      </Button>

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
    </>
  );
}
