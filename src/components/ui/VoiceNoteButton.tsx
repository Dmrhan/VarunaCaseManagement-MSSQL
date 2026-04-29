import { useEffect, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { cn } from './cn';
import { useToast } from './Toast';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';

interface VoiceNoteButtonProps {
  /** Her kesinleşen sesli not parçası için tetiklenir */
  onTranscript: (text: string) => void;
  /** Dinleme durumu değişince tetiklenir (örn. textarea placeholder güncellemek için) */
  onListeningChange?: (listening: boolean) => void;
  className?: string;
}

export function VoiceNoteButton({ onTranscript, onListeningChange, className }: VoiceNoteButtonProps) {
  const { toast } = useToast();
  const {
    isListening,
    isSupported,
    transcript,
    interimTranscript,
    start,
    stop,
    reset,
    error,
  } = useSpeechRecognition();

  const lastEmittedRef = useRef('');
  const wasListeningRef = useRef(false);

  // Yeni kesinleşmiş chunk'ı parent'a ilet
  useEffect(() => {
    if (transcript && transcript !== lastEmittedRef.current) {
      const newChunk = transcript.slice(lastEmittedRef.current.length).trim();
      if (newChunk) onTranscript(newChunk);
      lastEmittedRef.current = transcript;
    }
  }, [transcript, onTranscript]);

  // Dinleme durumu değişimini parent'a bildir + auto-stop sonrası toast
  useEffect(() => {
    onListeningChange?.(isListening);
    if (wasListeningRef.current && !isListening) {
      toast({ type: 'success', message: 'Ses tanıma tamamlandı ✓', duration: 1500 });
    }
    wasListeningRef.current = isListening;
  }, [isListening, onListeningChange, toast]);

  // Hata toast'u
  useEffect(() => {
    if (error) toast({ type: 'error', message: error });
  }, [error, toast]);

  if (!isSupported) return null;

  function toggle() {
    if (isListening) {
      stop();
    } else {
      reset();
      lastEmittedRef.current = '';
      start();
    }
  }

  return (
    <div className={cn('relative inline-flex', className)}>
      <button
        type="button"
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            toggle();
          }
        }}
        aria-label={isListening ? 'Sesli notu durdur' : 'Sesli not başlat'}
        aria-pressed={isListening}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-offset-1',
          isListening
            ? 'animate-pulse bg-rose-100 text-rose-600 ring-2 ring-rose-300 focus:ring-rose-400'
            : 'bg-slate-100 text-slate-500 hover:bg-brand-100 hover:text-brand-600 focus:ring-brand-400',
        )}
      >
        {isListening ? <MicOff size={14} /> : <Mic size={14} />}
      </button>
      {isListening && (
        <div className="pointer-events-none absolute right-0 top-full z-10 mt-1 max-w-[260px] rounded-md bg-slate-900/90 px-2 py-1 text-[11px] text-white shadow">
          <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
          {interimTranscript ? <em className="italic">{interimTranscript}…</em> : 'Dinleniyor…'}
        </div>
      )}
    </div>
  );
}
