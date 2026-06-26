/**
 * Mail M6.2b — RichTextEditor (TipTap wrapper).
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 7.
 *
 * TipTap StarterKit (paragraph, bold/italic, list, blockquote, code, heading,
 * hard-break) + Link extension (autolink + protocols).
 *
 * Çıktı:
 *  - getHTML() composer'a string verilir
 *  - DOMPurify (M6.1 paterni) UI tarafında ikinci kat — render path'i
 *    için. Backend sanitize-html SAFE_TAGS allowlist'iyle uyumlu çıktı.
 *
 * Toolbar minimal (n4b paritesi): Bold · Italic · Underline · List ·
 * Link · Image (URL) · Undo/Redo.
 */
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Bold, Image as ImageIcon, Italic, Link as LinkIcon, List, ListOrdered, Quote, Redo2, Undo2 } from 'lucide-react';
import { useCallback, useEffect } from 'react';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function RichTextEditor({ value, onChange, placeholder, disabled }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Heading composer'da gereksiz — n4b paritesi.
        heading: false,
      }),
      Link.configure({
        autolink: true,
        openOnClick: false,
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Image.configure({ HTMLAttributes: { class: 'rounded-md max-w-full' } }),
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none min-h-[180px] px-3 py-2 focus:outline-none',
      },
    },
    immediatelyRender: false,
  });

  // Dışarıdan value değişimi (örn. imza eklendi) → editor sync.
  useEffect(() => {
    if (!editor) return;
    const cur = editor.getHTML();
    if (cur !== value) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  const promptLink = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('Link URL:');
    if (!url) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const promptImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('Görsel URL:');
    if (!url) return;
    editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  if (!editor) return <div className="h-44 animate-pulse rounded-md bg-slate-100 dark:bg-ndark-card" />;

  const btn = (active: boolean) =>
    `inline-flex h-7 w-7 items-center justify-center rounded transition ${
      active
        ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
        : 'text-slate-600 hover:bg-slate-100 dark:text-ndark-muted dark:hover:bg-ndark-bg'
    }`;

  return (
    <div className={`rounded-md border ${disabled ? 'border-slate-200 opacity-60' : 'border-slate-300 dark:border-ndark-border'} bg-white dark:bg-ndark-card`}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 px-1.5 py-1 dark:border-ndark-border">
        <button type="button" className={btn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Kalın"><Bold size={13} /></button>
        <button type="button" className={btn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="İtalik"><Italic size={13} /></button>
        <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-ndark-border" />
        <button type="button" className={btn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Madde listesi"><List size={13} /></button>
        <button type="button" className={btn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numaralı liste"><ListOrdered size={13} /></button>
        <button type="button" className={btn(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Alıntı"><Quote size={13} /></button>
        <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-ndark-border" />
        <button type="button" className={btn(editor.isActive('link'))} onClick={promptLink} title="Link ekle"><LinkIcon size={13} /></button>
        <button type="button" className={btn(false)} onClick={promptImage} title="Görsel URL"><ImageIcon size={13} /></button>
        <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-ndark-border" />
        <button type="button" className={btn(false)} onClick={() => editor.chain().focus().undo().run()} title="Geri al"><Undo2 size={13} /></button>
        <button type="button" className={btn(false)} onClick={() => editor.chain().focus().redo().run()} title="İleri al"><Redo2 size={13} /></button>
      </div>
      <EditorContent editor={editor} />
      {!editor.getText().trim() && placeholder && (
        <div className="pointer-events-none -mt-[170px] px-3 text-sm text-slate-400 dark:text-ndark-muted">{placeholder}</div>
      )}
    </div>
  );
}
