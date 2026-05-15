import { Check, X } from 'lucide-react';
import type { PasswordEvaluation } from '@/lib/passwordPolicy';

interface PasswordChecklistProps {
  evaluation: PasswordEvaluation;
  /** Şifre alanı boşsa hiçbir kural geçmediğinden listeyi soluk göster. */
  dim?: boolean;
}

/**
 * Şifre kuralları için canlı checklist. evaluatePassword() çıktısını alır.
 * Geçen kurallarda yeşil tik, geçmeyenlerde kırmızı X gösterir.
 */
export function PasswordChecklist({ evaluation, dim }: PasswordChecklistProps) {
  return (
    <ul
      className={`mt-2 space-y-1 text-xs ${dim ? 'opacity-60' : ''}`}
      aria-label="Şifre kuralları"
    >
      {evaluation.checks.map((c) => (
        <li
          key={c.key}
          className={`flex items-start gap-1.5 ${
            c.pass
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-slate-500 dark:text-ndark-muted'
          }`}
        >
          <span className="mt-0.5 flex-shrink-0">
            {c.pass ? <Check size={12} /> : <X size={12} />}
          </span>
          <span>{c.label}</span>
        </li>
      ))}
    </ul>
  );
}
