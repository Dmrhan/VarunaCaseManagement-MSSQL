/**
 * smoke-system-health.js — 2026-07-10
 * Sistem Sağlığı Faz 1 dikişleri: zabbixClient + systemHealth + route +
 * cron kaydı + Zabbix template. Yapısal + SMOKE_DB=1 (canlı collectHealth).
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

let pass = 0, fail = 0, skip = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const sk = (n, why) => { skip++; console.log(`SKIP — ${n} (${why})`); };
const read = (p) => readFileSync(p, 'utf8');

const zbx = read('server/lib/zabbixClient.js');
const health = read('server/lib/systemHealth.js');
const route = read('server/routes/system.js');
const appjs = read('server/app.js');
const cronS = read('server/cronScheduler.js');

console.log('── zabbixClient ──');
ok('1.1 login-promise cache (tek-login garantisi) + token retry',
  /loginPromise = rpc\('user\.login'/.test(zbx)
  && /authToken = null;\s*const fresh = await ensureAuthenticated/.test(zbx));
ok('1.2 Zabbix ≥6.4 parametresi (username) + timeout (AbortController)',
  /\{ username, password \}/.test(zbx) && /AbortController/.test(zbx) && /REQUEST_TIMEOUT_MS = 5000/.test(zbx));
ok('1.3 yapılandırılmamış modda anlaşılır hata (env yoksa patlamaz, fırlatır)',
  /isConfigured\(\)/.test(zbx) && /Zabbix yapılandırılmamış/.test(zbx));
ok('1.4 şifre loglanmaz (payload log satırı YOK)',
  !/console\.log\([^)]*payload/.test(zbx) && !/console\.log\([^)]*password/.test(zbx));
ok('1.5 history value_type eşleşme uyarısı + string→sayı çevrimi',
  /value_type/.test(zbx) && /parseFloat/.test(zbx));

console.log('── systemHealth ──');
ok('2.1 salt-okur: create/update/delete/upsert YOK',
  !/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(health));
ok('2.2 PII yok: başlık/gövde/e-posta içeriği select edilmez',
  !/title/.test(health) && !/bodyHtml|bodyText/.test(health) && !/customerContact/.test(health));
ok('2.3 bölüm izolasyonu (section try/catch) + cache',
  /async function section\(fn\)/.test(health) && /CACHE_TTL_MS = 20_000/.test(health));
ok('2.4 döngü dedektörü (5 dk vaka sayısı) + disk statfs',
  /casesCreatedLast5m/.test(health) && /statfs\(STORAGE_ROOT_DIR\)/.test(health));
ok('2.5 schemaVersion sözleşmesi',
  /schemaVersion: 1/.test(health));
ok('2.6 (Codex #514 P2) lastInboundAgeMin HER ZAMAN sayısal (null yok; sentinel + 0)',
  /NO_INBOUND_EVER_SENTINEL_MIN = 525600/.test(health)
  && /activeInboxes > 0 \? NO_INBOUND_EVER_SENTINEL_MIN : 0/.test(health)
  && !/lastInboundAgeMin: lastInbound \? [^:]+ : null/.test(health));
ok('2.7 (Codex #514 P2) storage yazılabilirlik = var olan en yakın ataya W_OK (mkdir-recursive paritesi)',
  /err\?\.code !== 'ENOENT'/.test(health)
  && /path\.dirname\(dir\)/.test(health));

console.log('── route + mount ──');
ok('3.1 çift kimlik: HEALTH_TOKEN timing-safe VEYA SystemAdmin JWT',
  /timingSafeEqual/.test(route) && /requireRole\('SystemAdmin'\)/.test(route));
ok('3.2 fail-closed: env HEALTH_TOKEN yoksa token yolu kapalı',
  /if \(!expected\) return false/.test(route));
ok('3.3 app.js mount (/api/system)',
  /app\.use\('\/api\/system', systemRouter\)/.test(appjs));

console.log('── cron kaydı (additive) ──');
ok('4.1 getCronRuns export + schedule() son-çalışma günceller',
  /export function getCronRuns/.test(cronS)
  && /rec\.lastStartAt = new Date\(\)\.toISOString\(\)/.test(cronS)
  && /finally \{[\s\S]{0,120}rec\.lastEndAt/.test(cronS));
ok('4.2 job mantığına dokunulmadı (fn çağrısı + hata logu aynen)',
  /const result = await fn\(\);/.test(cronS) && /\[cron:\$\{name\}\] hata:/.test(cronS));

console.log('── Zabbix template + README ──');
const tplPath = 'docs/integrations/zabbix/varuna-health-template.yaml';
ok('5.1 template mevcut: master HTTP-agent + dependent + JSONPath',
  existsSync(tplPath)
  && /HTTP_AGENT/.test(read(tplPath))
  && /DEPENDENT/.test(read(tplPath))
  && /JSONPATH/.test(read(tplPath)));
ok('5.2 döngü trigger\'ı DISASTER + nodata guard\'ı ("kendi ölümü")',
  /DISASTER/.test(read(tplPath)) && /nodata\(/.test(read(tplPath)));
ok('5.3 README kurulum + iki yön + fail-closed token notu',
  existsSync('docs/integrations/zabbix/README.md')
  && /YÖN A/.test(read('docs/integrations/zabbix/README.md'))
  && /YÖN B/.test(read('docs/integrations/zabbix/README.md'))
  && /fail-closed/.test(read('docs/integrations/zabbix/README.md')));

console.log('── Regresyon guard: mail düzenine dokunulmadı ──');
try {
  const changed = execSync('git diff --name-only dev...HEAD 2>/dev/null || git diff --name-only dev', { encoding: 'utf8' });
  const forbidden = ['server/lib/caseEmailSender.js', 'server/lib/inboundMailIntake.js', 'server/db/notificationRepository.js', 'server/lib/imapPoller.js', 'prisma/schema.prisma'];
  const touched = forbidden.filter((f) => changed.includes(f));
  ok(`r.1 gönderim/intake/bildirim/poller/şema DOKUNULMADI${touched.length ? ' — İHLAL: ' + touched.join(',') : ''}`,
    touched.length === 0);
} catch { sk('r.1', 'git diff alınamadı'); }

if (process.env.SMOKE_DB === '1') {
  console.log('── DB: canlı collectHealth() (salt-okur) ──');
  try {
    const { collectHealth } = await import('../server/lib/systemHealth.js');
    const h = await collectHealth();
    console.log(`   pending=${h.dispatch?.pendingCount} cases5m=${h.mail?.casesCreatedLast5m} diskFree=${h.storage?.diskFreePct}% dbMb=${h.db?.dataFileMb} cron=${h.crons?.length}`);
    ok('6.1 şekil: 7 ana bölüm + schemaVersion',
      h.schemaVersion === 1 && ['process','dispatch','mail','storage','db','crons','env'].every((k) => k in h));
    ok('6.2 dispatch sayıları makul (pending>=0, yaş>=0)',
      Number.isInteger(h.dispatch?.pendingCount) && h.dispatch.pendingCount >= 0
      && Number.isInteger(h.dispatch?.oldestPendingAgeMin));
    ok('6.3 mail bölümü dolu (24s sayılar + aktif kutu + döngü sayacı)',
      Number.isInteger(h.mail?.inbound24h) && Number.isInteger(h.mail?.casesCreatedLast5m)
      && h.mail?.activeInboxCount > 0);
    ok('6.3b direction filtresi GERÇEKTEN eşleşiyor (canlıda inbound var → yaş < sentinel; 0 sayaç bug\'ı yakalar)',
      Number.isFinite(h.mail?.lastInboundAgeMin) && h.mail.lastInboundAgeMin < 525600);
    ok('6.4 depolama: ek byte toplamları > 0 (canlı Univera verisi)',
      h.storage?.emailAttachmentBytes > 0 && h.storage?.caseAttachmentBytes > 0);
    ok('6.5 db: vaka + mail sayıları > 0, data MB > 0',
      h.db?.caseCount > 0 && h.db?.caseEmailCount > 0 && h.db?.dataFileMb > 0);
    ok('6.6 env boolean\'ları mevcut',
      typeof h.env?.appPublicBaseUrlSet === 'boolean' && typeof h.env?.storageRootWritable === 'boolean'
      && typeof h.env?.zabbixConfigured === 'boolean');
    ok('6.7 cache çalışıyor (ikinci çağrı aynı nesne)',
      (await collectHealth()) === h);
    ok('6.8 PII taraması: payload string\'inde e-posta adresi YOK',
      !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(h)));
    const { prisma } = await import('../server/db/client.js');
    await prisma.$disconnect();
  } catch (e) { fail++; console.log(`FAIL — DB: ${e.message}`); }
} else {
  sk('DB canlı collectHealth', 'SMOKE_DB!=1');
}

console.log(`\nPASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
process.exit(fail ? 1 : (skip && process.env.SMOKE_DB === '1' && !process.env.ALLOW_SKIP ? 2 : 0));
