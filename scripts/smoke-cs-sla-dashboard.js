/**
 * smoke-cs-sla-dashboard.js — 2026-07-13
 * CS Yönetim Panosu (SLA İzleme): yapısal + fonksiyonel guard'lar.
 * DB'ye YAZMAZ; türetim fonksiyonları fixture'la, gerisi kaynak-assert.
 */
import { readFileSync } from 'node:fs';
import {
  deriveWaitingDept,
  extractDevopsIds,
  openAgeBucket,
} from '../server/analytics/slaDashboard.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };

const agg = readFileSync('server/analytics/slaDashboard.js', 'utf8');
const route = readFileSync('server/routes/analytics.js', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const page = readFileSync('src/features/analytics/CsSlaDashboardPage.tsx', 'utf8');
const svc = readFileSync('src/services/analyticsService.ts', 'utf8');

// ── 1 · Yetki: TÜM roller (kullanıcı kararı 2026-07-13) + tenant scope ──
const routeBlock = route.split("router.get('/sla-dashboard'")[1] ?? '';
ok('1 route 6 rolün tamamına açık (Agent dahil — bilinçli) + requireRole zinciri yerinde',
  /const requireSlaDashboard = requireRole\(\s*'Agent',\s*'Backoffice',\s*'CSM',\s*'Supervisor',\s*'Admin',\s*'SystemAdmin',?\s*\)/.test(route)
  && routeBlock.includes('requireSlaDashboard'));
ok('2 tenant kapsamı req.user.allowedCompanyIds ile geçiyor (boşsa compute boş döner)',
  routeBlock.includes('req.user?.allowedCompanyIds ?? []')
  && /allowedCompanyIds\.length === 0\)\s*{\s*return emptyResult/.test(agg));

// ── 2 · Saklanan-değer disiplini (görünen≠saklanan tuzağı) ──
ok('3 durum/tip eşlemesi enumMap üzerinden; bilinmeyen etiket sessiz-0 değil dürüst-boş',
  agg.includes("import { M_STATUS, M_REQUEST } from '../db/enumMap.js'")
  && agg.includes('if (params.status && !st) return emptyResult')
  && agg.includes('if (params.requestType && !rt) return emptyResult'));
ok('4 terminal set saklanan değerlerle (Cozuldu/IptalEdildi) + mail direction küçük harf',
  /TERMINAL = new Set\(\['Cozuldu', 'IptalEdildi'\]\)/.test(agg)
  && agg.includes("m.direction === 'outbound'") && agg.includes("m.direction === 'inbound'"));

// ── 3 · PRIVACY: requester kişi alanları payload'a girmez ──
const selectBlock = agg.split('prisma.case.findMany')[1]?.split('});')[0] ?? '';
ok('5 vaka SELECT bloğunda customerContact*/customerCompanyName YOK (yalnız Account.name)',
  selectBlock.length > 100
  && !/customerContact|customerCompanyName/.test(selectBlock)
  && /account: \{ select: \{ id: true, name: true \} \}/.test(selectBlock));

// ── 4 · Bekleyen Bölüm türetimi — fonksiyonel (sıra kritik) ──
const base = {
  status: 'Acik', thirdPartyName: null, assignedTeamId: 'T1', assignedTeamName: 'Univera L1',
  assignedPersonId: 'P1', pendingCustomerReply: false,
};
const D = (o, m) => deriveWaitingDept({ ...base, ...o }, m);
ok('6 terminal → "—" (Cozuldu ve IptalEdildi)',
  D({ status: 'Cozuldu' }) === '—' && D({ status: 'IptalEdildi' }) === '—');
ok('7 ThirdPartyWaiting → 3rd party adı (yoksa "3. Parti")',
  D({ status: 'ThirdPartyWaiting', thirdPartyName: 'Unidox' }) === 'Unidox'
  && D({ status: 'ThirdPartyWaiting', thirdPartyName: '  ' }) === '3. Parti');
ok('8 atanmamış → Havuzda',
  D({ assignedTeamId: null, assignedPersonId: null }) === 'Havuzda');
ok('9 son mail bizden + top müşteride → Müşteri (pendingCustomerReply=false şart)',
  D({}, { lastOutboundAt: new Date(2000), lastInboundAt: new Date(1000) }) === 'Müşteri'
  && D({ pendingCustomerReply: true }, { lastOutboundAt: new Date(2000), lastInboundAt: new Date(1000) }) === 'Univera L1');
ok('10 aksi halde atanmış takım (mail hiç yoksa da)',
  D({}) === 'Univera L1'
  && D({}, { lastOutboundAt: new Date(1000), lastInboundAt: new Date(2000) }) === 'Univera L1');

// ── 5 · Yardımcılar ──
ok('11 devops id çıkarımı: JSON string + obje + bozuk girdi güvenli',
  JSON.stringify(extractDevopsIds('{"devops":[{"id":324564},{"id":"324607"}]}')) === '["324564","324607"]'
  && extractDevopsIds('BOZUK{').length === 0
  && extractDevopsIds(null).length === 0);
ok('12 açık-kalma kovaları sınır değerlerde doğru',
  openAgeBucket(0.5) === '0-1' && openAgeBucket(1) === '1-3'
  && openAgeBucket(3) === '3-7' && openAgeBucket(7) === '7+');

// ── 6 · Liste paritesi + sayfalama ──
ok('13 arşivli vakalar default hariç (isArchived: false) + pageSize 100 tavanlı',
  agg.includes('isArchived: false') && agg.includes('SLA_DASH_MAX_PAGE_SIZE = 100'));

// ── 7 · FE bağları ──
ok('14 App: view tipi + lazy import + Suspense render + nav düğmesi KOŞULSUZ (tüm roller)',
  app.includes("'cs-sla-dashboard'")
  && app.includes("import('./features/analytics/CsSlaDashboardPage')")
  && /SLA panosu yükleniyor/.test(app)
  && /handleNavSelect\('cs-sla-dashboard'\)/.test(app));
ok('15 service getSlaDashboard endpoint + tipler',
  svc.includes('/api/analytics/sla-dashboard?') && svc.includes('SlaDashboardResponse'));
ok('16 sayfa: 8 filtre + 15 kolon başlığı + KPI + empty-state + amaç satırı (öz-açıklayıcı)',
  ['Yıl', 'Ay', 'Bekleyen Bölüm', 'Support L1-L2', 'Vaka Durumu', 'Müşteri (Proje)', 'Açık Kalma Aralığı', 'Bildirim Tipi']
    .every((l) => page.includes(l))
  && ['Vaka No', 'DevOps No', 'Sahibi', 'Çözüm Uyum', 'Müdahale Uyum', 'Müd. Kalan (dk)'].every((l) => page.includes(l))
  && page.includes('Filtreye uyan vaka yok')
  && page.includes('çözüm ve müdahale SLA'));

ok('17 Codex #530 P2 seti: terminalde çözüm+müdahale sayaçları donar; supportLevel kalıcı kolondan',
  agg.includes('TERMINAL.has(c.status) && c.resolvedAt')
  && agg.includes('respMet ?? resolved ?? now')
  && /supportLevel: true/.test(agg)
  && !/personLevel|teamLevel/.test(agg));

ok('18 Excel export: backend exportAll (20k tavan + truncated bayrağı) + route export=1 + FE dinamik xlsx',
  agg.includes('SLA_DASH_EXPORT_CAP = 20000')
  && agg.includes('params.exportAll')
  && agg.includes('exportTruncated: filtered.length > SLA_DASH_EXPORT_CAP')
  && /exportAll: q\.export === '1'/.test(route)
  && page.includes("Excel'e Aktar")
  && page.includes("await import('xlsx')")
  && svc.includes('exportSlaDashboard'));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
