import { useState, type ReactNode } from 'react';
import { Plus, Search } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { HelpButton, HelpDrawer, type HelpSection } from '@/components/ui/HelpDrawer';

interface AdminListLayoutProps {
  /** Sayfa başlığı (örn. "3. Parti Tanımları") */
  title: string;
  /** Başlığın altındaki muted açıklama (opsiyonel) */
  description?: ReactNode;
  /** Toplam kayıt sayısı badge'i */
  count?: number;
  /** Arama kutusu görünürlüğü */
  searchEnabled?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** "+ Yeni" butonu callback'i; verilmezse buton render edilmez */
  onAdd?: () => void;
  addLabel?: string;
  /** Sağ üst köşe ek aksiyonları (örn. import/export butonları) */
  headerActions?: ReactNode;
  /** Yardım drawer'ı için içerik. Verilirse "? Yardım" butonu render edilir. */
  helpTitle?: string;
  helpSections?: HelpSection[];
  /** Ana içerik — tablo, liste veya empty state */
  children: ReactNode;
}

/**
 * Tüm admin tanım ekranlarının ortak yapı taşı.
 * Header (başlık + arama + "+ Yeni" + Yardım) + Card içinde içerik slot'u.
 *
 * Yardım drawer'ı:
 * - lg+: sayfa içeriğini 320px daraltarak yan sütun olarak açılır
 * - lg altı: sağdan overlay olarak açılır (sayfayı daraltmaz)
 * - Her ekran girişinde kapalı başlar (state localStorage'a yazılmaz)
 */
export function AdminListLayout({
  title,
  description,
  count,
  searchEnabled = true,
  searchPlaceholder = 'Ara…',
  searchValue,
  onSearchChange,
  onAdd,
  addLabel = 'Yeni',
  headerActions,
  helpTitle,
  helpSections,
  children,
}: AdminListLayoutProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const hasHelp = !!(helpTitle && helpSections && helpSections.length > 0);

  return (
    <div className="lg:flex lg:items-start lg:gap-4">
      {/* Ana içerik — drawer açılınca sağ tarafta yer açar (lg+'da) */}
      <div className="min-w-0 flex-1 space-y-4">
        {/* Sayfa başlığı */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
              {count != null && <Badge tint="slate">{count}</Badge>}
            </div>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {headerActions}
            {hasHelp && (
              <HelpButton onClick={() => setHelpOpen((v) => !v)} active={helpOpen} />
            )}
            {onAdd && (
              <Button leftIcon={<Plus size={14} />} onClick={onAdd}>
                {addLabel}
              </Button>
            )}
          </div>
        </div>

        {/* İçerik kartı */}
        <Card>
          {searchEnabled && (
            <div className="border-b border-slate-200 p-3">
              <div className="relative max-w-md">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <TextInput
                  placeholder={searchPlaceholder}
                  value={searchValue ?? ''}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
          )}
          {children}
        </Card>
      </div>

      {/* Yardım drawer'ı — flex sibling */}
      {hasHelp && (
        <HelpDrawer
          open={helpOpen}
          title={helpTitle!}
          sections={helpSections!}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </div>
  );
}
