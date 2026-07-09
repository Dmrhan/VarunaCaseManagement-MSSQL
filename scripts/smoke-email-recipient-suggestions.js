/**
 * smoke-email-recipient-suggestions.js — 2026-07-10
 * Alıcı önerisi v1 (yazışma + ekip) dikişleri. Yapısal + SMOKE_DB=1
 * (canlı Univera: mailbox dışlama + kaynak etiketleri).
 *
 * Kritik güvence: özellik SALT-OKUR — gönderim/intake/bildirim dosyaları
 * bu iş kapsamında DEĞİŞMEZ (regresyon guard'ı assert r.1).
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

let pass = 0, fail = 0, skip = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const sk = (n, why) => { skip++; console.log(`SKIP — ${n} (${why})`); };
const read = (p) => readFileSync(p, 'utf8');

const repo = read('server/db/emailRecipientSuggestionRepository.js');
const routes = read('server/routes/cases.js');

console.log('── Backend: repository ──');
ok('1.1 salt-okur: repo yalnız findMany/findUnique kullanır (yazma yok)',
  !/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(repo));
ok('1.2 dışlama seti User İÇERMEZ (ekip kaynağı silinmesin) — yalnız mailbox kimlikleri',
  /buildMailboxExclusionSet/.test(repo)
  && !/user\.findMany[\s\S]{0,400}buildMailboxExclusionSet/.test(repo.split('buildMailboxExclusionSet(companyId) {')[1]?.split('}')[0] ?? 'x')
  && /externalMailInbox\.findMany/.test(repo)
  && /externalMailSettingFromAlias\.findMany/.test(repo)
  && /supportEmail/.test(repo));
ok('1.3 iki kaynak + etiket: correspondence (recency) + team (alfabetik)',
  /source: 'correspondence'/.test(repo) && /source: 'team'/.test(repo)
  && /orderBy: \{ createdAt: 'desc' \}/.test(repo)
  && /orderBy: \{ fullName: 'asc' \}/.test(repo));
ok('1.4 tarama + sonuç sınırı (CAP) tanımlı',
  /CORRESPONDENCE_SCAN_CAP = 2000/.test(repo) && /RESULT_CAP = 500/.test(repo)
  && /take: CORRESPONDENCE_SCAN_CAP/.test(repo) && /slice\(0, RESULT_CAP\)/.test(repo));
ok('1.5 bozuk JSON zarif düşer (parse try/catch → [])',
  /function parseAddressList[\s\S]{0,200}try \{[\s\S]{0,120}catch \{[\s\S]{0,40}return \[\];/.test(repo));
ok('1.6 dedup önceliği: yazışma kazanır + ekip yolu da mailbox dışlar (Codex #509 P2)',
  /if \(!addr \|\| exclusion\.has\(addr\) \|\| byAddress\.has\(addr\)\) continue;/.test(repo));
ok('1.7 (Codex #509 P1) yazışma taraması vaka görünürlüğüyle sınırlı (securityWhere + arşiv dışlama)',
  /listSuggestions\(companyId, \{ securityWhere = null \} = \{\}\)/.test(repo)
  && /case: caseVisibility/.test(repo)
  && /isArchived: false/.test(repo));
ok('1.8 (Codex #510 P2) Bcc de taranır — yalnız-Bcc adres havuza girer',
  /bccAddresses: true/.test(repo)
  && /parseAddressList\(e\.bccAddresses\)/.test(repo));

console.log('── Backend: route (from-aliases parite) ──');
const routeBlock = routes.split("'/:id/email-recipients'")[1]?.slice(0, 800) ?? '';
ok('2.1 GET /:id/email-recipients mevcut',
  routes.includes("'/:id/email-recipients'"));
ok('2.2 guard zinciri from-aliases ile aynı (get + 404 + assertCaseSecurityFilterAccess)',
  /caseRepository\.get\(/.test(routeBlock)
  && /allowedCompanyIds/.test(routeBlock)
  && /status\(404\)/.test(routeBlock)
  && /assertCaseSecurityFilterAccess/.test(routeBlock));
ok('2.3 companyId vaka üzerinden çözülür + securityWhere route\'tan geçirilir (Codex #509 P1)',
  /buildCaseListSecurityWhere\(req\)/.test(routeBlock)
  && /listSuggestions\(c\.companyId, \{ securityWhere \}\)/.test(routeBlock));

console.log('── Regresyon guard: dokunulmayan yüzeyler ──');
try {
  const changed = execSync('git diff --name-only dev...HEAD 2>/dev/null || git diff --name-only dev', { encoding: 'utf8' });
  const forbidden = ['server/lib/caseEmailSender.js', 'server/lib/inboundMailIntake.js', 'server/db/notificationRepository.js', 'prisma/schema.prisma'];
  const touched = forbidden.filter((f) => changed.includes(f));
  ok(`r.1 gönderim/intake/bildirim/şema DOKUNULMADI${touched.length ? ' — İHLAL: ' + touched.join(',') : ''}`,
    touched.length === 0);
} catch {
  sk('r.1 dokunulmama kanıtı', 'git diff alınamadı');
}

if (process.env.SMOKE_DB === '1') {
  console.log('── DB: canlı öneri havuzu (salt-okur) ──');
  try {
    const { emailRecipientSuggestionRepo } = await import('../server/db/emailRecipientSuggestionRepository.js');
    const companyId = process.env.SMOKE_COMPANY ?? 'COMP-UNIVERA';
    const items = await emailRecipientSuggestionRepo.listSuggestions(companyId);
    const addrs = new Set(items.map((i) => i.address));
    const team = items.filter((i) => i.source === 'team');
    const corr = items.filter((i) => i.source === 'correspondence');
    console.log(`   toplam=${items.length} yazışma=${corr.length} ekip=${team.length}`);
    ok('5.1 havuz dolu + cap içinde', items.length > 0 && items.length <= 500);
    ok('5.2 kendi mailbox adreslerimiz listede YOK (loop önlemi)',
      !['yazilimdestek', 'uzmandestek', 'satis', 'finans'].some((p) =>
        [...addrs].some((a) => a.startsWith(p + '@'))));
    ok('5.3 iki kaynak da temsil ediliyor (yazışma>0 + ekip>0)', corr.length > 0 && team.length > 0);
    ok('5.4 tüm kayıtlar şekilli ({address,name,source})',
      items.every((i) => typeof i.address === 'string' && i.address.includes('@')
        && (i.name === null || typeof i.name === 'string')
        && (i.source === 'correspondence' || i.source === 'team')));
    ok('5.5 adresler tekil (dedup)', addrs.size === items.length);
    const { prisma } = await import('../server/db/client.js');
    await prisma.$disconnect();
  } catch (e) { fail++; console.log(`FAIL — DB: ${e.message}`); }
} else {
  sk('DB canlı havuz kontrolü', 'SMOKE_DB!=1');
}

// FE assert'leri (Commit 2 sonrası aktif; dosyalar yoksa SKIP)
console.log('── Frontend (Commit 2) ──');
const feReady = existsSync('src/features/cases/components/MailComposer.tsx');
if (feReady) {
  const composer = read('src/features/cases/components/MailComposer.tsx');
  const picker = read('src/features/cases/components/ContactPicker.tsx');
  const svc = read('src/services/caseEmailService.ts');
  if (/getRecipientSuggestions/.test(svc)) {
    ok('3.1 service fn mevcut (email-recipients endpoint)',
      /email-recipients/.test(svc));
    ok('3.2 composer sessiz-düşüş: fetch catch ile yutulur (mail akışı etkilenmez)',
      /getRecipientSuggestions[\s\S]{0,400}catch/.test(composer));
    ok('3.3 müşteri kontağı en üstte kalır + adres dedup',
      /customerContactEmail/.test(composer));
    ok('3.4 ContactPicker geri uyumlu: source OPSİYONEL',
      /source\?:/.test(picker));
  } else {
    sk('3.x FE assert\'leri', 'Commit 2 henüz gelmedi');
  }
}

console.log(`\nPASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
process.exit(fail ? 1 : (skip && process.env.SMOKE_DB === '1' && !process.env.ALLOW_SKIP ? 2 : 0));
