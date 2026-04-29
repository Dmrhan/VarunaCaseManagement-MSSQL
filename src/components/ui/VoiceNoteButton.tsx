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
  const { isListening, isSupported, transcript, start, stop, reset, error } = useSpeechRecognition();

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
        'inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-1',
        isListening
          ? 'animate-pulse border-rose-300 bg-rose-50 text-rose-700 focus:ring-rose-400'
          : 'border-slate-300 bg-white text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus:ring-brand-400',
        className,
      )}
    >
      {isListening ? <MicOff size={13} /> : <Mic size={13} />}
      <span>{isListening ? 'Duraksatmak için tıkla' : 'Sesli yaz'}</span>
    </button>
  );
}
