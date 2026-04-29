import { useEffect, useState } from 'react';
import { Mic, MicOff, NotebookPen, PauseCircle, PhoneOff, PlayCircle, User } from 'lucide-react';
import { Button } from './Button';
import { Badge } from './Badge';
import { QuickNotePopover } from './QuickNotePopover';
import type { CaseNote } from '@/features/cases/types';

interface ActiveCallBannerProps {
  customerName: string;
  customerPhone?: string;
  caseId?: string;
  onNoteAdded?: (note: CaseNote) => void;
  onEnd: (durationSec: number) => void;
}

export function ActiveCallBanner({
  customerName,
  customerPhone,
  caseId,
  onNoteAdded,
  onEnd,
}: ActiveCallBannerProps) {
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [paused]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="flex items-center gap-3 border-b border-emerald-200 bg-emerald-50 px-6 py-2 text-sm text-emerald-900">
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="absolute inset-0 inline-flex animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
      </span>
      <Badge tint="emerald">Aktif Çağrı</Badge>
      <span className="inline-flex items-center gap-1.5">
        <User size={14} />
        <strong>{customerName}</strong>
        {customerPhone && <span className="text-emerald-700">· {customerPhone}</span>}
      </span>
      <span className="ml-auto font-mono text-base font-semibold tabular-nums">
        {mm}:{ss}
      </span>
      {caseId && (
        <QuickNotePopover
          caseId={caseId}
          align="end"
          width={340}
          onAdded={onNoteAdded}
          trigger={({ toggle }) => (
            <button
              type="button"
              onClick={toggle}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
              title="Çağrı sırasında hızlı not ekle"
            >
              <NotebookPen size={12} /> Hızlı Not
            </button>
          )}
        />
      )}
      <button
        type="button"
        onClick={() => setMuted((v) => !v)}
        className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
        title={muted ? 'Mikrofonu aç' : 'Mikrofonu sustur'}
      >
        {muted ? <MicOff size={14} /> : <Mic size={14} />}
      </button>
      <button
        type="button"
        onClick={() => setPaused((v) => !v)}
        className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
        title={paused ? 'Devam et' : 'Beklet'}
      >
        {paused ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
      </button>
      <Button
        size="sm"
        variant="danger"
        leftIcon={<PhoneOff size={12} />}
        onClick={() => onEnd(seconds)}
      >
        Bitir
      </Button>
    </div>
  );
}
