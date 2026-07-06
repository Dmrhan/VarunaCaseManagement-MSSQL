/**
 * smoke-mail-intake-race.js — 2026-07-06
 *
 * Mükerrer vaka olayı fix'i (UNV-1000594/595): iki poller aynı UNSEEN maili
 * eşzamanlı işleyince check-then-insert boşluğunda çift vaka + mail'siz
 * yetim vaka oluşuyordu. Üç katman:
 *   K1 pre-create gate  — vaka yaratmadan önce messageId küresel kontrolü
 *   K2 P2002 → deduped  — appendInbound unique ihlalini temiz sinyale çevirir
 *   K3 loser rollback   — yarışı kaybeden yetim vakasını geri alır (delete →
 *                         archive fallback), event emisyonundan ÖNCE döner
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const expectTrue = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS — ${name}`); }
  else { fail += 1; console.log(`FAIL — ${name}`); }
};

const repo = readFileSync('server/db/caseEmailRepository.js', 'utf8');
const intake = readFileSync('server/lib/inboundMailIntake.js', 'utf8');

console.log('── K2) appendInbound — P2002 yarış sinyali ──');
expectTrue('K2.1 transaction try/catch içinde + P2002 kontrolü',
  /err\?\.code === 'P2002' && messageId/.test(repo));
expectTrue('K2.2 kazanan satır refetch (companyId_messageId) + deduped:true dönüş',
  /P2002[\s\S]{0,400}companyId_messageId[\s\S]{0,200}deduped: true/.test(repo));
expectTrue('K2.3 dedup dönüşleri caseId taşır (kaybeden kendi vakasıyla karşılaştırır)',
  (repo.match(/caseId: winner\.caseId|caseId: existing\.caseId/g) ?? []).length >= 2
  && repo.includes('return { id: result.id, caseId, deduped: false }'));
expectTrue('K2.4 P2002 dışı hata hâlâ fırlatılır (throw err korunur)',
  /if \(winner\) return[\s\S]{0,140}throw err;/.test(repo));

console.log('── K1) intake — pre-create gate ──');
const gateIdx = intake.indexOf('duplicate messageId — vaka açılmadı');
const createIdx = intake.indexOf('created = await caseRepository.create(newCaseInput, actor)');
expectTrue('K1.1 gate mevcut ve caseRepository.create ÖNCESİNDE',
  gateIdx > -1 && createIdx > -1 && gateIdx < createIdx);
expectTrue('K1.2 gate companyId_messageId unique lookup kullanır',
  /alreadyIntaken = await prisma\.caseEmail\.findUnique\(\{\s*where: \{ companyId_messageId/.test(intake));
expectTrue('K1.3 gate ok:true + skipped_duplicate_message döner (poller \\Seen basar, mail düşmez)',
  /alreadyIntaken\.caseId,\s*action: 'skipped_duplicate_message'/.test(intake.replace(/\n\s*/g, ' ')) ||
  /caseId: alreadyIntaken\.caseId[\s\S]{0,80}skipped_duplicate_message/.test(intake));
expectTrue('K1.4 messageId null ise gate atlanır (guard if(parsed.messageId))',
  /if \(parsed\.messageId\) \{[\s\S]{0,200}alreadyIntaken/.test(intake));

console.log('── K3) intake — loser rollback ──');
const rollbackIdx = intake.indexOf('duplicate race — yetim vaka geri alındı');
const attachIdx = intake.indexOf('M2.1 + M6.3a — Ekleri ve inline/cid görselleri yeni vakaya bağla');
const emitIdx = intake.indexOf('case_created event emission (Codex P1 fix konumu)');
expectTrue('K3.1 rollback bloğu mevcut', rollbackIdx > -1);
expectTrue('K3.2 rollback SADECE kaybedince (deduped + farklı caseId) tetiklenir',
  /firstEmail\.deduped && firstEmail\.caseId && firstEmail\.caseId !== created\.id/.test(intake));
expectTrue('K3.3 sıra: rollback < ek persist < event emission (kaybeden bildirim tetikleyemez)',
  rollbackIdx > -1 && attachIdx > -1 && emitIdx > -1 && rollbackIdx < attachIdx && attachIdx < emitIdx);
expectTrue('K3.4 delete → archive fallback → asla throw (mail düşürülmez)',
  /prisma\.case\.delete\(\{ where: \{ id: created\.id \} \}\)/.test(intake)
  && /rollback = 'archived'/.test(intake) && /rollback = 'failed'/.test(intake));
expectTrue('K3.5 rollback dönüşü kazanan vakaya işaret eder',
  /caseId: firstEmail\.caseId,\s*action: 'skipped_duplicate_message'/.test(intake.replace(/\n\s*/g, ' '))
  || /skipped_duplicate_message[\s\S]{0,120}duplicateRollback/.test(intake));

console.log('── Kontrat ──');
expectTrue('C.1 poller intakeResult.ok ile \\Seen basar (skip de ok:true → mail tekrar işlenmez)',
  readFileSync('server/lib/imapPoller.js', 'utf8').includes('intakeResult.ok'));
expectTrue('C.2 mevcut deduped tüketicileri (ek persist skip) bozulmadı',
  intake.includes("attachmentsResult = { stored: 0, skipped: [], note: 'deduped_skipped' }"));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
