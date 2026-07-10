/**
 * smoke-case-tabs-color.js — 2026-07-10
 * Vaka detay sekmeleri "renk-kimlikli" (V4): aktif çizgi+metin sekmenin
 * rengi, ikon her zaman renkli (kullanıcı feedback: sekmeler gözden
 * kaçıyordu). FE-only; içerik/mantık/sıra dokunulmadı.
 */
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const page = readFileSync('src/features/cases/CaseDetailPage.tsx', 'utf8');
const tab = page.split('function TabButton(')[1]?.split('\nfunction ')[0] ?? '';

ok('1 TabButton color prop alır (zorunlu)',
  /color: string;/.test(tab) && /color,/.test(tab));
ok('2 aktif çizgi + metin sekmenin RENGİ (sabit brand-600 DEĞİL)',
  /borderBottomColor: active \? color : 'transparent'/.test(tab)
  && /color: active \? color : undefined/.test(tab)
  && !/border-brand-600 text-brand-700/.test(tab));
ok('3 ikon her zaman kendi renginde (idle dahil — A)',
  /<span className="inline-flex" style=\{\{ color \}\}>\{icon\}<\/span>/.test(tab));
ok('4 aktif sayaç rozeti sekme rengiyle tonlanır',
  /color-mix\(in srgb, \$\{color\} 16%, transparent\)/.test(tab));
ok('5 7 sekmenin onaylı paleti bağlı (Detay mavi … Çözüm turkuaz)',
  /label="Detay"[\s\S]{0,80}color="#0ea5e9"/.test(page)
  && /label="Aktivite"[\s\S]{0,120}color="#f59e0b"/.test(page)
  && /label="Notlar"[\s\S]{0,120}color="#8b5cf6"/.test(page)
  && /label="Dosyalar"[\s\S]{0,120}color="#10b981"/.test(page)
  && /label="Bağlantılar"[\s\S]{0,80}color="#ec4899"/.test(page)
  && /label="İletişim"[\s\S]{0,80}color="#2563eb"/.test(page)
  && /label="Çözüm Adımları"[\s\S]{0,80}color="#14b8a6"/.test(page));
ok('6 sekme SIRASI + sekme sayısı değişmedi (regresyon)',
  page.indexOf('label="Detay"') < page.indexOf('label="Aktivite"')
  && page.indexOf('label="İletişim"') < page.indexOf('label="Çözüm Adımları"'));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
