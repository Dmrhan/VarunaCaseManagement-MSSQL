import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Send, Trash2, X } from 'lucide-react';
import { aiService, aiErrorMessage, type DashboardContext } from '@/services/aiService';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isError?: boolean;
}

interface RunaAiChatPanelProps {
  context: DashboardContext;
  onClose: () => void;
}

const PRESET_QUESTIONS = [
  'Bu haftanın en kritik vakası hangisi?',
  'SLA ihlal oranım neden bu kadar yüksek?',
  'Ekip yükü dengeli mi, önerin nedir?',
  'Churn riski en yüksek segment hangisi?',
  'En sorunlu kategori hangisi ve neden?',
];

const RUNA = {
  brand: '#4B0FAE',
  brandText: '#4B0FAE',
  userBubbleBg: '#4B0FAE',
  userBubbleText: '#FFFFFF',
  assistantBubbleBg: 'var(--color-background-secondary, #f1f5f9)',
  assistantBubbleBorder: '#4B0FAE',
  errorBubbleBg: '#FEF3C7',
  errorBubbleText: '#92400E',
  errorBubbleBorder: '#F59E0B',
};

const RunaAiIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" fill="#4B0FAE" />
    <text x="8" y="12" fontFamily="Arial" fontSize="9" fontWeight="700" fill="#00C8A0" textAnchor="middle">
      R
    </text>
    <circle cx="12" cy="4" r="2" fill="#00C8A0" />
    <circle cx="12" cy="4" r="1" fill="#4B0FAE" />
  </svg>
);

function genId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function formatTs(d: Date): string {
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function RunaAiChatPanel({ context, onClose }: RunaAiChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Yeni mesaj/loading geldiğinde dibe scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setSending(true);

    const r = await aiService.dashboardChat({
      message: trimmed,
      history: newMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
      context,
    });

    setSending(false);

    if (r.ok) {
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: 'assistant',
          content: r.data.reply || '(Boş yanıt)',
          timestamp: new Date(),
        },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: 'assistant',
          content:
            r.error.kind === 'unconfigured'
              ? 'AI servisi yapılandırılmamış (API key eksik).'
              : `RUNA AI şu an yanıt veremiyor, lütfen tekrar deneyin. (${aiErrorMessage(r.error)})`,
          timestamp: new Date(),
          isError: true,
        },
      ]);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function handlePresetClick(q: string) {
    setInput(q);
    void send(q);
  }

  function handleClear() {
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  }

  return (
    <aside
      className="sticky top-0 flex h-screen w-[360px] shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-3"
        style={{ background: RUNA.brand, color: '#FFFFFF' }}
      >
        <div className="flex items-center gap-2">
          <RunaAiIcon size={16} />
          <span className="text-sm font-semibold tracking-wide">RUNA AI</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="rounded p-1 text-white/80 hover:bg-white/15 hover:text-white"
              title="Sohbeti temizle"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-white/80 hover:bg-white/15 hover:text-white"
            title="Paneli kapat"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Mesajlar — scroll edilebilir alan */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && !sending ? (
          <EmptyHint />
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
            {sending && <LoadingDots />}
          </div>
        )}
      </div>

      {/* Hazır sorular — sadece chat boşken */}
      {messages.length === 0 && !sending && (
        <div className="border-t border-slate-200 px-3 py-2.5">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Hazır Sorular
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handlePresetClick(q)}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-1.5 border-t border-slate-200 p-2.5">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Soru sor..."
          disabled={sending}
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 placeholder-slate-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:bg-slate-50 disabled:text-slate-500"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="flex h-8 w-8 items-center justify-center rounded-md text-white transition disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: RUNA.brand }}
          title="Gönder"
        >
          <Send size={14} />
        </button>
      </form>
    </aside>
  );
}

// ----------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------

function EmptyHint() {
  return (
    <div className="flex h-full items-center justify-center px-2 text-center">
      <div>
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full" style={{ background: '#F0EAFF' }}>
          <RunaAiIcon size={20} />
        </div>
        <p className="text-sm font-medium text-slate-800">Dashboard verilerinizi sorgulayın</p>
        <p className="mt-1 text-xs text-slate-500">
          Aşağıdaki hazır sorulardan birini seçin ya da kendi sorunuzu yazın.
        </p>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isError = message.isError;

  const userStyle: CSSProperties = {
    background: RUNA.userBubbleBg,
    color: RUNA.userBubbleText,
    borderRadius: '12px 12px 0 12px',
  };
  const assistantStyle: CSSProperties = isError
    ? {
        background: RUNA.errorBubbleBg,
        color: RUNA.errorBubbleText,
        borderLeft: `2px solid ${RUNA.errorBubbleBorder}`,
        borderRadius: '12px 12px 12px 0',
      }
    : {
        background: RUNA.assistantBubbleBg,
        color: 'var(--color-text-primary, #1e293b)',
        borderLeft: `2px solid ${RUNA.assistantBubbleBorder}`,
        borderRadius: '12px 12px 12px 0',
      };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          style={isUser ? userStyle : assistantStyle}
          className="px-3 py-2 text-[13px] leading-relaxed"
        >
          <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
        </div>
        <span className="mt-0.5 text-[10px] text-slate-400">{formatTs(message.timestamp)}</span>
      </div>
    </div>
  );
}

function LoadingDots() {
  return (
    <div className="flex justify-start">
      <div
        style={{
          background: RUNA.assistantBubbleBg,
          borderLeft: `2px solid ${RUNA.assistantBubbleBorder}`,
          borderRadius: '12px 12px 12px 0',
        }}
        className="flex items-center gap-1 px-3 py-2.5"
      >
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full animate-pulse"
      style={{ background: RUNA.brand, animationDelay: `${delay}ms` }}
    />
  );
}
