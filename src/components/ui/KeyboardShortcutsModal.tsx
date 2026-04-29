import { Keyboard } from 'lucide-react';
import { Modal } from './Modal';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ['/'],     description: 'Vakalar listesinde arama alanına odaklan' },
  { keys: ['n'],     description: 'Yeni vaka formunu aç' },
  { keys: ['g', 'v'], description: 'Vakalar sayfasına git' },
  { keys: ['g', 'r'], description: 'Vaka Raporları sayfasına git' },
  { keys: ['Esc'],   description: 'Açık modal/drawer\'ı kapat' },
  { keys: ['?'],     description: 'Bu yardımı aç' },
];

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <div className="flex items-center gap-2">
          <Keyboard size={16} className="text-slate-500" />
          <span>Klavye Kısayolları</span>
        </div>
      }
    >
      <ul className="divide-y divide-slate-100">
        {SHORTCUTS.map((s, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-sm text-slate-700">{s.description}</span>
            <span className="flex items-center gap-1">
              {s.keys.map((k, j) => (
                <span
                  key={j}
                  className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-700 shadow-sm"
                >
                  {k}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-slate-500">
        Kısayollar input içinde yazarken devre dışıdır. <kbd className="rounded border px-1 py-px font-mono">g</kbd>+harf
        kombinasyonu için <kbd className="rounded border px-1 py-px font-mono">g</kbd>'ye basıp kısa süre içinde
        ikinci tuşa bas.
      </p>
    </Modal>
  );
}
