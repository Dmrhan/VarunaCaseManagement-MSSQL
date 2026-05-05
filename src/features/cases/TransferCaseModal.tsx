import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Field';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { useToast } from '@/components/ui/Toast';
import { caseService, lookupService } from '@/services/caseService';
import { MentionTextarea, type MentionTextareaHandle } from './components/MentionTextarea';
import type { Case, CasePerson } from './types';

const MIN_NOTE = 10;

interface TransferCaseModalProps {
  isOpen: boolean;
  caseId: string;
  currentAssignedPersonId?: string;
  currentAssignedPersonName?: string;
  onClose: () => void;
  /** Devir tamamlandı, parent vakayı güncellemeli */
  onTransferred: (updated: Case) => void;
}

/**
 * Vakayı başka bir kişiye devir akışı.
 * - Mevcut atanan kişi listeden çıkarılır
 * - Devir notu zorunlu (min 10 karakter), VoiceNoteButton destekli
 * - Save: caseService.update + addActivity (Transfer) + addNote (Internal)
 */
export function TransferCaseModal({
  isOpen,
  caseId,
  currentAssignedPersonId,
  currentAssignedPersonName,
  onClose,
  onTransferred,
}: TransferCaseModalProps) {
  const persons = useMemo(() => lookupService.persons(), []);
  const teams = useMemo(() => lookupService.teams(), []);

  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // VoiceNoteButton transcript'i textarea'ya cursor pozisyonuna insert için ref.
  const noteRef = useRef<MentionTextareaHandle | null>(null);
  const { toast } = useToast();

  // Modal her açıldığında state'i sıfırla
  useEffect(() => {
    if (isOpen) {
      setSelectedPersonId('');
      setTransferNote('');
      setSubmitting(false);
    }
  }, [isOpen]);

  // Mevcut atanan kişi listeden çıkarılır
  const availablePersons = useMemo(
    () => persons.filter((p) => p.id !== currentAssignedPersonId),
    [persons, currentAssignedPersonId],
  );

  const noteOk = transferNote.trim().length >= MIN_NOTE;
  const personOk = !!selectedPersonId;
  const canSubmit = noteOk && personOk && !submitting;

  async function handleTransfer() {
    if (!canSubmit) return;
    const selectedPerson = availablePersons.find((p) => p.id === selectedPersonId);
    if (!selectedPerson) return;
    const selectedTeam = teams.find((t) => t.id === selectedPerson.teamId);

    setSubmitting(true);

    // 1. Atama alanlarını güncelle (otomatik history log: 'Alan güncellendi')
    const after = await caseService.update(caseId, {
      assignedPersonId: selectedPerson.id,
      assignedPersonName: selectedPerson.name,
      assignedTeamId: selectedPerson.teamId,
      assignedTeamName: selectedTeam?.name,
    });
    if (!after) {
      setSubmitting(false);
      toast({ type: 'error', message: 'Vaka bulunamadı.' });
      return;
    }

    // 2. Activity log — Transfer aksiyonu (ActivityTab'de amber tint render edilir)
    const trimmedNote = transferNote.trim();
    const fromName = currentAssignedPersonName ?? '—';
    const afterActivity = await caseService.addActivity(caseId, {
      actionType: 'Transfer',
      action: `Vaka devredildi: ${fromName} → ${selectedPerson.name}`,
      fieldName: 'assignedPersonId',
      oldValue: fromName,
      newValue: selectedPerson.name,
      note: trimmedNote,
    });

    // 3. İç not ekle (operasyonel iz)
    await caseService.addNote(caseId, {
      content: `Vaka devredildi: ${fromName} → ${selectedPerson.name}\nDevir notu: ${trimmedNote}`,
      visibility: 'Internal',
      authorName: 'Mock User',
    });

    setSubmitting(false);

    // En güncel halini parent'a ver (note + activity sonrası)
    const finalCase = (await caseService.get(caseId)) ?? afterActivity ?? after;
    onTransferred(finalCase);
    onClose();

    toast({
      type: 'success',
      message: `Vaka ${selectedPerson.name} adlı kişiye devredildi ✓`,
      duration: 2500,
    });
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="md"
      title="Vakayı Devret"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button onClick={handleTransfer} disabled={!canSubmit}>
            {submitting ? 'Devrediliyor…' : 'Devret'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Mevcut atanan kişi bilgisi */}
        <div className="text-xs text-slate-500 dark:text-ndark-muted">
          Şu an atanan:{' '}
          <span className="font-medium text-slate-700 dark:text-ndark-text">
            {currentAssignedPersonName ?? 'Atanmamış'}
          </span>
        </div>

        <Field label="Yeni Atanacak Kişi" required>
          <Select
            value={selectedPersonId}
            onChange={(e) => setSelectedPersonId(e.target.value)}
          >
            <option value="">Kişi seçin…</option>
            {availablePersons.length === 0 ? (
              <option disabled>(Devredilebilecek başka kişi yok)</option>
            ) : (
              availablePersons.map((p: CasePerson) => {
                const team = teams.find((t) => t.id === p.teamId);
                return (
                  <option key={p.id} value={p.id}>
                    {p.name} — {team?.name ?? p.teamId}
                  </option>
                );
              })
            )}
          </Select>
        </Field>

        <Field
          label="Devir Notu"
          required
          hint={`En az ${MIN_NOTE} karakter (mevcut: ${transferNote.trim().length}). @ ile bir kişiyi etiketleyebilirsin.`}
          actions={
            <VoiceNoteButton
              onTranscript={(chunk) => setTransferNote((t) => (t ? `${t} ${chunk}` : chunk))}
            />
          }
          error={transferNote.trim().length > 0 && !noteOk ? 'Devir notu çok kısa' : undefined}
        >
          <MentionTextarea
            ref={noteRef}
            caseId={caseId}
            value={transferNote}
            onChange={setTransferNote}
            placeholder="Yeni atanacak kişinin bilmesi gerekenler: vaka durumu, müşteri ile iletişim, beklemede olan aksiyonlar…"
            rows={4}
          />
        </Field>
      </div>
    </Modal>
  );
}
