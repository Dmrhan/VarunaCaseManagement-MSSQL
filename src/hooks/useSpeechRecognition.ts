import { useCallback, useEffect, useRef, useState } from 'react';

// ----------------------------------------------------------------
// Web Speech API tipleri (browser native, henüz TS lib.dom'da yok)
// ----------------------------------------------------------------
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onspeechend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

// ----------------------------------------------------------------
// Hook
// ----------------------------------------------------------------

export interface UseSpeechRecognitionResult {
  isListening: boolean;
  isSupported: boolean;
  transcript: string;          // sadece kesinleşmiş kümülatif metin
  interimTranscript: string;   // anlık (henüz kesinleşmemiş) metin
  start: () => void;
  stop: () => void;
  reset: () => void;
  error: string | null;
}

const SILENCE_AUTOSTOP_MS = 5000;

export function useSpeechRecognition(): UseSpeechRecognitionResult {
  const Ctor =
    typeof window !== 'undefined'
      ? window.SpeechRecognition ?? window.webkitSpeechRecognition
      : undefined;
  const isSupported = Boolean(Ctor);

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const silenceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'tr-TR';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) final += text;
        else interim += text;
      }
      if (final) {
        setTranscript((prev) => (prev ? `${prev} ${final.trim()}` : final.trim()));
      }
      setInterimTranscript(interim);

      // Sessizlik auto-stop
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = window.setTimeout(() => {
        try { rec.stop(); } catch { /* ignore */ }
      }, SILENCE_AUTOSTOP_MS);
    };

    rec.onerror = (event) => {
      const err = event.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setError('Mikrofon izni reddedildi.');
      } else if (err === 'no-speech') {
        // sessizlik — sessiz auto-stop, mesaj gerek yok
      } else if (err === 'aborted') {
        // kullanıcı durdurdu — mesaj yok
      } else {
        setError(`Ses tanıma hatası: ${err}`);
      }
      setIsListening(false);
    };

    rec.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };

    recRef.current = rec;

    return () => {
      try { rec.stop(); } catch { /* ignore */ }
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };
  }, [Ctor]);

  const start = useCallback(() => {
    if (!recRef.current || isListening) return;
    setError(null);
    try {
      recRef.current.start();
      setIsListening(true);
    } catch {
      setError('Ses tanıma başlatılamadı.');
    }
  }, [isListening]);

  const stop = useCallback(() => {
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch { /* ignore */ }
    setIsListening(false);
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    setError(null);
  }, []);

  return { isListening, isSupported, transcript, interimTranscript, start, stop, reset, error };
}
