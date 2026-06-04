import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from './cn';
import {
  filterCountries,
  formatAsYouType,
  getCountryOptions,
  parsePhoneParts,
  type CountryIso2,
  type CountryOption,
} from '@/utils/phone';

const baseControl =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 ' +
  'focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500 ' +
  'dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text ' +
  'dark:placeholder:text-ndark-dim dark:focus:border-ndark-accent dark:focus:ring-ndark-accent/30 ' +
  'dark:disabled:bg-ndark-surface dark:disabled:text-ndark-muted';

interface PhoneInputProps {
  /**
   * Mevcut değer — E.164 ya da boş. Form state'i her zaman E.164 saklar
   * (invalid girişte null'a düşer); component display tarafında ulusal
   * format gösterir.
   */
  value: string | null;
  /** Yeni E.164 değer (geçerliyse) veya null (boş/invalid). */
  onChange: (e164: string | null) => void;
  /** Default seçili ülke. Default: TR. */
  defaultCountry?: CountryIso2;
  /** Hata mesajı göster (form-level zorunluluk vb.) */
  errorMessage?: string;
  disabled?: boolean;
  /** Inline placeholder ulusal kısım için. */
  placeholder?: string;
  /** Form submit yapan yerlerin name attr'ı için, opsiyonel. */
  name?: string;
  /** TextInput'a `id` geçirmek için (a11y label-for). */
  id?: string;
}

/**
 * Uluslararası telefon input'u — libphonenumber-js metadata'sı üzerinden
 * ülke seçici + AsYouType formatlama. Storage canonical formatı E.164.
 *
 * Davranış:
 * - Boş input → onChange(null)
 * - Tam geçerli numara → onChange(<E.164>)
 * - Eksik/geçersiz numara → onChange(null) + inline uyarı mesajı
 *   (boş input'ta uyarı yok)
 * - Mevcut legacy değerler parse edilemese bile crash etmez; raw değer
 *   display'de görünür, kullanıcı düzeltebilir.
 */
export function PhoneInput({
  value,
  onChange,
  defaultCountry = 'TR',
  errorMessage,
  disabled,
  placeholder,
  name,
  id,
}: PhoneInputProps) {
  // Parsed parts of the current value — drives initial country + input.
  const initialParts = useMemo(() => parsePhoneParts(value, defaultCountry), [value, defaultCountry]);

  const [country, setCountry] = useState<CountryIso2>(initialParts.country ?? defaultCountry);
  const [national, setNational] = useState<string>(() => {
    // Display formatına çevir (kullanıcı yazımı)
    if (!value) return '';
    if (initialParts.isValid && initialParts.nationalNumber) {
      return formatAsYouType(initialParts.nationalNumber, country);
    }
    // Legacy/parsed-değil değer — olduğu gibi göster.
    return value;
  });

  // Codex P2 fix — Sadece DIŞARIDAN (form reset / yeniden fetch / başka
  // bir form alanından replace) gelen değişiklikte local state'i
  // tazele. Bizim emit ettiğimiz değer prop'a geri yansırsa (geçersiz
  // ara değer → onChange(null) → parent re-render → value=null) re-init
  // çalışmamalı; yoksa kullanıcının yazdığı kısmi numara sıfırlanır.
  // `lastEmittedRef` son emit edilen E.164'i tutar; gelen prop bununla
  // eşleşiyorsa change bizden geldi, geçilir.
  const lastEmittedRef = useRef<string | null>(value);
  useEffect(() => {
    if (lastEmittedRef.current === value) return;
    lastEmittedRef.current = value;
    const next = parsePhoneParts(value, defaultCountry);
    setCountry(next.country ?? defaultCountry);
    if (!value) {
      setNational('');
    } else if (next.isValid && next.nationalNumber) {
      setNational(formatAsYouType(next.nationalNumber, next.country ?? defaultCountry));
    } else {
      setNational(value);
    }
  }, [value, defaultCountry]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Outside click → kapat
  useEffect(() => {
    if (!pickerOpen) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [pickerOpen]);

  useEffect(() => {
    if (pickerOpen) {
      // a11y — picker açıldığında focus search'a düşsün
      setTimeout(() => searchInputRef.current?.focus(), 30);
    } else {
      setSearch('');
    }
  }, [pickerOpen]);

  const allOptions = getCountryOptions();
  const filteredOptions = useMemo(
    () => filterCountries(search, allOptions),
    [search, allOptions],
  );
  const currentOption = useMemo(
    () => allOptions.find((o) => o.iso2 === country) ?? allOptions[0],
    [allOptions, country],
  );

  function emit(rawNational: string, nextCountry: CountryIso2) {
    // National kısmı + selected country → E.164 hesabı. Kullanıcı tam
    // international numara (örn. "+49 30 12 34 56 7") yapıştırırsa
    // parse onu da yakalar.
    const parsed = parsePhoneParts(rawNational, nextCountry);
    // Codex P2 fix — ne emit ettiğimizi hatırla ki parent prop=null'a
    // dönerse useEffect'i bizim emit'imizden gelen değişiklik olarak
    // tanısın ve local state'i sıfırlamasın.
    lastEmittedRef.current = parsed.e164;
    onChange(parsed.e164);
  }

  function handleNationalChange(rawInput: string) {
    // Kullanıcı `+` ile başlayan tam intl numara yapıştırdı mı?
    const trimmed = rawInput.trim();
    if (trimmed.startsWith('+')) {
      const parsed = parsePhoneParts(trimmed, country);
      if (parsed.country && parsed.nationalNumber) {
        // Ülkeyi otomatik değiştir + ulusal kısmı format'a yansıt
        setCountry(parsed.country);
        const formatted = formatAsYouType(parsed.nationalNumber, parsed.country);
        setNational(formatted);
        emit(parsed.nationalNumber, parsed.country);
        return;
      }
    }
    // Normal akış — AsYouType ile mevcut country'ye göre format
    const formatted = formatAsYouType(trimmed, country);
    setNational(formatted);
    emit(trimmed, country);
  }

  function handleCountrySelect(opt: CountryOption) {
    setCountry(opt.iso2);
    // Mevcut girişi yeni ülke için yeniden format'a sok
    const reformatted = formatAsYouType(national, opt.iso2);
    setNational(reformatted);
    emit(national, opt.iso2);
    setPickerOpen(false);
  }

  // Inline uyarı kararı: dolu input + parse başarısız = uyarı.
  const computedParts = useMemo(() => parsePhoneParts(national, country), [national, country]);
  const showInvalidWarning = !disabled && !computedParts.isEmpty && !computedParts.isValid;

  return (
    <div className="space-y-1">
      <div ref={containerRef} className="relative flex w-full gap-2">
        {/* Country picker button */}
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={disabled}
          title={`${currentOption?.name ?? country} (+${currentOption?.dialCode ?? ''})`}
          aria-label="Ülke kodu seç"
          aria-expanded={pickerOpen}
          aria-haspopup="listbox"
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-ndark-border dark:bg-ndark-card dark:text-ndark-text dark:hover:bg-ndark-surface dark:focus:border-ndark-accent dark:focus:ring-ndark-accent/30',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <span className="font-mono text-xs text-slate-500 dark:text-ndark-muted">{currentOption?.iso2}</span>
          <span className="font-medium">+{currentOption?.dialCode}</span>
          <ChevronDown size={12} className="text-slate-400" />
        </button>

        {/* National input */}
        <input
          type="tel"
          inputMode="tel"
          name={name}
          id={id}
          value={national}
          onChange={(e) => handleNationalChange(e.target.value)}
          placeholder={placeholder ?? '532 111 22 33'}
          autoComplete="tel"
          disabled={disabled}
          aria-invalid={showInvalidWarning || !!errorMessage}
          className={cn(baseControl, 'flex-1')}
        />

        {/* Picker dropdown */}
        {pickerOpen && (
          <div
            className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[90vw] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-ndark-border dark:bg-ndark-card"
            role="listbox"
          >
            <div className="border-b border-slate-100 p-2 dark:border-ndark-border/60">
              <div className="relative">
                <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Ülke / kod / ISO ara…"
                  className={cn(baseControl, 'pl-7 text-xs')}
                />
              </div>
            </div>
            <ul className="max-h-64 overflow-y-auto text-sm">
              {filteredOptions.length === 0 && (
                <li className="px-3 py-2 text-xs text-slate-400 dark:text-ndark-muted">
                  Sonuç yok.
                </li>
              )}
              {filteredOptions.map((opt) => (
                <li key={opt.iso2}>
                  <button
                    type="button"
                    onClick={() => handleCountrySelect(opt)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-ndark-surface',
                      opt.iso2 === country &&
                        'bg-brand-50 text-brand-800 dark:bg-ndark-accent/20 dark:text-ndark-text',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-7 shrink-0 font-mono text-[10px] text-slate-500 dark:text-ndark-muted">
                        {opt.iso2}
                      </span>
                      <span className="truncate">{opt.name}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs text-slate-500 dark:text-ndark-muted">
                      +{opt.dialCode}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Inline validation message */}
      {errorMessage ? (
        <p className="text-xs text-rose-600 dark:text-rose-400">{errorMessage}</p>
      ) : showInvalidWarning ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Telefon numarası geçerli görünmüyor.
        </p>
      ) : null}
    </div>
  );
}

export default PhoneInput;
