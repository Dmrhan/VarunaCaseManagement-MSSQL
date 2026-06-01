/**
 * Shared Case Notes module.
 *
 * Extracted from CaseDetailPage.tsx so the L1 Case Resolution Console
 * can reuse the exact same notes experience (composer, reply,
 * delete-own, emoji reactions, mentions, voice dictation, internal/
 * customer-visible toggle, duplicate-safe submit) WITHOUT a second
 * implementation.
 *
 * Public exports:
 *   - NoteAvatar           — initials + color avatar (also used by
 *                            watchers / previous-cases lists outside
 *                            notes)
 *   - NotesTab             — full composer + list; same JSX shape that
 *                            CaseDetailPage rendered before extraction
 *                            (parent owns composer state)
 *   - CaseNotesSection     — convenience wrapper that owns the
 *                            composer state internally; used by the L1
 *                            Workbench. Same backend calls.
 *
 * Internal:
 *   - NoteCard / ReplyItem / ReplyComposer / NoteReactions are private
 *     leaves rendered by NotesTab. They are intentionally not
 *     re-exported to avoid drift.
 *
 * No backend / service change. All service calls go through the
 * existing caseService methods (addNote / addReply / deleteNote /
 * listReplies / toggleReaction). Duplicate-safe submit + delete
 * authorization remain enforced at the backend layer.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  CornerDownRight,
  MessageSquare,
  Send,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { useAuth } from '@/services/AuthContext';
import { caseService } from '@/services/caseService';
import { formatDateTime, formatRelative } from '@/lib/format';
import { MentionContent } from './MentionContent';
import { MentionTextarea, type MentionTextareaHandle } from './MentionTextarea';
import type { Case, CaseNote, NoteVisibility } from '../types';
import {
  NOTE_REACTION_EMOJIS,
  NOTE_REACTION_META,
  type NoteReactionEmoji,
} from '../types';

// ─────────────────────────────────────────────────────────────────
// Avatar helpers — also consumed by watcher / previous-case lists.
// ─────────────────────────────────────────────────────────────────

export function avatarColor(name: string): string {
  const ch = (name?.trim()?.[0] ?? 'A').toLocaleUpperCase('tr');
  const code = ch.charCodeAt(0);
  if (code >= 65 && code <= 69) return '#7C3AED'; // A-E violet
  if (code >= 70 && code <= 74) return '#2563EB'; // F-J blue
  if (code >= 75 && code <= 79) return '#059669'; // K-O emerald
  if (code >= 80 && code <= 84) return '#D97706'; // P-T amber
  if (code >= 85 && code <= 90) return '#E11D48'; // U-Z rose
  if (ch === 'Ç') return '#7C3AED';
  if (ch === 'Ğ') return '#2563EB';
  if (ch === 'İ') return '#2563EB';
  if (ch === 'Ö') return '#059669';
  if (ch === 'Ş') return '#D97706';
  if (ch === 'Ü') return '#E11D48';
  return '#64748B';
}

export function avatarInitials(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('tr');
  return (parts[0][0] + parts[parts.length - 1][0]).toLocaleUpperCase('tr');
}

export function NoteAvatar({ name, size = 40 }: { name: string; size?: number }) {
  const bg = avatarColor(name);
  const initials = avatarInitials(name);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-sm ring-2 ring-white dark:ring-ndark-card"
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        fontSize: size <= 28 ? 11 : size <= 36 ? 13 : 14,
      }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// NoteReactions — emoji chips + picker (optimistic toggle).
// ─────────────────────────────────────────────────────────────────

function NoteReactions({
  caseId,
  noteId,
  initial,
  size = 'md',
}: {
  caseId: string;
  noteId: string;
  initial: import('../types').CaseNoteReactionRow[];
  size?: 'sm' | 'md';
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRows(initial);
  }, [initial]);

  useEffect(() => {
    if (!pickerOpen) return;
    function onClick(e: MouseEvent) {
      if (!pickerRef.current?.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [pickerOpen]);

  const grouped = useMemo(() => {
    const map = new Map<NoteReactionEmoji, { count: number; mine: boolean }>();
    for (const r of rows) {
      const cur = map.get(r.emoji) ?? { count: 0, mine: false };
      cur.count += 1;
      if (user && r.userId === user.id) cur.mine = true;
      map.set(r.emoji, cur);
    }
    return map;
  }, [rows, user]);

  const visibleEmojis: NoteReactionEmoji[] = NOTE_REACTION_EMOJIS.filter((e) => grouped.has(e));

  async function toggle(emoji: NoteReactionEmoji) {
    if (!user) return;
    setPickerOpen(false);

    const cur = grouped.get(emoji);
    const willRemove = cur?.mine ?? false;
    const tempId = `temp-${Date.now()}`;

    setRows((prev) =>
      willRemove
        ? prev.filter((r) => !(r.emoji === emoji && r.userId === user.id))
        : [...prev, { id: tempId, userId: user.id, emoji }],
    );

    const res = await caseService.toggleReaction(caseId, noteId, emoji);
    if (!res) {
      setRows((prev) =>
        willRemove
          ? prev.some((r) => r.emoji === emoji && r.userId === user.id)
            ? prev
            : [...prev, { id: tempId, userId: user.id, emoji }]
          : prev.filter((r) => r.id !== tempId),
      );
      toast({ type: 'error', message: 'Reaksiyon kaydedilemedi.' });
    }
  }

  const chipBase =
    size === 'sm'
      ? 'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition'
      : 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition';
  const triggerBase =
    'inline-flex items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 transition hover:border-brand-400 hover:text-brand-500 dark:border-ndark-border dark:text-ndark-muted dark:hover:border-brand-500 dark:hover:text-brand-400';
  const triggerSize = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6';

  return (
    <div className="relative mt-2 flex flex-wrap items-center gap-1">
      {visibleEmojis.map((e) => {
        const meta = NOTE_REACTION_META[e];
        const info = grouped.get(e)!;
        const mine = info.mine;
        const cls = mine
          ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/60 dark:bg-brand-500/10 dark:text-brand-300'
          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-ndark-border dark:bg-ndark-bg/40 dark:text-ndark-muted dark:hover:bg-ndark-card';
        return (
          <button
            key={e}
            type="button"
            onClick={() => toggle(e)}
            className={chipBase + ' ' + cls}
            title={meta.label}
          >
            <span aria-hidden>{meta.symbol}</span>
            <span className="tabular-nums">{info.count}</span>
          </button>
        );
      })}

      <div ref={pickerRef} className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className={triggerBase + ' ' + triggerSize}
          title="Reaksiyon ekle"
          aria-label="Reaksiyon ekle"
        >
          <SmilePlus size={size === 'sm' ? 11 : 13} />
        </button>
        {pickerOpen && (
          <div className="absolute bottom-full left-0 z-20 mb-1 flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-1 shadow-md dark:border-ndark-border dark:bg-ndark-card">
            {NOTE_REACTION_EMOJIS.map((e) => {
              const meta = NOTE_REACTION_META[e];
              const mine = grouped.get(e)?.mine ?? false;
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => toggle(e)}
                  className={
                    'rounded-full px-1.5 py-0.5 text-base transition ' +
                    (mine
                      ? 'bg-brand-100 dark:bg-brand-500/20'
                      : 'hover:bg-slate-100 dark:hover:bg-ndark-bg')
                  }
                  title={meta.label}
                  aria-label={meta.label}
                >
                  {meta.symbol}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ReplyItem
// ─────────────────────────────────────────────────────────────────

function ReplyItem({
  caseId,
  reply,
  parentAuthor,
  currentUserId,
  onDelete,
}: {
  caseId: string;
  reply: CaseNote;
  parentAuthor: string;
  currentUserId: string | null;
  onDelete: () => Promise<boolean>;
}) {
  const [deleting, setDeleting] = useState(false);
  const isInternal = reply.visibility === 'Internal';
  const pill = isInternal
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
  const isOwn = !!currentUserId && !!reply.authorId && reply.authorId === currentUserId;
  async function handleDelete() {
    if (deleting) return;
    if (!window.confirm('Bu yanıtı silmek istiyor musun?')) return;
    setDeleting(true);
    await onDelete();
    setDeleting(false);
  }
  return (
    <li className="rounded-lg border-l-2 border-brand-400 bg-white px-3 py-2 shadow-sm dark:border-brand-500 dark:bg-ndark-card">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-400 dark:text-ndark-muted">
        <CornerDownRight size={11} />
        <span className="font-medium text-slate-500 dark:text-ndark-muted">{parentAuthor}</span>
        <span>'a yanıt</span>
      </div>
      <div className="flex items-center gap-2">
        <NoteAvatar name={reply.authorName} size={28} />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs font-semibold text-slate-900 dark:text-ndark-text">
            {reply.authorName}
          </span>
          <span
            className={
              'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ' + pill
            }
          >
            {isInternal ? 'İç' : 'Müşteri'}
          </span>
        </div>
        <span
          className="shrink-0 text-[11px] text-slate-400 dark:text-ndark-muted"
          title={formatDateTime(reply.createdAt)}
        >
          {formatRelative(reply.createdAt)}
        </span>
        {isOwn && (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={deleting}
            title="Yanıtı sil"
            aria-label="Yanıtı sil"
            className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:text-ndark-muted dark:hover:bg-rose-950/30 dark:hover:text-rose-400"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div className="mt-1.5 pl-9">
        <MentionContent
          content={reply.content}
          className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300"
        />
        <NoteReactions
          caseId={caseId}
          noteId={reply.id}
          initial={reply.reactions ?? []}
          size="sm"
        />
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────
// ReplyComposer
// ─────────────────────────────────────────────────────────────────

function ReplyComposer({
  caseId,
  parentAuthor,
  parentVisibility,
  currentName,
  onCancel,
  onSubmit,
}: {
  caseId: string;
  parentAuthor: string;
  parentVisibility: NoteVisibility;
  currentName: string;
  onCancel: () => void;
  onSubmit: (content: string, visibility: NoteVisibility) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<NoteVisibility>(parentVisibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Synchronous double-submit guard — React state alone is insufficient
  // because updates batch across an await.
  const busyRef = useRef(false);
  const composerRef = useRef<MentionTextareaHandle>(null);
  useEffect(() => {
    composerRef.current?.focus();
  }, []);
  return (
    <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-ndark-border/60 dark:bg-ndark-bg/40">
      <div className="flex items-start gap-2">
        <NoteAvatar name={currentName} size={28} />
        <div className="min-w-0 flex-1">
          <MentionTextarea
            ref={composerRef}
            caseId={caseId}
            value={text}
            onChange={setText}
            placeholder={`${parentAuthor}'a yanıt yazın — @ ile kişi etiketleyebilirsiniz…`}
            rows={2}
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1 text-[11px]">
              <button
                type="button"
                onClick={() => setVisibility('Internal')}
                className={
                  'rounded-full px-2 py-0.5 font-medium transition ' +
                  (visibility === 'Internal'
                    ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-900/40'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-card')
                }
              >
                İç Not
              </button>
              <button
                type="button"
                onClick={() => setVisibility('Customer')}
                className={
                  'rounded-full px-2 py-0.5 font-medium transition ' +
                  (visibility === 'Customer'
                    ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-900/40'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-card')
                }
              >
                Müşteriye Görünür
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
                İptal
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  if (!text.trim() || busy || busyRef.current) return;
                  busyRef.current = true;
                  setBusy(true);
                  setError(null);
                  try {
                    const ok = await onSubmit(text.trim(), visibility);
                    if (ok) {
                      setText('');
                    } else {
                      setError('Yanıt gönderilemedi. Tekrar deneyebilirsin.');
                    }
                  } finally {
                    busyRef.current = false;
                    setBusy(false);
                  }
                }}
                disabled={!text.trim() || busy}
                leftIcon={<Send size={13} />}
              >
                {busy ? 'Gönderiliyor…' : 'Yanıtla'}
              </Button>
            </div>
          </div>
          {error && (
            <div className="mt-1.5 text-[11px] font-medium text-rose-600 dark:text-red-400">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// NoteCard
// ─────────────────────────────────────────────────────────────────

function NoteCard({
  caseId,
  note,
  currentName,
  currentUserId,
  onReplyAdded,
  onDeleteNote,
}: {
  caseId: string;
  note: CaseNote;
  currentName: string;
  currentUserId: string | null;
  onReplyAdded: (parentNoteId: string) => void;
  onDeleteNote: (noteId: string, parentNoteIdHint?: string | null) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [replies, setReplies] = useState<CaseNote[] | null>(null);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();
  const isOwnAndChildless =
    !!currentUserId &&
    !!note.authorId &&
    note.authorId === currentUserId &&
    (note.replyCount ?? 0) === 0;

  async function handleDelete() {
    if (deleting) return;
    if (!window.confirm('Bu notu silmek istiyor musun?')) return;
    setDeleting(true);
    await onDeleteNote(note.id);
    setDeleting(false);
  }

  const isInternal = note.visibility === 'Internal';
  const pill = isInternal
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
  const replyCount = note.replyCount ?? 0;

  async function loadReplies() {
    setLoadingReplies(true);
    try {
      const r = await caseService.listReplies(caseId, note.id);
      setReplies(r);
    } catch {
      toast({ type: 'error', message: 'Yanıtlar yüklenemedi.' });
    } finally {
      setLoadingReplies(false);
    }
  }

  function toggleThread() {
    const next = !expanded;
    setExpanded(next);
    if (next && replies === null) {
      void loadReplies();
    }
  }

  async function handleSubmitReply(content: string, visibility: NoteVisibility) {
    const created = await caseService.addReply(caseId, note.id, {
      content,
      visibility,
      authorName: currentName,
    });
    if (!created) return false;
    setReplies((prev) => (prev ? [...prev, created] : [created]));
    setExpanded(true);
    setComposerOpen(false);
    onReplyAdded(note.id);
    toast({
      type: 'success',
      message: visibility === 'Internal' ? 'İç yanıt eklendi.' : 'Müşteriye görünür yanıt eklendi.',
      duration: 2500,
    });
    return true;
  }

  return (
    <li className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md dark:border-ndark-border dark:bg-ndark-card">
      <div className="flex items-center gap-3 px-4 py-3">
        <NoteAvatar name={note.authorName} size={40} />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-slate-900 dark:text-ndark-text">
            {note.authorName}
          </span>
          <span
            className={
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ' + pill
            }
          >
            {isInternal ? 'İç Not' : 'Müşteriye Görünür'}
          </span>
        </div>
        <span
          className="shrink-0 text-xs text-slate-400 dark:text-ndark-muted"
          title={formatDateTime(note.createdAt)}
        >
          {formatRelative(note.createdAt)}
        </span>
        {isOwnAndChildless && (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={deleting}
            title="Notu sil"
            aria-label="Notu sil"
            className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:text-ndark-muted dark:hover:bg-rose-950/30 dark:hover:text-rose-400"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="border-t border-slate-100 px-4 pt-3 pb-3 dark:border-ndark-border/60">
        <MentionContent
          content={note.content}
          className="text-sm leading-relaxed text-slate-700 dark:text-slate-300"
        />

        <NoteReactions caseId={caseId} noteId={note.id} initial={note.reactions ?? []} />

        <div className="mt-3 flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setComposerOpen((v) => !v)}
            className="inline-flex items-center gap-1 font-medium text-slate-500 transition hover:text-brand-600 dark:text-ndark-muted dark:hover:text-brand-400"
          >
            <CornerDownRight size={13} />
            Yanıtla
          </button>
          {replyCount > 0 && (
            <button
              type="button"
              onClick={toggleThread}
              className="inline-flex items-center gap-1 font-medium text-brand-600 transition hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
            >
              <MessageSquare size={13} />
              {replyCount} yanıt {expanded ? '▴' : '▾'}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-ndark-border/60 dark:bg-ndark-bg/40">
          {loadingReplies && replies === null ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {(replies ?? []).map((r) => (
                <ReplyItem
                  key={r.id}
                  caseId={caseId}
                  reply={r}
                  parentAuthor={note.authorName}
                  currentUserId={currentUserId}
                  onDelete={async () => {
                    // Pass `note.id` as parentNoteIdHint — replies are
                    // lazy-loaded and the parent state can't infer it
                    // from item.notes (Codex P2 fix).
                    const ok = await onDeleteNote(r.id, note.id);
                    if (ok) {
                      setReplies((prev) => (prev ? prev.filter((x) => x.id !== r.id) : prev));
                    }
                    return ok;
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {composerOpen && (
        <ReplyComposer
          caseId={caseId}
          parentAuthor={note.authorName}
          parentVisibility={note.visibility}
          currentName={currentName}
          onCancel={() => setComposerOpen(false)}
          onSubmit={handleSubmitReply}
        />
      )}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────
// NotesTab — composer + list. Parent owns the composer state so
// callers (CaseDetailPage drafts, L1WorkbenchPanel via
// CaseNotesSection) can integrate cleanly.
// ─────────────────────────────────────────────────────────────────

export interface NotesTabProps {
  item: Case;
  noteText: string;
  noteVisibility: NoteVisibility;
  noteSubmitting: boolean;
  noteError: string | null;
  onChangeText: (s: string) => void;
  onChangeVisibility: (v: NoteVisibility) => void;
  onSubmit: () => void;
  onReplyAdded: (parentNoteId: string) => void;
  /**
   * Codex P2 fix — replies are lazy-loaded via `caseService.listReplies`
   * so they aren't in `item.notes` and the handler can't infer
   * `parentNoteId` from there. NoteCard passes `parentNoteIdHint` when
   * deleting a reply so the caller can decrement `parent.replyCount`
   * correctly.
   */
  onDeleteNote: (noteId: string, parentNoteIdHint?: string | null) => Promise<boolean>;
  currentUserId: string | null;
  inputRef: RefObject<MentionTextareaHandle>;
}

export function NotesTab({
  item,
  noteText,
  noteVisibility,
  noteSubmitting,
  noteError,
  onChangeText,
  onChangeVisibility,
  onSubmit,
  onReplyAdded,
  onDeleteNote,
  currentUserId,
  inputRef,
}: NotesTabProps) {
  const [voiceListening, setVoiceListening] = useState(false);
  const { user } = useAuth();
  const currentName = user?.fullName ?? 'Ben';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-4 transition focus-within:border-brand-400 dark:border-ndark-border dark:bg-ndark-card dark:focus-within:border-brand-500">
        <div className="flex items-start gap-3">
          <NoteAvatar name={currentName} size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-ndark-muted">
                {currentName} yanıtlıyor…
              </span>
              <VoiceNoteButton
                onTranscript={(chunk) => onChangeText(noteText ? `${noteText} ${chunk}` : chunk)}
                onListeningChange={setVoiceListening}
              />
            </div>
            <div className="mt-1.5">
              <MentionTextarea
                ref={inputRef}
                caseId={item.id}
                value={noteText}
                onChange={onChangeText}
                placeholder={voiceListening ? 'Dinleniyor…' : 'Not yazın — @ ile kişi etiketleyebilirsiniz…'}
                rows={3}
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  onClick={() => onChangeVisibility('Internal')}
                  className={
                    'rounded-full px-2.5 py-1 font-medium transition ' +
                    (noteVisibility === 'Internal'
                      ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-900/40'
                      : 'text-slate-500 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-card')
                  }
                >
                  İç Not
                </button>
                <button
                  onClick={() => onChangeVisibility('Customer')}
                  className={
                    'rounded-full px-2.5 py-1 font-medium transition ' +
                    (noteVisibility === 'Customer'
                      ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-900/40'
                      : 'text-slate-500 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-card')
                  }
                >
                  Müşteriye Görünür
                </button>
              </div>
              <Button
                size="sm"
                onClick={onSubmit}
                disabled={!noteText.trim() || noteSubmitting}
                leftIcon={<Send size={14} />}
              >
                {noteSubmitting ? 'Gönderiliyor…' : 'Not Ekle'}
              </Button>
            </div>
            {noteError && (
              <div className="mt-2 text-[11.5px] font-medium text-rose-600 dark:text-red-400">
                {noteError}
              </div>
            )}
          </div>
        </div>
      </div>

      {item.notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-300 dark:bg-ndark-card dark:text-ndark-muted">
            <MessageSquare size={28} />
          </div>
          <p className="mt-3 text-sm font-medium text-slate-600 dark:text-ndark-text">
            Henüz not eklenmemiş
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-ndark-muted">
            @ ile ekip üyelerini etiketleyebilirsiniz
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {item.notes.map((n) => (
            <NoteCard
              key={n.id}
              caseId={item.id}
              note={n}
              currentName={currentName}
              currentUserId={currentUserId}
              onReplyAdded={onReplyAdded}
              onDeleteNote={onDeleteNote}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// CaseNotesSection — state-hosting wrapper for callers that don't
// already own composer state (L1 Workbench). CaseDetailPage hosts its
// own state for backward compat and renders NotesTab directly.
// ─────────────────────────────────────────────────────────────────

export function CaseNotesSection({
  item,
  onItemUpdate,
}: {
  item: Case;
  onItemUpdate: (next: Case) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [noteText, setNoteText] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<NoteVisibility>('Internal');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const noteRef = useRef<MentionTextareaHandle>(null);
  const noteSubmittingRef = useRef(false);

  async function handleAddNote() {
    if (!noteText.trim()) return;
    if (noteSubmittingRef.current) return;
    noteSubmittingRef.current = true;
    setNoteSubmitting(true);
    setNoteError(null);
    try {
      const created = await caseService.addNote(item.id, {
        content: noteText.trim(),
        visibility: noteVisibility,
        authorName: user?.fullName ?? 'Kullanıcı',
      });
      if (created) {
        const alreadyPresent = item.notes.some((n) => n.id === created.id);
        onItemUpdate(
          alreadyPresent ? item : { ...item, notes: [created, ...item.notes] },
        );
        setNoteText('');
        toast({
          type: 'success',
          message: noteVisibility === 'Internal' ? 'İç not eklendi.' : 'Müşteriye görünür not eklendi.',
          duration: 2500,
        });
      } else {
        setNoteError('Not gönderilemedi. Tekrar deneyebilirsin.');
      }
    } finally {
      noteSubmittingRef.current = false;
      setNoteSubmitting(false);
    }
  }

  function handleReplyAdded(parentNoteId: string) {
    onItemUpdate({
      ...item,
      notes: item.notes.map((n) =>
        n.id === parentNoteId ? { ...n, replyCount: (n.replyCount ?? 0) + 1 } : n,
      ),
    });
  }

  async function handleDeleteNote(
    noteId: string,
    parentNoteIdHint?: string | null,
  ): Promise<boolean> {
    const r = await caseService.deleteNote(item.id, noteId);
    if (r.ok) {
      // Replies are lazy-loaded via listReplies and not present in
      // item.notes; the caller (NoteCard) supplies parentNoteIdHint so
      // parent.replyCount can still be decremented correctly. Top-level
      // notes lookup via item.notes is the fallback.
      const deleted = item.notes.find((n) => n.id === noteId);
      const parentId = parentNoteIdHint ?? deleted?.parentNoteId ?? null;
      onItemUpdate({
        ...item,
        notes: item.notes
          .filter((n) => n.id !== noteId)
          .map((n) =>
            parentId && n.id === parentId
              ? { ...n, replyCount: Math.max(0, (n.replyCount ?? 0) - 1) }
              : n,
          ),
      });
      toast({ type: 'success', message: 'Not silindi.', duration: 2000 });
      return true;
    }
    const msg =
      r.reason === 'has_replies'
        ? (r.message ?? 'Yanıtı olan ana not silinemez.')
        : r.reason === 'forbidden'
          ? (r.message ?? 'Bu notu silme yetkin yok.')
          : r.reason === 'orphan'
            ? (r.message ?? 'Yazarı belirlenemeyen eski not silinemez.')
            : r.reason === 'not_found'
              ? 'Not bulunamadı.'
              : 'Not silinemedi.';
    toast({ type: 'error', message: msg, duration: 3500 });
    return false;
  }

  return (
    <NotesTab
      item={item}
      noteText={noteText}
      noteVisibility={noteVisibility}
      noteSubmitting={noteSubmitting}
      noteError={noteError}
      onChangeText={(s) => {
        setNoteText(s);
        if (noteError) setNoteError(null);
      }}
      onChangeVisibility={setNoteVisibility}
      onSubmit={handleAddNote}
      onReplyAdded={handleReplyAdded}
      onDeleteNote={handleDeleteNote}
      currentUserId={user?.id ?? null}
      inputRef={noteRef}
    />
  );
}
