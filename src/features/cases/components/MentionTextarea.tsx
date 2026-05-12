import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AtSign, ShieldAlert, Users } from 'lucide-react';
import { TextArea } from '@/components/ui/Field';
import { caseService } from '@/services/caseService';
import type { MentionableUser } from '../types';

/**
 * MentionTextarea — Faz 1.5 Madde 3.
 *
 * Plain textarea wrapper. Kullanıcı @ yazınca dropdown açılır, arrow/Enter
 * ile seçim yapılır, cursor'a `@[Name](userId) ` insert edilir. Tag DB'ye
 * ham metin olarak gider; backend regex parse eder.
 *
 * Native <textarea> kullanıldığı için inline blue-pill render'ı YOK
 * (contenteditable gerektirir). Render note display'de yapılır
 * (MentionContent component) — Faz 1.5 için yeterli pragmatik denge.
 */

interface MentionTextareaProps {
  caseId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

export interface MentionTextareaHandle {
  focus: () => void;
  insertText: (text: string) => void;
}

export const MentionTextarea = forwardRef<MentionTextareaHandle, MentionTextareaProps>(
  function MentionTextarea({ caseId, value, onChange, placeholder, rows = 3, disabled, autoFocus }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [mentionStart, setMentionStart] = useState(0);
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [candidates, setCandidates] = useState<MentionableUser[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Outer ref API — parent autoFocus / programmatic insert için.
    useImperativeHandle(
      ref,
      () => ({
        focus: () => textareaRef.current?.focus(),
        insertText: (text: string) => {
          const ta = textareaRef.current;
          if (!ta) return;
          const start = ta.selectionStart ?? value.length;
          const end = ta.selectionEnd ?? start;
          const next = value.slice(0, start) + text + value.slice(end);
          onChange(next);
          requestAnimationFrame(() => {
            ta.focus();
            const pos = start + text.length;
            ta.setSelectionRange(pos, pos);
          });
        },
      }),
      [value, onChange],
    );

    // İlk @ yazıldığında listeyi lazy fetch et — sonraki açılışlarda filter cache'lenmiş listeden.
    async function ensureCandidates() {
      if (candidates !== null || loading) return;
      setLoading(true);
      setLoadError(null);
      try {
        const list = await caseService.listMentionableUsers(caseId);
        setCandidates(list);
      } catch (e) {
        setLoadError((e as Error).message ?? 'Yüklenemedi');
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    }

    // value veya cursor değişince @ context'ini hesapla.
    function detectMention(nextValue: string, caretPos: number) {
      // @ pozisyonunu cursor'dan geriye ara, whitespace/satır başına kadar.
      let i = caretPos - 1;
      while (i >= 0) {
        const ch = nextValue[i];
        if (ch === '@') {
          // @'nin solunda whitespace/satır başı olmalı (kelime ortası @ değil)
          if (i === 0 || /\s/.test(nextValue[i - 1])) {
            const after = nextValue.slice(i + 1, caretPos);
            // @ ile cursor arası boşluk içermemeli
            if (!/\s/.test(after) && after.length <= 32) {
              return { start: i, query: after };
            }
          }
          return null;
        }
        if (/\s/.test(ch)) return null;
        i--;
      }
      return null;
    }

    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
      const next = e.target.value;
      onChange(next);
      const caret = e.target.selectionStart ?? next.length;
      const ctx = detectMention(next, caret);
      if (ctx) {
        setOpen(true);
        setMentionStart(ctx.start);
        setQuery(ctx.query);
        setSelectedIdx(0);
        void ensureCandidates();
      } else {
        setOpen(false);
      }
    }

    function handleSelectionChange() {
      const ta = textareaRef.current;
      if (!ta) return;
      const ctx = detectMention(value, ta.selectionStart ?? 0);
      if (ctx) {
        setOpen(true);
        setMentionStart(ctx.start);
        setQuery(ctx.query);
        void ensureCandidates();
      } else if (open) {
        setOpen(false);
      }
    }

    const filtered = useMemo(() => {
      if (!candidates) return [];
      const q = query.trim().toLocaleLowerCase('tr');
      if (!q) return candidates.slice(0, 8);
      return candidates
        .filter((u) =>
          u.name.toLocaleLowerCase('tr').includes(q) ||
          u.email.toLocaleLowerCase('tr').includes(q),
        )
        .slice(0, 8);
    }, [candidates, query]);

    function applySelection(user: MentionableUser) {
      const ta = textareaRef.current;
      if (!ta) return;
      const caret = ta.selectionStart ?? value.length;
      const tag = `@[${user.name}](${user.userId}) `;
      const next = value.slice(0, mentionStart) + tag + value.slice(caret);
      onChange(next);
      setOpen(false);
      setQuery('');
      requestAnimationFrame(() => {
        ta.focus();
        const pos = mentionStart + tag.length;
        ta.setSelectionRange(pos, pos);
      });
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (!open || filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySelection(filtered[selectedIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    }

    // selectedIdx filtered değişince taşma yapmasın
    useEffect(() => {
      if (selectedIdx >= filtered.length) setSelectedIdx(0);
    }, [filtered.length, selectedIdx]);

    return (
      <div className="relative">
        <TextArea
          ref={(el) => { textareaRef.current = el; }}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={handleSelectionChange}
          onClick={handleSelectionChange}
          onBlur={() => {
            // Dropdown'a tıklamak için kısa gecikme — outside click ile kapansın.
            setTimeout(() => setOpen(false), 150);
          }}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          autoFocus={autoFocus}
        />

        {open && (
          <div
            role="listbox"
            className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg dark:border-ndark-border dark:bg-ndark-card"
          >
            <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-1.5 text-[11px] uppercase tracking-wide text-slate-500 dark:border-ndark-border dark:text-ndark-muted">
              <AtSign size={11} />
              <span>{loading ? 'Yükleniyor…' : query ? `"${query}" eşleşmeleri` : 'Etiketle'}</span>
            </div>
            {loadError && (
              <div
                role="alert"
                className="flex items-start gap-1.5 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"
              >
                <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                <span>{loadError}</span>
              </div>
            )}
            {!loading && !loadError && filtered.length === 0 && (
              <div className="px-3 py-3 text-center text-xs text-slate-500 dark:text-ndark-muted">
                Eşleşen kişi yok
              </div>
            )}
            {filtered.map((u, idx) => {
              const active = idx === selectedIdx;
              return (
                <button
                  key={u.userId}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    // textarea blur'u önle — mouseDown handler textarea'nın focus'unu korur
                    e.preventDefault();
                    applySelection(u);
                  }}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left transition ${
                    active
                      ? 'bg-brand-50 dark:bg-brand-950/40'
                      : 'hover:bg-slate-50 dark:hover:bg-ndark-bg/50'
                  }`}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-medium text-slate-600 dark:bg-ndark-bg dark:text-ndark-muted">
                    {u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-ndark-text">
                      {u.name}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-ndark-muted">
                      <span className="truncate">{u.email}</span>
                      {u.teamName && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-0.5">
                            <Users size={9} /> {u.teamName}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);
