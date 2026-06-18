import { useState, type ReactNode } from 'react';
import { Send } from 'lucide-react';
import { Popover } from './Popover';
import { Button } from './Button';
import { TextArea } from './Field';
import { VoiceNoteButton } from './VoiceNoteButton';
import { useToast } from './Toast';
import { caseService } from '@/services/caseService';
import type { CaseNote, NoteVisibility } from '@/features/cases/types';

interface QuickNotePopoverProps {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  caseId: string;
  defaultVisibility?: NoteVisibility;
  align?: 'start' | 'end';
  width?: number;
  onAdded?: (note: CaseNote) => void;
}

export function QuickNotePopover({
  trigger,
  caseId,
  defaultVisibility = 'Internal',
  align = 'start',
  width = 360,
  onAdded,
}: QuickNotePopoverProps) {
  return (
    <Popover trigger={trigger} align={align} width={width}>
      {({ close }) => (
        <QuickNoteForm
          caseId={caseId}
          defaultVisibility={defaultVisibility}
          onClose={close}
          onAdded={onAdded}
        />
      )}
    </Popover>
  );
}

function QuickNoteForm({
  caseId,
  defaultVisibility,
  onClose,
  onAdded,
}: {
  caseId: string;
  defaultVisibility: NoteVisibility;
  onClose: () => void;
  onAdded?: (note: CaseNote) => void;
}) {
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<NoteVisibility>(defaultVisibility);
  const [submitting, setSubmitting] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    // Actor identity hardening: authorName backend req.user üzerinden yazılır;
    // FE'den göndermiyoruz (backend ignore eder, '?? Mock User' fallback yok).
    const created = await caseService.addNote(caseId, {
      content: text.trim(),
      visibility,
    });
    setSubmitting(false);
    if (created) {
      onAdded?.(created);
      toast({
        type: 'success',
        message: visibility === 'Internal' ? 'İç not eklendi.' : 'Müşteriye görünür not eklendi.',
        duration: 2000,
      });
      setText('');
      onClose();
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hızlı Not</div>
        <VoiceNoteButton
          onTranscript={(chunk) => setText((t) => (t ? `${t} ${chunk}` : chunk))}
          onListeningChange={setVoiceListening}
        />
      </div>
      <TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={voiceListening ? 'Dinleniyor…' : 'Not yazın veya mikrofona basın…'}
        rows={3}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="flex items-center gap-1 text-[11px]">
          <span className="text-slate-500">Görünürlük:</span>
          <button
            type="button"
            onClick={() => setVisibility('Internal')}
            className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${
              visibility === 'Internal'
                ? 'bg-slate-200 text-slate-800 ring-slate-300'
                : 'bg-white text-slate-500 ring-slate-200'
            }`}
          >
            İç
          </button>
          <button
            type="button"
            onClick={() => setVisibility('Customer')}
            className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${
              visibility === 'Customer'
                ? 'bg-blue-100 text-blue-800 ring-blue-300'
                : 'bg-white text-slate-500 ring-slate-200'
            }`}
          >
            Müşteri
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Vazgeç
          </Button>
          <Button
            size="sm"
            disabled={!text.trim() || submitting}
            onClick={handleSave}
            leftIcon={<Send size={12} />}
          >
            Kaydet
          </Button>
        </div>
      </div>
    </div>
  );
}
