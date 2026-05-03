import { Fragment } from 'react';

/**
 * MentionContent — note metnini render ederken `@[Name](userId)` tag'lerini
 * inline mavi badge olarak gösterir. Diğer karakterler whitespace-pre-wrap
 * ile aynen korunur. Faz 1.5 Madde 3.
 */

const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

interface MentionContentProps {
  content: string;
  className?: string;
  /** Optional: badge tıklayınca olay (gelecekte user kart popover için). */
  onMentionClick?: (userId: string, name: string) => void;
}

export function MentionContent({ content, className, onMentionClick }: MentionContentProps) {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  // Stateful regex — global flag ile sıralı eşleşme.
  MENTION_REGEX.lastIndex = 0;
  while ((match = MENTION_REGEX.exec(content)) !== null) {
    const [full, name, userId] = match;
    if (match.index > lastIdx) {
      parts.push(<Fragment key={`t${lastIdx}`}>{content.slice(lastIdx, match.index)}</Fragment>);
    }
    const Tag = onMentionClick ? 'button' : 'span';
    parts.push(
      <Tag
        key={`m${match.index}`}
        type={onMentionClick ? 'button' : undefined}
        onClick={onMentionClick ? () => onMentionClick(userId, name) : undefined}
        className={`mx-0.5 inline-flex items-center gap-0.5 rounded-md bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900/50 ${
          onMentionClick ? 'cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-900/60' : ''
        }`}
        title={onMentionClick ? `${name} — kart için tıkla` : undefined}
      >
        @{name}
      </Tag>,
    );
    lastIdx = match.index + full.length;
  }
  if (lastIdx < content.length) {
    parts.push(<Fragment key={`t${lastIdx}`}>{content.slice(lastIdx)}</Fragment>);
  }

  return <span className={`whitespace-pre-wrap ${className ?? ''}`}>{parts}</span>;
}
