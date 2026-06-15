import { useEffect, useRef, useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import type { Case } from '../types';
import { caseService } from '@/services/caseService';
import { useAuth } from '@/services/AuthContext';
import { useToast } from '@/components/ui/Toast';

const MAX_LEN = 200;
const CLOSED_STATUSES: ReadonlyArray<Case['status']> = ['Çözüldü', 'İptalEdildi'];
const TITLE_EDIT_ROLES = new Set(['Supervisor', 'Admin', 'SystemAdmin']);

interface Props {
  item: Case;
  onUpdated?: (next: Case) => void;
}

export function CaseTitleEditable({ item, onUpdated }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isClosed = CLOSED_STATUSES.includes(item.status);
  const isAssignedToMe = !!user?.personId && item.assignedPersonId === user.personId;
  const isPrivilegedRole = !!user && TITLE_EDIT_ROLES.has(user.role);
  const canEdit = !isClosed && (isAssignedToMe || isPrivilegedRole);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    setDraft(item.title);
  }, [item.title]);

  function startEdit() {
    setDraft(item.title);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setDraft(item.title);
    setError(null);
    setEditing(false);
  }

  async function save() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setError('Vaka adı boş olamaz.');
      return;
    }
    if (trimmed.length > MAX_LEN) {
      setError(`En fazla ${MAX_LEN} karakter olabilir.`);
      return;
    }
    if (trimmed === item.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    const updated = await caseService.update(item.id, { title: trimmed });
    setSaving(false);
    if (!updated) {
      setDraft(item.title);
      toast({ type: 'error', message: 'Vaka adı güncellenemedi.', duration: 3500 });
      return;
    }
    setEditing(false);
    onUpdated?.(updated);
    toast({ type: 'success', message: 'Vaka adı güncellendi.', duration: 2500 });
  }

  if (!editing) {
    return (
      <div className="mt-0.5 flex items-start gap-1.5">
        <h1 className="truncate text-lg font-semibold text-slate-900 dark:text-ndark-text">
          {item.title}
        </h1>
        {canEdit && (
          <button
            type="button"
            onClick={startEdit}
            className="mt-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ndark-card dark:hover:text-ndark-text"
            aria-label="Vaka adını düzenle"
            title="Vaka adını düzenle"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>
    );
  }

  const overLimit = draft.length > MAX_LEN;
  return (
    <div className="mt-0.5">
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={draft}
          maxLength={MAX_LEN + 20}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-lg font-semibold text-slate-900 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-300 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || overLimit || draft.trim().length === 0}
          className="rounded-md bg-brand-500 px-2 py-1 text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Kaydet"
          title="Kaydet (Enter)"
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="rounded-md border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50 dark:border-ndark-border dark:hover:bg-ndark-card"
          aria-label="İptal"
          title="İptal (Esc)"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className={error ? 'text-rose-600' : 'text-slate-400'}>
          {error ?? 'Enter ile kaydet, Esc ile iptal et.'}
        </span>
        <span className={overLimit ? 'text-rose-600' : 'text-slate-400'}>
          {draft.length}/{MAX_LEN}
        </span>
      </div>
    </div>
  );
}
