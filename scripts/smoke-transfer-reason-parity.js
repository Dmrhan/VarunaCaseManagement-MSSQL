/**
 * smoke-transfer-reason-parity.js — Aktarım gerekçesi enum ↔ AI şeması. 2026-07-18
 * Codex #554 P2: FE TransferReasonCode'a eklenen kod AI transfer-suggest
 * şemasında/prompt'unda YOKSA AI onu asla öneremez → yanıltıcı fallback.
 * Bu smoke iki tarafın kod kümesinin ÖRTÜŞTÜĞÜNÜ kilitler.
 */
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const tm = readFileSync('src/features/cases/components/TransferModal.tsx', 'utf8');
const ai = readFileSync('server/routes/ai.js', 'utf8');
// FE'de tanımlı reason kodlarını çek
const feCodes = [...tm.matchAll(/code:\s*'([a-z_]+)'/g)].map((m) => m[1]);
const enumLine = ai.match(/const reasonCodeEnum = \[([^\]]+)\]/)?.[1] ?? '';
const aiCodes = [...enumLine.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
ok('1 FE reason kodları AI transfer-suggest enum\'unda TAM örtüşür (öneri fallback tuzağı yok)',
  feCodes.length > 0 && feCodes.every((c) => aiCodes.includes(c)));
ok('2 followed_case özel kontrolü: hem FE hem AI şema + prompt açıklamasında',
  feCodes.includes('followed_case') && aiCodes.includes('followed_case')
  && ai.includes("'- followed_case:"));
console.log(`\nPASS=${pass}  FAIL=${fail} | FE=[${feCodes}] AI=[${aiCodes}]`);
process.exit(fail ? 1 : 0);
