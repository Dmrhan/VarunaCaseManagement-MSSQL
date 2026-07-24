/**
 * Mail M6.2b — ContactPicker (To/Cc/Bcc chip + typeahead + manuel).
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 9.
 *
 * Davranış:
 *  - Chip input: girilen adresler chip olarak listelenir; X ile kaldırılır
 *  - Enter / virgül / boşluk → mevcut typing'i chip yapar
 *  - Backspace boş input'ta → son chip silinir
 *  - "Seçiniz" buton — hızlı autocomplete (AccountContact'ler vakanın
 *    accountId'sinden) (M6.2b kapsamında düz manuel; öneri listesi
 *    M6.3'te geliştirilebilir — şimdilik suggestions prop'u alıyor).
 *  - Format: RFC 5322 mailbox; "Name <addr>" veya sade "addr".
 *  - Validation: en az bir "@" zorunlu (basit; backend RFC tam kontrol
 *    yapacaktır).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

export interface ContactPickerValue {
  address: string;
  name: string | null;
}

interface Suggestion {
  email: string;
  name?: string | null;
  /**
   * Öneri kaynağı rozeti (alıcı-önerisi v1). OPSİYONEL — verilmezse
   * dropdown bugünkü görünümüyle aynen çalışır (geri uyumlu).
   */
  source?: 'case_contact' | 'correspondence' | 'team';
}

/** Kaynak rozeti etiketi + rengi (öz-açıklayıcı ekran: ajan kimi eklediğini görür). */
const SOURCE_BADGE: Record<NonNullable<Suggestion['source']>, { label: string; cls: string }> = {
  case_contact: { label: 'vaka kişisi', cls: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' },
  correspondence: { label: 'yazışma', cls: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' },
  team: { label: 'ekip', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
};

interface Props {
  label: string;
  values: ContactPickerValue[];
  onChange: (next: ContactPickerValue[]) => void;
  /** Vakanın AccountContact + Account.email kaynaklı öneriler. */
  suggestions?: Suggestion[];
  disabled?: boolean;
}

function isLikelyEmail(s: string): boolean {
  return /@/.test(s);
}

/**
 * "Name <addr>" veya "addr" string'inden ContactPickerValue üretir.
 * Geçersiz → null.
 */
function parseEntry(raw: string): ContactPickerValue | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) {
    const addr = m[2].trim();
    if (!isLikelyEmail(addr)) return null;
    const name = m[1].replace(/^["']|["']$/g, '').trim() || null;
    return { address: addr, name };
  }
  if (!isLikelyEmail(s)) return null;
  return { address: s, name: null };
}

export function ContactPicker({ label, values, onChange, suggestions = [], disabled }: Props) {
  const [text, setText] = useState('');
  const [openSug, setOpenSug] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Faz 2 — sürükle-bırak. Bu instance'a özgü kaynak kimliği: bir chip
  // AYNI ContactPicker'a geri bırakılırsa ("self-drop") kaynak onDragEnd'i
  // chip'i silmemeli — dropEffect tek başına self/cross-instance ayrımını
  // yapamaz (her iki durumda da onDragOver 'move' set eder). Bu yüzden
  // dragStart'ta yazılan source id, drop anında karşılaştırılıyor.
  const sourceIdRef = useRef<string | undefined>(undefined);
  if (!sourceIdRef.current) {
    sourceIdRef.current = `cp_${Math.random().toString(36).slice(2)}`;
  }
  // Self-drop tespit edilince set edilir; AYNI instance'ın onDragEnd'i
  // bunu tüketip (false'a çevirip) chip'i silmekten vazgeçer. Drop her
  // zaman dragEnd'den ÖNCE fırlar (HTML5 spec garantisi), o yüzden bu
  // ref güvenilir bir senkron sinyal.
  const justHandledSelfDropRef = useRef(false);

  // Gmail-benzeri chip seçimi — address bazlı (index DEĞİL): bir chip
  // silinip aradakiler kayınca index'ler kayar, address bazlı seçim bu
  // kaymadan etkilenmez. values değişince artık var olmayan seçimler
  // aşağıdaki effect ile otomatik temizlenir.
  const [selectedAddresses, setSelectedAddresses] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelectedAddresses((prev) => {
      const next = new Set([...prev].filter((addr) => values.some((v) => v.address === addr)));
      return next.size === prev.size ? prev : next;
    });
  }, [values]);

  const commit = useCallback((raw: string) => {
    const parsed = parseEntry(raw);
    if (!parsed) return false;
    // Duplicate engelle
    if (values.some((v) => v.address.toLowerCase() === parsed.address.toLowerCase())) {
      setText('');
      return true;
    }
    onChange([...values, parsed]);
    setText('');
    return true;
  }, [onChange, values]);

  // Yalnız yazım-ile-chip-ekleme (Enter/virgül/Tab) burada kalır. Backspace/
  // Delete + Ctrl/Cmd+C mantığı container-level handleContainerKeyDown'a
  // taşındı — çünkü chip seçiliyken input hiç focus almıyor (bkz. chip
  // onClick), o yüzden bu tuşların input'un KENDİ handler'ından bağımsız,
  // container'a bubble eden HERHANGİ bir odaktan (input veya seçili chip)
  // yakalanabilmesi gerekiyor. İkisini ayrı tutmak aynı Backspace'in iki kez
  // işlenmesini (çift silme) önler.
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      const trimmed = text.trim();
      if (trimmed && commit(trimmed)) {
        e.preventDefault();
      }
    }
  };

  const handleContainerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const isCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c';
    if (isCopy && selectedAddresses.size > 0) {
      e.preventDefault();
      const orderedAddresses = values.filter((v) => selectedAddresses.has(v.address)).map((v) => v.address);
      void navigator.clipboard.writeText(orderedAddresses.join(', ')).catch(() => {
        // Clipboard API başarısız olabilir (izin/tarayıcı desteği) — sessizce yut, uygulama kırılmasın.
      });
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      // Kullanıcı hâlâ yazıyorsa (input'ta pending metin varsa) bu davranış
      // tetiklenmemeli — native input backspace'i çalışsın.
      if (text.trim()) return;
      if (selectedAddresses.size > 0) {
        e.preventDefault();
        onChange(values.filter((v) => !selectedAddresses.has(v.address)));
        setSelectedAddresses(new Set());
        return;
      }
      // Seçim yok — mevcut davranış: input boş + Backspace → son chip silinir.
      if (e.key === 'Backspace' && values.length > 0) {
        e.preventDefault();
        onChange(values.slice(0, -1));
      }
    }
  };

  function handleChipClick(e: React.MouseEvent<HTMLSpanElement>, address: string) {
    if (disabled) return;
    e.stopPropagation();
    e.currentTarget.focus();
    setSelectedAddresses((prev) => {
      const multi = e.ctrlKey || e.metaKey;
      if (multi) {
        const next = new Set(prev);
        if (next.has(address)) next.delete(address); else next.add(address);
        return next;
      }
      return new Set([address]);
    });
  }

  function handleChipDoubleClick(e: React.MouseEvent<HTMLSpanElement>, v: ContactPickerValue, i: number) {
    if (disabled) return;
    e.stopPropagation();
    onChange(values.filter((_, idx) => idx !== i));
    setText(v.name ? `${v.name} <${v.address}>` : v.address);
    setSelectedAddresses(new Set());
    inputRef.current?.focus();
  }

  const filteredSuggestions = suggestions.filter((s) => {
    if (!s.email) return false;
    if (values.some((v) => v.address.toLowerCase() === s.email.toLowerCase())) return false;
    if (!text.trim()) return true;
    return s.email.toLowerCase().includes(text.toLowerCase())
      || (s.name?.toLowerCase().includes(text.toLowerCase()) ?? false);
  });

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-ndark-muted">{label}</label>
      <div
        className={`flex flex-wrap items-center gap-1 rounded-md border px-2 py-1.5 transition focus-within:border-brand-400 ${
          disabled
            ? 'border-slate-200 bg-slate-50 opacity-60 dark:border-ndark-border dark:bg-ndark-card'
            : 'border-slate-300 bg-white dark:border-ndark-border dark:bg-ndark-card'
        }`}
        onClick={() => {
          if (disabled) return;
          // Chip'e/X butonuna tıklama kendi handler'ında stopPropagation
          // yaptığı için buraya yalnız boş alana tıklandığında ulaşılır.
          setSelectedAddresses(new Set());
          inputRef.current?.focus();
        }}
        onKeyDown={handleContainerKeyDown}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setSelectedAddresses(new Set());

          const sourceId = e.dataTransfer.getData('application/x-varuna-contact-source');
          const isSelfDrop = !!sourceId && sourceId === sourceIdRef.current;

          let parsed: ContactPickerValue | null = null;
          const contactJson = e.dataTransfer.getData('application/x-varuna-contact');
          if (contactJson) {
            try {
              const obj = JSON.parse(contactJson);
              if (obj && typeof obj.address === 'string') {
                parsed = { address: obj.address, name: typeof obj.name === 'string' ? obj.name : null };
              }
            } catch {
              parsed = null;
            }
          }
          if (!parsed) {
            parsed = parseEntry(e.dataTransfer.getData('text/plain'));
          }
          if (!parsed) {
            // Geçersiz veri — kaynak (varsa) chip'i silmesin diye 'none' işaretle.
            e.dataTransfer.dropEffect = 'none';
            return;
          }

          if (isSelfDrop) {
            // Aynı instance'a bırakıldı — chip zaten values içinde, hiçbir
            // şey eklenmez. Kaynağın (=bu instance'ın) onDragEnd'i bu flag'i
            // görüp chip'i SİLMEYECEK.
            justHandledSelfDropRef.current = true;
            return;
          }

          const duplicate = values.some((v) => v.address.toLowerCase() === (parsed as ContactPickerValue).address.toLowerCase());
          if (duplicate) {
            // Hedefte zaten var (dedupe) — eklenmeyecek. Kaynak da chip'i
            // SİLMESİN diye dropEffect'i 'none' yap (aksi halde chip hiçbir
            // yerde kalmadan kaybolurdu).
            e.dataTransfer.dropEffect = 'none';
            return;
          }
          onChange([...values, parsed]);
        }}
      >
        {values.map((v, i) => {
          const selected = selectedAddresses.has(v.address);
          return (
          <span
            key={`${v.address}-${i}`}
            tabIndex={disabled ? undefined : -1}
            onClick={(e) => handleChipClick(e, v.address)}
            onDoubleClick={(e) => handleChipDoubleClick(e, v, i)}
            draggable={!disabled}
            onDragStart={(e) => {
              if (disabled) return;
              e.stopPropagation();
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', v.address);
              e.dataTransfer.setData('application/x-varuna-contact', JSON.stringify(v));
              e.dataTransfer.setData('application/x-varuna-contact-source', sourceIdRef.current ?? '');
            }}
            onDragEnd={(e) => {
              if (disabled) return;
              if (justHandledSelfDropRef.current) {
                // Self-drop — bu instance'ın onDrop'u zaten işaretledi, silme.
                justHandledSelfDropRef.current = false;
                return;
              }
              // Cross-instance başarılı taşıma → hedef kabul etti (dropEffect
              // 'move'). Reddedildiyse (dedupe/parse hatası) hedef 'none' set
              // etmiştir — o zaman kaynakta da kalır, chip kaybolmaz.
              if (e.dataTransfer.dropEffect === 'move') {
                onChange(values.filter((_, idx) => idx !== i));
              }
            }}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-slate-700 outline-none dark:text-ndark-text ${
              selected
                ? 'bg-brand-50 ring-2 ring-brand-400 dark:bg-brand-950/40 dark:ring-brand-500'
                : 'bg-slate-100 dark:bg-ndark-bg'
            }`}
          >
            <span className="max-w-[180px] truncate" title={v.address}>
              {v.name ? `${v.name} <${v.address}>` : v.address}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(values.filter((_, idx) => idx !== i));
              }}
              className="text-slate-400 hover:text-rose-500"
              title="Kaldır"
              aria-label="Adresi kaldır"
            >
              <X size={11} />
            </button>
          </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpenSug(true);
          }}
          onKeyDown={onKey}
          onBlur={() => {
            // Blur'da pending text'i commit et
            if (text.trim()) commit(text);
            setTimeout(() => setOpenSug(false), 150);
          }}
          onFocus={() => setOpenSug(true)}
          disabled={disabled}
          placeholder={values.length === 0 ? 'Seçiniz veya yazın' : ''}
          className="min-w-[140px] flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none dark:text-ndark-text dark:placeholder-ndark-muted"
        />
        {suggestions.length > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpenSug((v) => !v); inputRef.current?.focus(); }}
            disabled={disabled}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-ndark-text"
            title="Önerileri göster"
          >
            <ChevronDown size={14} />
          </button>
        )}
      </div>
      {openSug && filteredSuggestions.length > 0 && (
        <ul className="mt-1 max-h-44 overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-sm dark:border-ndark-border dark:bg-ndark-card">
          {filteredSuggestions.slice(0, 8).map((s) => (
            <li key={s.email}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange([...values, { address: s.email, name: s.name ?? null }]);
                  setText('');
                }}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-ndark-bg"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-slate-800 dark:text-ndark-text">{s.name ?? s.email}</span>
                  {s.name && <span className="ml-1 text-xs text-slate-500 dark:text-ndark-muted">&lt;{s.email}&gt;</span>}
                </span>
                {s.source && (
                  <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${SOURCE_BADGE[s.source].cls}`}>
                    {SOURCE_BADGE[s.source].label}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
